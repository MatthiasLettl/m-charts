export interface FastScatterPointProgram {
  attributes: {
    color: number;
    corner: number;
    opacity: number;
    rotation: number;
    shape: number;
    size: number;
    x: number;
    y: number;
  };
  metrics: FastScatterProgramMetrics;
  program: WebGLProgram;
  uniforms: {
    alphaScale: WebGLUniformLocation;
    devicePixelRatio: WebGLUniformLocation;
    selectedMask: WebGLUniformLocation;
    selectedMaskWidth: WebGLUniformLocation;
    selectedOverlayColor: WebGLUniformLocation;
    selectedOverlayEnabled: WebGLUniformLocation;
    opacityScale: WebGLUniformLocation;
    themeAlphaScaleMultiplier: WebGLUniformLocation;
    themeColorMixAmount: WebGLUniformLocation;
    themeColorMixColor: WebGLUniformLocation;
    pointSizeScale: WebGLUniformLocation;
    viewportSizePx: WebGLUniformLocation;
    xRange: WebGLUniformLocation;
    yRange: WebGLUniformLocation;
  };
}

export interface FastScatterBubbleProgram {
  attributes: {
    color: number;
    corner: number;
    hovered: number;
    radiusPx: number;
    selectedFraction: number;
    x: number;
    y: number;
  };
  metrics: FastScatterProgramMetrics;
  program: WebGLProgram;
  uniforms: {
    devicePixelRatio: WebGLUniformLocation;
    hoverOverlayColor: WebGLUniformLocation;
    opacityScale: WebGLUniformLocation;
    selectedOverlayColor: WebGLUniformLocation;
    themeAlphaScaleMultiplier: WebGLUniformLocation;
    themeColorMixAmount: WebGLUniformLocation;
    themeColorMixColor: WebGLUniformLocation;
    viewportSizePx: WebGLUniformLocation;
    xRange: WebGLUniformLocation;
    yRange: WebGLUniformLocation;
  };
}

export interface FastScatterHeatmapProgram {
  attributes: {
    centerX: number;
    centerY: number;
    color: number;
    corner: number;
    halfHeightAxis: number;
    halfWidthAxis: number;
    hovered: number;
    selectedFraction: number;
  };
  metrics: FastScatterProgramMetrics;
  program: WebGLProgram;
  uniforms: {
    borderAlpha: WebGLUniformLocation;
    borderColor: WebGLUniformLocation;
    cellSizePx: WebGLUniformLocation;
    hoverOverlayColor: WebGLUniformLocation;
    opacityScale: WebGLUniformLocation;
    selectedOverlayColor: WebGLUniformLocation;
    xRange: WebGLUniformLocation;
    yRange: WebGLUniformLocation;
  };
}

export interface FastScatterProgramMetrics {
  fragmentCompileMs: number;
  linkMs: number;
  shaderCompileMs: number;
  vertexCompileMs: number;
}

const POINT_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

in float a_x;
in float a_y;
in vec4 a_color;
in float a_opacity;
in float a_rotation;
in float a_shape;
in float a_size;
in vec2 a_corner;

uniform vec2 u_xRange;
uniform vec2 u_yRange;
uniform float u_alphaScale;
uniform float u_devicePixelRatio;
uniform sampler2D u_selectedMask;
uniform int u_selectedMaskWidth;
uniform vec4 u_selectedOverlayColor;
uniform bool u_selectedOverlayEnabled;
uniform float u_opacityScale;
uniform float u_themeAlphaScaleMultiplier;
uniform float u_themeColorMixAmount;
uniform vec3 u_themeColorMixColor;
uniform float u_pointSizeScale;
uniform vec2 u_viewportSizePx;

out vec4 v_color;
flat out int v_shape;
out vec2 v_local;

