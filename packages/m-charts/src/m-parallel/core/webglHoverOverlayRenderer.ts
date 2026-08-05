import {
  PARALLEL_AXIS_MIN_DISPLAY_VALUE,
  PARALLEL_AXIS_MAX_DISPLAY_VALUE,
  PARALLEL_MISSING_AXIS_DISPLAY_VALUE,
  PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y,
  forEachParallelRoutedSegment,
  type ParallelBuffers,
} from './buffers.js';
import type { ParallelFastTheme } from './webglSegmentRenderer.js';

export interface ParallelWebgl2HoverDrawMetrics {
  drawCallCount: number;
  redrawMs: number;
}

export interface ParallelWebgl2HoverUpdateMetrics {
  baseRedrawMs?: number | null;
  changed: boolean;
  gpuUploadMs: number;
  hoverRecordIndex: number | null;
  hoverSegmentCount: number;
  hoverVertexCount: number;
  skipped?: boolean;
  updateMs: number;
  uploadBytes: number;
}

export interface ParallelWebgl2HoverOverlayRendererOptions {
  preserveDrawingBuffer?: boolean;
  theme?: ParallelFastTheme;
}

const SHADER_NORMALIZED_Y_MIN =
  PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y.toFixed(6);
const SHADER_DISPLAY_Y_MIN = PARALLEL_MISSING_AXIS_DISPLAY_VALUE.toFixed(6);
const SHADER_AXIS_MIN_DISPLAY_Y = PARALLEL_AXIS_MIN_DISPLAY_VALUE.toFixed(6);
const SHADER_AXIS_MAX_DISPLAY_Y = PARALLEL_AXIS_MAX_DISPLAY_VALUE.toFixed(6);

const VERTEX_SHADER_SOURCE = `#version 300 es
in vec2 a_position;

uniform float u_axisSpan;

float displayY(float value) {
  float projected = clamp(value, ${SHADER_NORMALIZED_Y_MIN}, 1.0);
  float displayValue = projected <= 0.0
    ? ${SHADER_DISPLAY_Y_MIN} + ((projected - ${SHADER_NORMALIZED_Y_MIN}) / (0.0 - ${SHADER_NORMALIZED_Y_MIN})) * (${SHADER_AXIS_MIN_DISPLAY_Y} - ${SHADER_DISPLAY_Y_MIN})
    : ${SHADER_AXIS_MIN_DISPLAY_Y} + projected * (${SHADER_AXIS_MAX_DISPLAY_Y} - ${SHADER_AXIS_MIN_DISPLAY_Y});
  return displayValue * 2.0 - 1.0;
}

void main() {
  float x = u_axisSpan <= 0.0 ? 0.0 : (a_position.x / u_axisSpan) * 2.0 - 1.0;
  float y = displayY(a_position.y);
  gl_Position = vec4(x, y, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision mediump float;

uniform vec4 u_color;

out vec4 outColor;

void main() {
  outColor = u_color;
}
`;

const DEFAULT_THEME: ParallelFastTheme = {
  backgroundColor: [1, 1, 1, 1],
  lineColor: [25 / 255, 95 / 255, 170 / 255, 1],
  preselectedColor: [234 / 255, 179 / 255, 8 / 255, 0.7],
  selectedColor: [0.98, 0.72, 0.08, 0.95],
};

export class ParallelWebgl2HoverOverlayRenderer {
  private readonly axisSpan: number;
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private hoverRecordIndex: number | null = null;
  private hoverSegmentCount = 0;
  private hoverVertexCount = 0;
  private readonly positionBuffer: WebGLBuffer;
  private readonly positionLocation: number;
  private readonly positionsScratch: Float32Array;
  private readonly program: WebGLProgram;
  private theme: ParallelFastTheme;
  private readonly uniforms: {
    axisSpan: WebGLUniformLocation;
    color: WebGLUniformLocation;
  };

