import {
  PARALLEL_AXIS_MIN_DISPLAY_VALUE,
  PARALLEL_AXIS_MAX_DISPLAY_VALUE,
  PARALLEL_MISSING_AXIS_DISPLAY_VALUE,
  PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y,
  type ParallelBuffers,
} from './buffers.js';

export interface ParallelWebgl2RendererSetupMetrics {
  blendMode: string;
  densityMode: string;
  lineAlpha: number;
  lineOpacityScale: number;
  selectedLineAlpha: number;
  segmentCount: number;
  uploadMs: number;
  vertexCount: number;
}

export interface ParallelWebgl2RendererDrawMetrics {
  drawCallCount: number;
  redrawMs: number;
}

export interface ParallelWebgl2SelectedUpdateMetrics {
  bufferCreationMs: number;
  gpuUploadMs: number;
  maskBuildMs: number;
  maskGpuUploadMs: number;
  selectedLineAlpha: number;
  selectedRecordCount: number;
  selectedSegmentCount: number;
  selectedVertexCount: number;
  updateMs: number;
}

export interface ParallelWebgl2SegmentRendererOptions {
  lineOpacityScale?: number;
  preserveDrawingBuffer?: boolean;
  theme?: ParallelFastTheme;
}

export interface ParallelFastTheme {
  backgroundColor: readonly [number, number, number, number];
  lineColor: readonly [number, number, number, number];
  preselectedColor: readonly [number, number, number, number];
  selectedColor: readonly [number, number, number, number];
}

const SHADER_NORMALIZED_Y_MIN =
  PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y.toFixed(6);
const SHADER_DISPLAY_Y_MIN = PARALLEL_MISSING_AXIS_DISPLAY_VALUE.toFixed(6);
const SHADER_AXIS_MIN_DISPLAY_Y = PARALLEL_AXIS_MIN_DISPLAY_VALUE.toFixed(6);
const SHADER_AXIS_MAX_DISPLAY_Y = PARALLEL_AXIS_MAX_DISPLAY_VALUE.toFixed(6);

const VERTEX_SHADER_SOURCE = `#version 300 es
in vec2 a_position;
in uint a_sourceIndex;

uniform float u_axisSpan;
uniform bool u_useStyle;
uniform int u_styleWidth;
uniform sampler2D u_styleTexture;

out vec4 v_styleColor;

float displayY(float value) {
  float projected = clamp(value, ${SHADER_NORMALIZED_Y_MIN}, 1.0);
  float displayValue = projected <= 0.0
    ? ${SHADER_DISPLAY_Y_MIN} + ((projected - ${SHADER_NORMALIZED_Y_MIN}) / (0.0 - ${SHADER_NORMALIZED_Y_MIN})) * (${SHADER_AXIS_MIN_DISPLAY_Y} - ${SHADER_DISPLAY_Y_MIN})
    : ${SHADER_AXIS_MIN_DISPLAY_Y} + projected * (${SHADER_AXIS_MAX_DISPLAY_Y} - ${SHADER_AXIS_MIN_DISPLAY_Y});
  return displayValue * 2.0 - 1.0;
}

void main() {
  int styleX = int(a_sourceIndex % uint(u_styleWidth));
  int styleY = int(a_sourceIndex / uint(u_styleWidth));
  v_styleColor = texelFetch(u_styleTexture, ivec2(styleX, styleY), 0);
  float normalizedX = u_axisSpan <= 0.0 ? 0.0 : a_position.x / u_axisSpan;
  float x = normalizedX * 2.0 - 1.0;
  float y = displayY(a_position.y);
  gl_Position = vec4(x, y, 0.0, 1.0);
}
`;