void main() {
  int sourceIndex = gl_InstanceID;
  float selectedMaskValue = 0.0;
  if (u_selectedOverlayEnabled) {
    selectedMaskValue = texelFetch(
      u_selectedMask,
      ivec2(sourceIndex % u_selectedMaskWidth, sourceIndex / u_selectedMaskWidth),
      0
    ).r;
  }

  float xSpan = max(u_xRange.y - u_xRange.x, 0.000000001);
  float ySpan = max(u_yRange.y - u_yRange.x, 0.000000001);
  float clipX = ((a_x - u_xRange.x) / xSpan) * 2.0 - 1.0;
  float clipY = ((a_y - u_yRange.x) / ySpan) * 2.0 - 1.0;
  float selectedSizeBoost = u_selectedOverlayEnabled ? 1.65 : 1.0;
  float selectedOutlinePx = u_selectedOverlayEnabled ? 3.0 : 0.0;
  float sizePx = max(
    a_size * u_pointSizeScale * selectedSizeBoost * u_devicePixelRatio
      + selectedOutlinePx,
    1.0
  );
  vec2 glyphClipSize = vec2(
    (sizePx / max(u_viewportSizePx.x, 1.0)) * 2.0,
    (sizePx / max(u_viewportSizePx.y, 1.0)) * 2.0
  );
  bool culled =
    abs(clipX) > 1000000.0 ||
    abs(clipY) > 1000000.0 ||
    clipX < -1.0 - glyphClipSize.x ||
    clipX > 1.0 + glyphClipSize.x ||
    clipY < -1.0 - glyphClipSize.y ||
    clipY > 1.0 + glyphClipSize.y;
  float cosRotation = cos(a_rotation);
  float sinRotation = sin(a_rotation);
  mat2 rotation = mat2(cosRotation, sinRotation, -sinRotation, cosRotation);
  vec2 rotatedCorner = rotation * a_corner;

  vec4 baseColor = vec4(
    mix(a_color.rgb, u_themeColorMixColor, clamp(u_themeColorMixAmount, 0.0, 1.0)),
    a_color.a * clamp(a_opacity, 0.0, 1.0) * u_alphaScale * u_themeAlphaScaleMultiplier
      * u_opacityScale
  );
  if (u_selectedOverlayEnabled) {
    v_color = vec4(
      u_selectedOverlayColor.rgb,
      u_selectedOverlayColor.a * step(0.5, selectedMaskValue) * (culled ? 0.0 : 1.0)
    );
  } else {
    v_color = vec4(baseColor.rgb, baseColor.a * (culled ? 0.0 : 1.0));
  }
  v_shape = int(a_shape + 0.5);
  v_local = a_corner;
  gl_Position = culled
    ? vec4(2.0, 2.0, 0.0, 1.0)
    : vec4(vec2(clipX, clipY) + rotatedCorner * glyphClipSize, 0.0, 1.0);
}
`;

const POINT_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision mediump float;

in vec4 v_color;
flat in int v_shape;
in vec2 v_local;

out vec4 outColor;

void main() {
  bool visible = true;

  if (v_shape == 0) {
    visible = dot(v_local, v_local) <= 1.0;
  } else if (v_shape == 2) {
    visible = v_local.y >= -1.0 && v_local.y <= 1.0 - abs(v_local.x) * 2.0;
  } else if (v_shape == 3) {
    vec2 headLocal = vec2(v_local.x, v_local.y - 0.22);
    bool head = dot(headLocal, headLocal) <= 0.3844;
    bool point = v_local.y >= -1.0 && v_local.y <= -0.18
      && abs(v_local.x) <= (v_local.y + 1.0) * 0.39;
    visible = head || point;
  } else if (v_shape == 4) {
    bool shaft = v_local.y >= -1.0 && v_local.y <= 0.2 && abs(v_local.x) <= 0.28;
    bool head = v_local.y >= 0.0 && v_local.y <= 1.0
      && abs(v_local.x) <= (1.0 - v_local.y) * 0.82;
    visible = shaft || head;
  }

  if (!visible) {
    discard;
  }

  if (v_color.a <= 0.0) {
    discard;
  }

  outColor = v_color;
}
`;

const BUBBLE_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

in float a_x;
in float a_y;
in vec4 a_color;
in float a_radiusPx;
in float a_selectedFraction;
in float a_hovered;
in vec2 a_corner;

uniform vec2 u_xRange;
uniform vec2 u_yRange;
uniform float u_devicePixelRatio;
uniform float u_opacityScale;
uniform float u_themeAlphaScaleMultiplier;
uniform float u_themeColorMixAmount;
uniform vec3 u_themeColorMixColor;
uniform vec2 u_viewportSizePx;

out vec4 v_color;
out float v_hovered;
out float v_radiusPx;
out float v_selectedFraction;
out vec2 v_local;