  constructor(
    canvas: HTMLCanvasElement,
    buffers: ParallelBuffers,
    options: ParallelWebgl2HoverOverlayRendererOptions = {},
  ) {
    this.axisSpan = Math.max(0, buffers.axisCount - 1);
    this.canvas = canvas;
    this.theme = options.theme ?? DEFAULT_THEME;
    this.positionsScratch = new Float32Array(Math.max(0, buffers.axisCount - 1) * 4);

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: options.preserveDrawingBuffer === true,
    });

    if (!gl) {
      throw new Error('WebGL2 is unavailable for the parallel hover overlay.');
    }

    const program = createProgram(gl, VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
    const positionLocation = gl.getAttribLocation(program, 'a_position');
    const axisSpanLocation = gl.getUniformLocation(program, 'u_axisSpan');
    const colorLocation = gl.getUniformLocation(program, 'u_color');
    const positionBuffer = gl.createBuffer();

    if (positionLocation < 0 || !axisSpanLocation || !colorLocation) {
      gl.deleteProgram(program);
      throw new Error('WebGL2 hover overlay shader bindings could not be resolved.');
    }
    if (!positionBuffer) {
      gl.deleteProgram(program);
      throw new Error('WebGL2 hover overlay buffers could not be allocated.');
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      this.positionsScratch.byteLength,
      gl.DYNAMIC_DRAW,
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this.gl = gl;
    this.positionBuffer = positionBuffer;
    this.positionLocation = positionLocation;
    this.program = program;
    this.uniforms = {
      axisSpan: axisSpanLocation,
      color: colorLocation,
    };
  }

  clear(): ParallelWebgl2HoverDrawMetrics | null {
    this.hoverRecordIndex = null;
    this.hoverSegmentCount = 0;
    this.hoverVertexCount = 0;
    return this.draw();
  }

  dispose(): void {
    this.gl.deleteBuffer(this.positionBuffer);
    this.gl.deleteProgram(this.program);
  }

  draw(): ParallelWebgl2HoverDrawMetrics | null {
    const rect = this.canvas.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const redrawStartedAt = performance.now();
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(rect.width * pixelRatio));
    const height = Math.max(1, Math.floor(rect.height * pixelRatio));
    const gl = this.gl;

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (this.hoverVertexCount <= 0) {
      gl.flush();
      return {
        drawCallCount: 0,
        redrawMs: performance.now() - redrawStartedAt,
      };
    }

    gl.useProgram(this.program);
    gl.uniform1f(this.uniforms.axisSpan, this.axisSpan);
    gl.uniform4f(
      this.uniforms.color,
      this.theme.selectedColor[0],
      this.theme.selectedColor[1],
      this.theme.selectedColor[2],
      0.95,
    );
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.lineWidth(2);
    gl.drawArrays(gl.LINES, 0, this.hoverVertexCount);
    gl.lineWidth(1);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.flush();

    return {
      drawCallCount: 1,
      redrawMs: performance.now() - redrawStartedAt,
    };
  }

  setHoverSourceIndex(
    buffers: ParallelBuffers,
    sourceIndex: number | null,
  ): ParallelWebgl2HoverUpdateMetrics {
    const updateStartedAt = performance.now();
    const normalizedSourceIndex = normalizeHoverSourceIndex(
      sourceIndex,
      buffers.recordCount,
    );

    if (normalizedSourceIndex === null) {
      const changed = this.hoverRecordIndex !== null || this.hoverVertexCount !== 0;
      this.hoverRecordIndex = null;
      this.hoverSegmentCount = 0;
      this.hoverVertexCount = 0;
      return {
        changed,
        gpuUploadMs: 0,
        hoverRecordIndex: null,
        hoverSegmentCount: 0,
        hoverVertexCount: 0,
        updateMs: performance.now() - updateStartedAt,
        uploadBytes: 0,
      };
    }

    if (this.hoverRecordIndex === normalizedSourceIndex) {
      return {
        changed: false,
        gpuUploadMs: 0,
        hoverRecordIndex: normalizedSourceIndex,
        hoverSegmentCount: this.hoverSegmentCount,
        hoverVertexCount: this.hoverVertexCount,
        updateMs: performance.now() - updateStartedAt,
        uploadBytes: 0,
      };
    }

    const floatCount = writeOneRecordSegmentPositions(
      buffers,
      normalizedSourceIndex,
      this.positionsScratch,
    );
    const uploadBytes = floatCount * Float32Array.BYTES_PER_ELEMENT;
    const gl = this.gl;
    const gpuUploadStartedAt = performance.now();

    if (floatCount > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.positionsScratch,
        0,
        floatCount,
      );
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    const gpuUploadMs = performance.now() - gpuUploadStartedAt;
    this.hoverRecordIndex = normalizedSourceIndex;
    this.hoverSegmentCount = floatCount / 4;
    this.hoverVertexCount = this.hoverSegmentCount * 2;

    return {
      changed: true,
      gpuUploadMs,
      hoverRecordIndex: normalizedSourceIndex,
      hoverSegmentCount: this.hoverSegmentCount,
      hoverVertexCount: this.hoverVertexCount,
      updateMs: performance.now() - updateStartedAt,
      uploadBytes,
    };
  }

  updateTheme(theme: ParallelFastTheme | undefined): void {
    this.theme = theme ?? DEFAULT_THEME;
  }
}

export function writeOneRecordSegmentPositions(
  buffers: ParallelBuffers,
  sourceIndex: number,
  target: Float32Array,
): number {
  if (
    !Number.isInteger(sourceIndex) ||
    sourceIndex < 0 ||
    sourceIndex >= buffers.recordCount
  ) {
    return 0;
  }

  let offset = 0;

  forEachParallelRoutedSegment(
    buffers.normalizedValuesByAxis,
    buffers.axisOrder,
    sourceIndex,
    (segment) => {
      if (offset + 3 >= target.length) {
        return;
      }
      target[offset] = segment.startAxisIndex;
      target[offset + 1] = segment.startNormalizedValue;
      target[offset + 2] = segment.endAxisIndex;
      target[offset + 3] = segment.endNormalizedValue;
      offset += 4;
    },
  );

  return offset;
}

function normalizeHoverSourceIndex(
  sourceIndex: number | null,
  recordCount: number,
): number | null {
  if (sourceIndex === null) {
    return null;
  }

  const normalized = Math.floor(sourceIndex);
  if (!Number.isSafeInteger(normalized) || normalized < 0 || normalized >= recordCount) {
    return null;
  }

  return normalized;
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();

  if (!program) {
    throw new Error('WebGL2 hover overlay program could not be allocated.');
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) ?? 'unknown link error';
    gl.deleteProgram(program);
    throw new Error(`WebGL2 hover overlay program failed to link: ${info}`);
  }

  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  return program;
}

function createShader(
  gl: WebGL2RenderingContext,
  shaderType: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(shaderType);

  if (!shader) {
    throw new Error('WebGL2 hover overlay shader could not be allocated.');
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) ?? 'unknown compile error';
    gl.deleteShader(shader);
    throw new Error(`WebGL2 hover overlay shader failed to compile: ${info}`);
  }

  return shader;
}