const SELECTED_VERTEX_SHADER_SOURCE = `#version 300 es
in vec2 a_position;
in uint a_sourceIndex;

uniform float u_axisSpan;
uniform int u_maskWidth;
uniform sampler2D u_selectedMask;

flat out int v_selected;

float displayY(float value) {
  float projected = clamp(value, ${SHADER_NORMALIZED_Y_MIN}, 1.0);
  float displayValue = projected <= 0.0
    ? ${SHADER_DISPLAY_Y_MIN} + ((projected - ${SHADER_NORMALIZED_Y_MIN}) / (0.0 - ${SHADER_NORMALIZED_Y_MIN})) * (${SHADER_AXIS_MIN_DISPLAY_Y} - ${SHADER_DISPLAY_Y_MIN})
    : ${SHADER_AXIS_MIN_DISPLAY_Y} + projected * (${SHADER_AXIS_MAX_DISPLAY_Y} - ${SHADER_AXIS_MIN_DISPLAY_Y});
  return displayValue * 2.0 - 1.0;
}

void main() {
  int sourceIndex = int(a_sourceIndex);
  int maskX = sourceIndex % u_maskWidth;
  int maskY = sourceIndex / u_maskWidth;
  v_selected = int(texelFetch(u_selectedMask, ivec2(maskX, maskY), 0).r * 255.0 + 0.5);
  float x = u_axisSpan <= 0.0 ? 0.0 : (a_position.x / u_axisSpan) * 2.0 - 1.0;
  float y = displayY(a_position.y);
  gl_Position = vec4(x, y, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision mediump float;

uniform vec4 u_color;
uniform bool u_useStyle;

in vec4 v_styleColor;

out vec4 outColor;

void main() {
  outColor = u_useStyle
    ? vec4(v_styleColor.rgb, u_color.a * v_styleColor.a)
    : u_color;
}
`;

const SELECTED_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision mediump float;

flat in int v_selected;

uniform vec4 u_color;

out vec4 outColor;