void main() {
  float xSpan = max(u_xRange.y - u_xRange.x, 0.000000001);
  float ySpan = max(u_yRange.y - u_yRange.x, 0.000000001);
  float clipX = ((a_x - u_xRange.x) / xSpan) * 2.0 - 1.0;
  float clipY = ((a_y - u_yRange.x) / ySpan) * 2.0 - 1.0;
  float radiusPx = max(a_radiusPx * u_devicePixelRatio, 1.0);
  vec2 glyphClipSize = vec2(
    (radiusPx / max(u_viewportSizePx.x, 1.0)) * 2.0,
    (radiusPx / max(u_viewportSizePx.y, 1.0)) * 2.0
  );
  bool culled =
    abs(clipX) > 1000000.0 ||
    abs(clipY) > 1000000.0 ||
    clipX < -1.0 - glyphClipSize.x ||
    clipX > 1.0 + glyphClipSize.x ||
    clipY < -1.0 - glyphClipSize.y ||
    clipY > 1.0 + glyphClipSize.y;

  v_color = vec4(
    mix(a_color.rgb, u_themeColorMixColor, clamp(u_themeColorMixAmount, 0.0, 1.0)),
    a_color.a * clamp(u_themeAlphaScaleMultiplier * u_opacityScale, 0.0, 4.0)
      * (culled ? 0.0 : 1.0)
  );
  v_hovered = a_hovered;
  v_radiusPx = radiusPx;
  v_selectedFraction = clamp(a_selectedFraction, 0.0, 1.0);
  v_local = a_corner;

  gl_Position = culled
    ? vec4(2.0, 2.0, 0.0, 1.0)
    : vec4(vec2(clipX, clipY) + a_corner * glyphClipSize, 0.0, 1.0);
}
`;

const BUBBLE_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision mediump float;

uniform vec4 u_hoverOverlayColor;
uniform vec4 u_selectedOverlayColor;

in vec4 v_color;
in float v_hovered;
in float v_radiusPx;
in float v_selectedFraction;
in vec2 v_local;

out vec4 outColor;

void main() {
  float distanceFromCenter = length(v_local);
  if (distanceFromCenter > 1.0 || v_color.a <= 0.0) {
    discard;
  }

  float edgeSoftness = max(0.75 / max(v_radiusPx, 1.0), 0.0025);
  float fillMask = 1.0 - smoothstep(1.0 - edgeSoftness, 1.0, distanceFromCenter);
  vec4 color = vec4(v_color.rgb, v_color.a * fillMask);

  if (v_selectedFraction > 0.0) {
    color.rgb = mix(
      color.rgb,
      u_selectedOverlayColor.rgb,
      min(0.25, 0.08 + v_selectedFraction * 0.22)
    );
  }

  float selectedRingPx = v_selectedFraction > 0.0
    ? min(4.0, 1.25 + v_selectedFraction * 2.75)
    : 0.0;
  float hoverRingPx = v_hovered > 0.5
    ? min(5.0, max(2.0, v_radiusPx * 0.14))
    : 0.0;
  float selectedThreshold = 1.0 - (selectedRingPx / max(v_radiusPx, 1.0));
  float hoverThreshold = 1.0 - (hoverRingPx / max(v_radiusPx, 1.0));
  float selectedRingMask = v_selectedFraction > 0.0
    ? smoothstep(selectedThreshold, min(1.0, selectedThreshold + edgeSoftness * 3.0), distanceFromCenter)
    : 0.0;
  float hoverRingMask = v_hovered > 0.5
    ? smoothstep(hoverThreshold, min(1.0, hoverThreshold + edgeSoftness * 3.0), distanceFromCenter)
    : 0.0;

  if (selectedRingMask > 0.0) {
    vec4 selectedColor = vec4(
      u_selectedOverlayColor.rgb,
      u_selectedOverlayColor.a * min(1.0, 0.45 + v_selectedFraction * 0.55)
    );
    color = mix(color, selectedColor, selectedRingMask);
  }

  if (hoverRingMask > 0.0) {
    color = mix(color, u_hoverOverlayColor, hoverRingMask);
  }

  if (color.a <= 0.0) {
    discard;
  }

  outColor = color;
}
`;

const HEATMAP_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

in float a_centerX;
in float a_centerY;
in vec4 a_color;
in float a_halfWidthAxis;
in float a_halfHeightAxis;
in float a_selectedFraction;
in float a_hovered;
in vec2 a_corner;

uniform vec2 u_xRange;
uniform vec2 u_yRange;

out vec4 v_color;
out float v_hovered;
out float v_selectedFraction;
out vec2 v_local;

void main() {
  float xSpan = max(u_xRange.y - u_xRange.x, 0.000000001);
  float ySpan = max(u_yRange.y - u_yRange.x, 0.000000001);
  float clipX = ((a_centerX - u_xRange.x) / xSpan) * 2.0 - 1.0;
  float clipY = ((a_centerY - u_yRange.x) / ySpan) * 2.0 - 1.0;
  float clipHalfWidth = (a_halfWidthAxis / xSpan) * 2.0;
  float clipHalfHeight = (a_halfHeightAxis / ySpan) * 2.0;

  v_color = a_color;
  v_hovered = a_hovered;
  v_selectedFraction = clamp(a_selectedFraction, 0.0, 1.0);
  v_local = a_corner;

  gl_Position = vec4(
    clipX + a_corner.x * clipHalfWidth,
    clipY + a_corner.y * clipHalfHeight,
    0.0,
    1.0
  );
}
`;

const HEATMAP_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision mediump float;

uniform float u_borderAlpha;
uniform vec4 u_borderColor;
uniform vec2 u_cellSizePx;
uniform vec4 u_hoverOverlayColor;
uniform float u_opacityScale;
uniform vec4 u_selectedOverlayColor;

in vec4 v_color;
in float v_hovered;
in float v_selectedFraction;
in vec2 v_local;

out vec4 outColor;

void main() {
  if (abs(v_local.x) > 1.0 || abs(v_local.y) > 1.0 || v_color.a <= 0.0) {
    discard;
  }

  vec4 color = vec4(v_color.rgb, clamp(v_color.a * u_opacityScale, 0.0, 1.0));

  if (v_selectedFraction > 0.0) {
    color.rgb = mix(
      color.rgb,
      u_selectedOverlayColor.rgb,
      min(0.26, 0.08 + v_selectedFraction * 0.24)
    );
  }

  float minHalfSizePx = max(1.0, min(u_cellSizePx.x, u_cellSizePx.y) * 0.5);
  float selectedRingPx = v_selectedFraction > 0.0
    ? min(4.0, 1.0 + v_selectedFraction * 3.0)
    : 0.0;
  float hoverRingPx = v_hovered > 0.5 ? 3.0 : 0.0;
  float selectedThreshold = 1.0 - (selectedRingPx / minHalfSizePx);
  float hoverThreshold = 1.0 - (hoverRingPx / minHalfSizePx);
  float selectedRingMask = v_selectedFraction > 0.0
    ? smoothstep(selectedThreshold, min(1.0, selectedThreshold + 0.06), max(abs(v_local.x), abs(v_local.y)))
    : 0.0;
  float hoverRingMask = v_hovered > 0.5
    ? smoothstep(hoverThreshold, min(1.0, hoverThreshold + 0.06), max(abs(v_local.x), abs(v_local.y)))
    : 0.0;

  if (u_borderAlpha > 0.0) {
    float borderThresholdX = 1.0 - (2.0 / max(u_cellSizePx.x, 1.0));
    float borderThresholdY = 1.0 - (2.0 / max(u_cellSizePx.y, 1.0));
    float borderMask = max(
      smoothstep(borderThresholdX, min(1.0, borderThresholdX + 0.08), abs(v_local.x)),
      smoothstep(borderThresholdY, min(1.0, borderThresholdY + 0.08), abs(v_local.y))
    );
    color = mix(color, vec4(u_borderColor.rgb, max(color.a, u_borderColor.a)), borderMask * u_borderAlpha);
  }

  if (selectedRingMask > 0.0) {
    color = mix(color, u_selectedOverlayColor, selectedRingMask);
  }

  if (hoverRingMask > 0.0) {
    color = mix(color, u_hoverOverlayColor, hoverRingMask);
  }

  if (color.a <= 0.0) {
    discard;
  }

  outColor = color;
}
`;