void main() {
  if (v_selected == 0) {
    discard;
  }

  outColor = u_color;
}
`;

const DENSITY_MODE = 'adaptive-alpha-source-over';
const BLEND_MODE = 'src-alpha-one-minus-src-alpha';
const BACKGROUND_LINE_ALPHA_BUDGET = 6_000;
const SELECTED_LINE_ALPHA_BUDGET = 38_000;
const MIN_BACKGROUND_LINE_ALPHA = 0.0035;
const MAX_BACKGROUND_LINE_ALPHA = 0.055;
const MIN_SELECTED_LINE_ALPHA = 0.16;
const MAX_SELECTED_LINE_ALPHA = 0.72;
const HOVER_BACKGROUND_OPACITY_MULTIPLIER = 0.67;
const DEFAULT_THEME: ParallelFastTheme = {
  backgroundColor: [1, 1, 1, 1],
  lineColor: [25 / 255, 95 / 255, 170 / 255, 1],
  preselectedColor: [234 / 255, 179 / 255, 8 / 255, 0.7],
  selectedColor: [0.98, 0.72, 0.08, 0.95],
};

export class ParallelWebgl2SegmentRenderer {
  readonly setupMetrics: ParallelWebgl2RendererSetupMetrics;

  private readonly axisSpan: number;
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly hasStyleBuffers: boolean;
  private readonly maskHeight: number;
  private readonly maskWidth: number;
  private readonly positionBuffer: WebGLBuffer;
  private readonly positionLocation: number;
  private readonly preselectedMask: Uint8Array;
  private readonly preselectedMaskTexture: WebGLTexture;
  private preselectedRecordCount = 0;
  private readonly program: WebGLProgram;
  private readonly sourceIndexBuffer: WebGLBuffer;
  private readonly sourceIndexLocation: number;
  private readonly selectedMask: Uint8Array;
  private readonly selectedMaskTexture: WebGLTexture;
  private readonly selectedPositionLocation: number;
  private readonly selectedProgram: WebGLProgram;
  private readonly selectedSourceIndexLocation: number;
  private readonly styleTexture: WebGLTexture;
  private readonly styleWidth: number;
  private readonly lineAlpha: number;
  private hoverFocusActive = false;
  private lineOpacityScale: number;
  private selectedRecordCount = 0;
  private selectedSegmentCount = 0;
  private selectedLineAlpha = MAX_SELECTED_LINE_ALPHA;
  private selectedVertexCount = 0;
  private theme: ParallelFastTheme;
  private readonly uniforms: {
    axisSpan: WebGLUniformLocation;
    color: WebGLUniformLocation;
    styleTexture: WebGLUniformLocation;
    useStyle: WebGLUniformLocation;
    styleWidth: WebGLUniformLocation;
  };
  private readonly selectedUniforms: {
    axisSpan: WebGLUniformLocation;
    color: WebGLUniformLocation;
    maskWidth: WebGLUniformLocation;
    selectedMask: WebGLUniformLocation;
  };
  private readonly vao: WebGLVertexArrayObject;
  private readonly vertexCount: number;

  constructor(
    canvas: HTMLCanvasElement,
    buffers: ParallelBuffers,
    options: ParallelWebgl2SegmentRendererOptions = {},
  ) {
    this.theme = options.theme ?? DEFAULT_THEME;
    this.lineOpacityScale = normalizeLineOpacityScale(options.lineOpacityScale);
    const segmentBuffers = buffers.webglSegmentBuffers;

    if (!segmentBuffers) {
      throw new Error('WebGL2 segment buffers were not built for this dataset.');
    }

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: options.preserveDrawingBuffer === true,
    });

    if (!gl) {
      throw new Error('WebGL2 is unavailable in this browser.');
    }

    const uploadStartedAt = performance.now();
    const program = createProgram(gl, VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
    const selectedProgram = createProgram(
      gl,
      SELECTED_VERTEX_SHADER_SOURCE,
      SELECTED_FRAGMENT_SHADER_SOURCE,
    );
    const positionLocation = gl.getAttribLocation(program, 'a_position');
    const sourceIndexLocation = gl.getAttribLocation(program, 'a_sourceIndex');
    const selectedPositionLocation = gl.getAttribLocation(selectedProgram, 'a_position');
    const selectedSourceIndexLocation = gl.getAttribLocation(
      selectedProgram,
      'a_sourceIndex',
    );
    const axisSpanLocation = gl.getUniformLocation(program, 'u_axisSpan');
    const colorLocation = gl.getUniformLocation(program, 'u_color');
    const styleWidthLocation = gl.getUniformLocation(program, 'u_styleWidth');
    const useStyleLocation = gl.getUniformLocation(program, 'u_useStyle');
    const styleTextureLocation = gl.getUniformLocation(program, 'u_styleTexture');
    const selectedAxisSpanLocation = gl.getUniformLocation(
      selectedProgram,
      'u_axisSpan',
    );
    const selectedColorLocation = gl.getUniformLocation(selectedProgram, 'u_color');
    const maskWidthLocation = gl.getUniformLocation(selectedProgram, 'u_maskWidth');
    const selectedMaskLocation = gl.getUniformLocation(
      selectedProgram,
      'u_selectedMask',
    );
    const vao = gl.createVertexArray();
    const positionBuffer = gl.createBuffer();
    const sourceIndexBuffer = gl.createBuffer();
    const preselectedMaskTexture = gl.createTexture();
    const selectedMaskTexture = gl.createTexture();
    const styleTexture = gl.createTexture();

    if (
      positionLocation < 0 ||
      sourceIndexLocation < 0 ||
      selectedPositionLocation < 0 ||
      selectedSourceIndexLocation < 0 ||
      !axisSpanLocation ||
      !colorLocation ||
      !styleWidthLocation ||
      !useStyleLocation ||
      !styleTextureLocation ||
      !selectedAxisSpanLocation ||
      !selectedColorLocation ||
      !maskWidthLocation ||
      !selectedMaskLocation
    ) {
      throw new Error('WebGL2 renderer shader bindings could not be resolved.');
    }
    if (
      !vao ||
      !positionBuffer ||
      !sourceIndexBuffer ||
      !preselectedMaskTexture ||
      !selectedMaskTexture ||
      !styleTexture
    ) {
      throw new Error('WebGL2 renderer buffers could not be allocated.');
    }

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, segmentBuffers.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(
      positionLocation,
      segmentBuffers.valuesPerVertex,
      gl.FLOAT,
      false,
      0,
      0,
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, sourceIndexBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      segmentBuffers.sourceIndicesByVertex ??
        expandSegmentSourceIndicesByVertex(segmentBuffers.sourceIndices),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(sourceIndexLocation);
    gl.vertexAttribIPointer(sourceIndexLocation, 1, gl.UNSIGNED_INT, 0, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    const maskWidth = Math.max(1, Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 4096));
    const maskHeight = Math.max(1, Math.ceil(buffers.recordCount / maskWidth));
    const preselectedMask = new Uint8Array(maskWidth * maskHeight);
    const selectedMask = new Uint8Array(maskWidth * maskHeight);
    const styleWidth = maskWidth;
    const styleHeight = maskHeight;
    const styleRgba = createStyleTextureBuffer(
      buffers.styleBuffers?.color,
      buffers.recordCount,
      styleWidth,
      styleHeight,
    );

    gl.bindTexture(gl.TEXTURE_2D, preselectedMaskTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      maskWidth,
      maskHeight,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      preselectedMask,
    );
    gl.bindTexture(gl.TEXTURE_2D, selectedMaskTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      maskWidth,
      maskHeight,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      selectedMask,
    );
    gl.bindTexture(gl.TEXTURE_2D, styleTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      styleWidth,
      styleHeight,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      styleRgba,
    );
    gl.bindTexture(gl.TEXTURE_2D, null);

    this.axisSpan = Math.max(0, buffers.axisCount - 1);
    this.canvas = canvas;
    this.gl = gl;
    this.hasStyleBuffers = buffers.styleBuffers !== undefined;
    this.maskHeight = maskHeight;
    this.maskWidth = maskWidth;
    this.positionBuffer = positionBuffer;
    this.positionLocation = positionLocation;
    this.preselectedMask = preselectedMask;
    this.preselectedMaskTexture = preselectedMaskTexture;
    this.program = program;
    this.sourceIndexBuffer = sourceIndexBuffer;
    this.sourceIndexLocation = sourceIndexLocation;
    this.selectedMask = selectedMask;
    this.selectedMaskTexture = selectedMaskTexture;
    this.selectedPositionLocation = selectedPositionLocation;
    this.selectedProgram = selectedProgram;
    this.selectedSourceIndexLocation = selectedSourceIndexLocation;
    this.styleTexture = styleTexture;
    this.styleWidth = styleWidth;
    this.lineAlpha = resolveAdaptiveAlpha(
      buffers.recordCount,
      MIN_BACKGROUND_LINE_ALPHA,
      MAX_BACKGROUND_LINE_ALPHA,
      BACKGROUND_LINE_ALPHA_BUDGET,
    );
    this.uniforms = {
      axisSpan: axisSpanLocation,
      color: colorLocation,
      styleTexture: styleTextureLocation,
      useStyle: useStyleLocation,
      styleWidth: styleWidthLocation,
    };
    this.selectedUniforms = {
      axisSpan: selectedAxisSpanLocation,
      color: selectedColorLocation,
      maskWidth: maskWidthLocation,
      selectedMask: selectedMaskLocation,
    };
    this.vao = vao;
    this.vertexCount = segmentBuffers.segmentCount * segmentBuffers.verticesPerSegment;
    this.setupMetrics = {
      blendMode: BLEND_MODE,
      densityMode: DENSITY_MODE,
      lineAlpha: this.lineAlpha,
      lineOpacityScale: this.lineOpacityScale,
      segmentCount: segmentBuffers.segmentCount,
      selectedLineAlpha: this.selectedLineAlpha,
      uploadMs: performance.now() - uploadStartedAt,
      vertexCount: this.vertexCount,
    };
  }

  updateTheme(theme: ParallelFastTheme | undefined): void {
    this.theme = theme ?? DEFAULT_THEME;
  }

  updateLineOpacityScale(lineOpacityScale: number): void {
    this.lineOpacityScale = normalizeLineOpacityScale(lineOpacityScale);
  }

  setHoverFocusActive(active: boolean): boolean {
    if (this.hoverFocusActive === active) {
      return false;
    }

    this.hoverFocusActive = active;
    return true;
  }

  dispose(): void {
    this.gl.deleteBuffer(this.positionBuffer);
    this.gl.deleteBuffer(this.sourceIndexBuffer);
    this.gl.deleteTexture(this.preselectedMaskTexture);
    this.gl.deleteTexture(this.selectedMaskTexture);
    this.gl.deleteTexture(this.styleTexture);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.program);
    this.gl.deleteProgram(this.selectedProgram);
  }

  updatePreselectedSourceIndices(
    buffers: ParallelBuffers,
    preselectedSourceIndices: Uint32Array,
  ): void {
    this.preselectedMask.fill(0);
    let preselectedRecordCount = 0;

    for (const sourceIndex of preselectedSourceIndices) {
      if (
        Number.isInteger(sourceIndex) &&
        sourceIndex >= 0 &&
        sourceIndex < buffers.recordCount &&
        this.preselectedMask[sourceIndex] === 0
      ) {
        this.preselectedMask[sourceIndex] = 255;
        preselectedRecordCount += 1;
      }
    }

    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.preselectedMaskTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      this.maskWidth,
      this.maskHeight,
      gl.RED,
      gl.UNSIGNED_BYTE,
      this.preselectedMask,
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.preselectedRecordCount = preselectedRecordCount;
  }

  updateSelectedSourceIndices(
    buffers: ParallelBuffers,
    selectedSourceIndices: Uint32Array,
  ): ParallelWebgl2SelectedUpdateMetrics {
    const updateStartedAt = performance.now();
    const maskBuildStartedAt = performance.now();
    this.selectedMask.fill(0);
    let selectedRecordCount = 0;

    for (const sourceIndex of selectedSourceIndices) {
      if (
        Number.isInteger(sourceIndex) &&
        sourceIndex >= 0 &&
        sourceIndex < buffers.recordCount &&
        this.selectedMask[sourceIndex] === 0
      ) {
        this.selectedMask[sourceIndex] = 255;
        selectedRecordCount += 1;
      }
    }

    const maskBuildMs = performance.now() - maskBuildStartedAt;
    const gl = this.gl;
    const gpuUploadStartedAt = performance.now();

    gl.bindTexture(gl.TEXTURE_2D, this.selectedMaskTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      this.maskWidth,
      this.maskHeight,
      gl.RED,
      gl.UNSIGNED_BYTE,
      this.selectedMask,
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
    const maskGpuUploadMs = performance.now() - gpuUploadStartedAt;
    this.selectedRecordCount = selectedRecordCount;
    this.selectedSegmentCount = selectedRecordCount * Math.max(0, buffers.axisCount - 1);
    this.selectedVertexCount = this.selectedSegmentCount * 2;
    this.selectedLineAlpha =
      selectedRecordCount === 0
        ? MAX_SELECTED_LINE_ALPHA
        : resolveAdaptiveAlpha(
            selectedRecordCount,
            MIN_SELECTED_LINE_ALPHA,
            MAX_SELECTED_LINE_ALPHA,
            SELECTED_LINE_ALPHA_BUDGET,
          );

    return {
      bufferCreationMs: 0,
      gpuUploadMs: 0,
      maskBuildMs,
      maskGpuUploadMs,
      selectedLineAlpha: this.selectedLineAlpha,
      selectedRecordCount,
      selectedSegmentCount: this.selectedSegmentCount,
      selectedVertexCount: this.selectedVertexCount,
      updateMs: performance.now() - updateStartedAt,
    };
  }

  draw(): ParallelWebgl2RendererDrawMetrics | null {
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
    gl.clearColor(...this.theme.backgroundColor);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform1f(this.uniforms.axisSpan, this.axisSpan);
    gl.uniform1i(this.uniforms.styleWidth, this.styleWidth);
    gl.uniform1i(this.uniforms.useStyle, this.hasStyleBuffers ? 1 : 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.styleTexture);
    gl.uniform1i(this.uniforms.styleTexture, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform4f(
      this.uniforms.color,
      this.theme.lineColor[0],
      this.theme.lineColor[1],
      this.theme.lineColor[2],
      clamp(
        this.lineAlpha *
          this.lineOpacityScale *
          (this.hoverFocusActive ? HOVER_BACKGROUND_OPACITY_MULTIPLIER : 1),
        0,
        1,
      ),
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sourceIndexBuffer);
    gl.vertexAttribIPointer(this.sourceIndexLocation, 1, gl.UNSIGNED_INT, 0, 0);
    gl.drawArrays(gl.LINES, 0, this.vertexCount);

    if (this.preselectedRecordCount > 0) {
      gl.useProgram(this.selectedProgram);
      gl.uniform4f(this.selectedUniforms.color, ...this.theme.preselectedColor);
      gl.uniform1f(this.selectedUniforms.axisSpan, this.axisSpan);
      gl.uniform1i(this.selectedUniforms.maskWidth, this.maskWidth);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.preselectedMaskTexture);
      gl.uniform1i(this.selectedUniforms.selectedMask, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
      gl.enableVertexAttribArray(this.selectedPositionLocation);
      gl.vertexAttribPointer(this.selectedPositionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sourceIndexBuffer);
      gl.enableVertexAttribArray(this.selectedSourceIndexLocation);
      gl.vertexAttribIPointer(
        this.selectedSourceIndexLocation,
        1,
        gl.UNSIGNED_INT,
        0,
        0,
      );
      gl.drawArrays(gl.LINES, 0, this.vertexCount);
    }

    if (this.selectedVertexCount > 0) {
      gl.useProgram(this.selectedProgram);
      gl.uniform4f(
        this.selectedUniforms.color,
        this.theme.selectedColor[0],
        this.theme.selectedColor[1],
        this.theme.selectedColor[2],
        this.selectedLineAlpha,
      );
      gl.uniform1f(this.selectedUniforms.axisSpan, this.axisSpan);
      gl.uniform1i(this.selectedUniforms.maskWidth, this.maskWidth);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.selectedMaskTexture);
      gl.uniform1i(this.selectedUniforms.selectedMask, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
      gl.enableVertexAttribArray(this.selectedPositionLocation);
      gl.vertexAttribPointer(this.selectedPositionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sourceIndexBuffer);
      gl.enableVertexAttribArray(this.selectedSourceIndexLocation);
      gl.vertexAttribIPointer(
        this.selectedSourceIndexLocation,
        1,
        gl.UNSIGNED_INT,
        0,
        0,
      );
      gl.drawArrays(gl.LINES, 0, this.vertexCount);
    }

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.flush();

    return {
      drawCallCount:
        (this.vertexCount > 0 ? 1 : 0) +
        (this.preselectedRecordCount > 0 ? 1 : 0) +
        (this.selectedRecordCount > 0 ? 1 : 0),
      redrawMs: performance.now() - redrawStartedAt,
    };
  }
}

function resolveAdaptiveAlpha(
  recordCount: number,
  minAlpha: number,
  maxAlpha: number,
  alphaBudget: number,
): number {
  if (recordCount <= 0) {
    return maxAlpha;
  }

  return clamp(alphaBudget / recordCount, minAlpha, maxAlpha);
}

function normalizeLineOpacityScale(lineOpacityScale: number | undefined): number {
  return Number.isFinite(lineOpacityScale) && lineOpacityScale !== undefined
    ? Math.max(0, lineOpacityScale)
    : 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createStyleTextureBuffer(
  styleColor: ArrayLike<number> | undefined,
  recordCount: number,
  textureWidth: number,
  textureHeight: number,
): Uint8Array {
  const rgba = new Uint8Array(textureWidth * textureHeight * 4);

  if (styleColor === undefined) {
    return rgba;
  }

  const count = Math.min(styleColor.length, recordCount * 4);
  for (let index = 0; index < count; index += 1) {
    rgba[index] = styleColor[index] ?? 0;
  }
  return rgba;
}

function expandSegmentSourceIndicesByVertex(sourceIndices: Uint32Array): Uint32Array {
  const sourceIndicesByVertex = new Uint32Array(sourceIndices.length * 2);

  for (let segmentIndex = 0; segmentIndex < sourceIndices.length; segmentIndex += 1) {
    const sourceIndex = sourceIndices[segmentIndex];
    const vertexOffset = segmentIndex * 2;
    sourceIndicesByVertex[vertexOffset] = sourceIndex;
    sourceIndicesByVertex[vertexOffset + 1] = sourceIndex;
  }

  return sourceIndicesByVertex;
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
    throw new Error('WebGL2 renderer program could not be allocated.');
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) ?? 'unknown link error';
    gl.deleteProgram(program);
    throw new Error(`WebGL2 renderer program failed to link: ${info}`);
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
    throw new Error('WebGL2 renderer shader could not be allocated.');
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) ?? 'unknown compile error';
    gl.deleteShader(shader);
    throw new Error(`WebGL2 renderer shader failed to compile: ${info}`);
  }

  return shader;
}