export function createFastScatterPointProgram(
  gl: WebGL2RenderingContext,
): FastScatterPointProgram {
  const createdProgram = createProgram(
    gl,
    POINT_VERTEX_SHADER_SOURCE,
    POINT_FRAGMENT_SHADER_SOURCE,
  );
  const { metrics, program } = createdProgram;
  const cornerLocation = gl.getAttribLocation(program, 'a_corner');
  const xLocation = gl.getAttribLocation(program, 'a_x');
  const yLocation = gl.getAttribLocation(program, 'a_y');
  const colorLocation = gl.getAttribLocation(program, 'a_color');
  const opacityLocation = gl.getAttribLocation(program, 'a_opacity');
  const rotationLocation = gl.getAttribLocation(program, 'a_rotation');
  const shapeLocation = gl.getAttribLocation(program, 'a_shape');
  const sizeLocation = gl.getAttribLocation(program, 'a_size');
  const xRangeLocation = gl.getUniformLocation(program, 'u_xRange');
  const yRangeLocation = gl.getUniformLocation(program, 'u_yRange');
  const alphaScaleLocation = gl.getUniformLocation(program, 'u_alphaScale');
  const devicePixelRatioLocation = gl.getUniformLocation(program, 'u_devicePixelRatio');
  const selectedMaskLocation = gl.getUniformLocation(program, 'u_selectedMask');
  const selectedMaskWidthLocation = gl.getUniformLocation(program, 'u_selectedMaskWidth');
  const selectedOverlayColorLocation = gl.getUniformLocation(program, 'u_selectedOverlayColor');
  const selectedOverlayEnabledLocation = gl.getUniformLocation(program, 'u_selectedOverlayEnabled');
  const opacityScaleLocation = gl.getUniformLocation(program, 'u_opacityScale');
  const themeAlphaScaleMultiplierLocation = gl.getUniformLocation(program, 'u_themeAlphaScaleMultiplier');
  const themeColorMixAmountLocation = gl.getUniformLocation(program, 'u_themeColorMixAmount');
  const themeColorMixColorLocation = gl.getUniformLocation(program, 'u_themeColorMixColor');
  const pointSizeScaleLocation = gl.getUniformLocation(program, 'u_pointSizeScale');
  const viewportSizePxLocation = gl.getUniformLocation(program, 'u_viewportSizePx');

  if (
    cornerLocation < 0 ||
    xLocation < 0 ||
    yLocation < 0 ||
    colorLocation < 0 ||
    opacityLocation < 0 ||
    rotationLocation < 0 ||
    shapeLocation < 0 ||
    sizeLocation < 0 ||
    xRangeLocation === null ||
    yRangeLocation === null ||
    alphaScaleLocation === null ||
    devicePixelRatioLocation === null ||
    selectedMaskLocation === null ||
    selectedMaskWidthLocation === null ||
    selectedOverlayColorLocation === null ||
    selectedOverlayEnabledLocation === null ||
    opacityScaleLocation === null ||
    themeAlphaScaleMultiplierLocation === null ||
    themeColorMixAmountLocation === null ||
    themeColorMixColorLocation === null ||
    pointSizeScaleLocation === null ||
    viewportSizePxLocation === null
  ) {
    gl.deleteProgram(program);
    throw new Error('Fast scatter WebGL2 point shader bindings could not be resolved.');
  }

  return {
    attributes: {
      color: colorLocation,
      corner: cornerLocation,
      opacity: opacityLocation,
      rotation: rotationLocation,
      shape: shapeLocation,
      size: sizeLocation,
      x: xLocation,
      y: yLocation,
    },
    metrics,
    program,
    uniforms: {
      alphaScale: alphaScaleLocation,
      devicePixelRatio: devicePixelRatioLocation,
      selectedMask: selectedMaskLocation,
      selectedMaskWidth: selectedMaskWidthLocation,
      selectedOverlayColor: selectedOverlayColorLocation,
      selectedOverlayEnabled: selectedOverlayEnabledLocation,
      opacityScale: opacityScaleLocation,
      themeAlphaScaleMultiplier: themeAlphaScaleMultiplierLocation,
      themeColorMixAmount: themeColorMixAmountLocation,
      themeColorMixColor: themeColorMixColorLocation,
      pointSizeScale: pointSizeScaleLocation,
      viewportSizePx: viewportSizePxLocation,
      xRange: xRangeLocation,
      yRange: yRangeLocation,
    },
  };
}

export function createFastScatterBubbleProgram(
  gl: WebGL2RenderingContext,
): FastScatterBubbleProgram {
  const createdProgram = createProgram(
    gl,
    BUBBLE_VERTEX_SHADER_SOURCE,
    BUBBLE_FRAGMENT_SHADER_SOURCE,
  );
  const { metrics, program } = createdProgram;
  const cornerLocation = gl.getAttribLocation(program, 'a_corner');
  const xLocation = gl.getAttribLocation(program, 'a_x');
  const yLocation = gl.getAttribLocation(program, 'a_y');
  const colorLocation = gl.getAttribLocation(program, 'a_color');
  const radiusPxLocation = gl.getAttribLocation(program, 'a_radiusPx');
  const selectedFractionLocation = gl.getAttribLocation(program, 'a_selectedFraction');
  const hoveredLocation = gl.getAttribLocation(program, 'a_hovered');
  const xRangeLocation = gl.getUniformLocation(program, 'u_xRange');
  const yRangeLocation = gl.getUniformLocation(program, 'u_yRange');
  const devicePixelRatioLocation = gl.getUniformLocation(program, 'u_devicePixelRatio');
  const hoverOverlayColorLocation = gl.getUniformLocation(program, 'u_hoverOverlayColor');
  const opacityScaleLocation = gl.getUniformLocation(program, 'u_opacityScale');
  const selectedOverlayColorLocation = gl.getUniformLocation(program, 'u_selectedOverlayColor');
  const themeAlphaScaleMultiplierLocation = gl.getUniformLocation(program, 'u_themeAlphaScaleMultiplier');
  const themeColorMixAmountLocation = gl.getUniformLocation(program, 'u_themeColorMixAmount');
  const themeColorMixColorLocation = gl.getUniformLocation(program, 'u_themeColorMixColor');
  const viewportSizePxLocation = gl.getUniformLocation(program, 'u_viewportSizePx');

  if (
    cornerLocation < 0 ||
    xLocation < 0 ||
    yLocation < 0 ||
    colorLocation < 0 ||
    radiusPxLocation < 0 ||
    selectedFractionLocation < 0 ||
    hoveredLocation < 0 ||
    xRangeLocation === null ||
    yRangeLocation === null ||
    devicePixelRatioLocation === null ||
    hoverOverlayColorLocation === null ||
    opacityScaleLocation === null ||
    selectedOverlayColorLocation === null ||
    themeAlphaScaleMultiplierLocation === null ||
    themeColorMixAmountLocation === null ||
    themeColorMixColorLocation === null ||
    viewportSizePxLocation === null
  ) {
    gl.deleteProgram(program);
    throw new Error('Fast scatter WebGL2 bubble shader bindings could not be resolved.');
  }

  return {
    attributes: {
      color: colorLocation,
      corner: cornerLocation,
      hovered: hoveredLocation,
      radiusPx: radiusPxLocation,
      selectedFraction: selectedFractionLocation,
      x: xLocation,
      y: yLocation,
    },
    metrics,
    program,
    uniforms: {
      devicePixelRatio: devicePixelRatioLocation,
      hoverOverlayColor: hoverOverlayColorLocation,
      opacityScale: opacityScaleLocation,
      selectedOverlayColor: selectedOverlayColorLocation,
      themeAlphaScaleMultiplier: themeAlphaScaleMultiplierLocation,
      themeColorMixAmount: themeColorMixAmountLocation,
      themeColorMixColor: themeColorMixColorLocation,
      viewportSizePx: viewportSizePxLocation,
      xRange: xRangeLocation,
      yRange: yRangeLocation,
    },
  };
}

export function createFastScatterHeatmapProgram(
  gl: WebGL2RenderingContext,
): FastScatterHeatmapProgram {
  const createdProgram = createProgram(
    gl,
    HEATMAP_VERTEX_SHADER_SOURCE,
    HEATMAP_FRAGMENT_SHADER_SOURCE,
  );
  const { metrics, program } = createdProgram;
  const cornerLocation = gl.getAttribLocation(program, 'a_corner');
  const centerXLocation = gl.getAttribLocation(program, 'a_centerX');
  const centerYLocation = gl.getAttribLocation(program, 'a_centerY');
  const colorLocation = gl.getAttribLocation(program, 'a_color');
  const halfWidthAxisLocation = gl.getAttribLocation(program, 'a_halfWidthAxis');
  const halfHeightAxisLocation = gl.getAttribLocation(program, 'a_halfHeightAxis');
  const selectedFractionLocation = gl.getAttribLocation(program, 'a_selectedFraction');
  const hoveredLocation = gl.getAttribLocation(program, 'a_hovered');
  const borderAlphaLocation = gl.getUniformLocation(program, 'u_borderAlpha');
  const borderColorLocation = gl.getUniformLocation(program, 'u_borderColor');
  const cellSizePxLocation = gl.getUniformLocation(program, 'u_cellSizePx');
  const hoverOverlayColorLocation = gl.getUniformLocation(program, 'u_hoverOverlayColor');
  const opacityScaleLocation = gl.getUniformLocation(program, 'u_opacityScale');
  const selectedOverlayColorLocation = gl.getUniformLocation(program, 'u_selectedOverlayColor');
  const xRangeLocation = gl.getUniformLocation(program, 'u_xRange');
  const yRangeLocation = gl.getUniformLocation(program, 'u_yRange');

  if (
    cornerLocation < 0 ||
    centerXLocation < 0 ||
    centerYLocation < 0 ||
    colorLocation < 0 ||
    halfWidthAxisLocation < 0 ||
    halfHeightAxisLocation < 0 ||
    selectedFractionLocation < 0 ||
    hoveredLocation < 0 ||
    borderAlphaLocation === null ||
    borderColorLocation === null ||
    cellSizePxLocation === null ||
    hoverOverlayColorLocation === null ||
    opacityScaleLocation === null ||
    selectedOverlayColorLocation === null ||
    xRangeLocation === null ||
    yRangeLocation === null
  ) {
    gl.deleteProgram(program);
    throw new Error('Fast scatter WebGL2 heat-map shader bindings could not be resolved.');
  }

  return {
    attributes: {
      centerX: centerXLocation,
      centerY: centerYLocation,
      color: colorLocation,
      corner: cornerLocation,
      halfHeightAxis: halfHeightAxisLocation,
      halfWidthAxis: halfWidthAxisLocation,
      hovered: hoveredLocation,
      selectedFraction: selectedFractionLocation,
    },
    metrics,
    program,
    uniforms: {
      borderAlpha: borderAlphaLocation,
      borderColor: borderColorLocation,
      cellSizePx: cellSizePxLocation,
      hoverOverlayColor: hoverOverlayColorLocation,
      opacityScale: opacityScaleLocation,
      selectedOverlayColor: selectedOverlayColorLocation,
      xRange: xRangeLocation,
      yRange: yRangeLocation,
    },
  };
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): { metrics: FastScatterProgramMetrics; program: WebGLProgram } {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();

  if (program === null) {
    gl.deleteShader(vertexShader.shader);
    gl.deleteShader(fragmentShader.shader);
    throw new Error('Fast scatter WebGL2 point program could not be allocated.');
  }

  gl.attachShader(program, vertexShader.shader);
  gl.attachShader(program, fragmentShader.shader);
  const linkStartedAt = performance.now();
  gl.linkProgram(program);
  const linkMs = performance.now() - linkStartedAt;
  gl.deleteShader(vertexShader.shader);
  gl.deleteShader(fragmentShader.shader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) ?? 'no linker log available';
    gl.deleteProgram(program);
    throw new Error(`Fast scatter WebGL2 point program failed to link: ${info}`);
  }

  return {
    metrics: {
      fragmentCompileMs: fragmentShader.compileMs,
      linkMs,
      shaderCompileMs: vertexShader.compileMs + fragmentShader.compileMs,
      vertexCompileMs: vertexShader.compileMs,
    },
    program,
  };
}

function createShader(
  gl: WebGL2RenderingContext,
  shaderType: number,
  source: string,
): { compileMs: number; shader: WebGLShader } {
  const shader = gl.createShader(shaderType);

  if (shader === null) {
    throw new Error('Fast scatter WebGL2 point shader could not be allocated.');
  }

  gl.shaderSource(shader, source);
  const compileStartedAt = performance.now();
  gl.compileShader(shader);
  const compileMs = performance.now() - compileStartedAt;

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) ?? 'no compiler log available';
    gl.deleteShader(shader);
    throw new Error(`Fast scatter WebGL2 point shader failed to compile: ${info}`);
  }

  return { compileMs, shader };
}
