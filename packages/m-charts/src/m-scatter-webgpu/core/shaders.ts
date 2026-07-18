export const FAST_SCATTER_WEBGPU_SHADER = /* wgsl */ `
struct RenderUniforms {
  ranges: vec4f,
  canvasAndOrigin: vec4f,
  plotAndScales: vec4f,
  alpha: vec4f,
  mixColor: vec4f,
  selectedColor: vec4f,
  flags: vec4u,
  subplotColor: vec4f,
};

struct PackedStyle {
  packed: u32,
};

@group(0) @binding(0) var<uniform> uniforms: RenderUniforms;
@group(0) @binding(1) var<storage, read> xValues: array<f32>;
@group(0) @binding(2) var<storage, read> yValues: array<u32>;
@group(0) @binding(3) var<storage, read> styles: array<PackedStyle>;
@group(0) @binding(4) var<storage, read> selectedIndices: array<u32>;
@group(0) @binding(5) var<storage, read> rotationVectors: array<vec2f>;
@group(0) @binding(6) var<storage, read> stylesHigh: array<PackedStyle>;
@group(0) @binding(7) var<storage, read> selectedMembership: array<u32>;

override STYLE_MODE: u32 = 0u;
override X_STORAGE_MODE: u32 = 0u;
override STYLE_SPLIT_POINT: u32 = 0xffffffffu;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
  @location(1) local: vec2f,
  @location(2) @interpolate(flat) shape: u32,
};

fn decodeRotationVector(packedMeta: u32) -> vec2f {
  let rotation = (packedMeta >> 23u) & 0x3fu;
  return rotationVectors[(rotation * 1023u) / 63u];
}

fn decodePointSize(packedMeta: u32) -> f32 {
  return 1.0 + f32((packedMeta >> 29u) & 0x7u);
}

fn decodeRgb565(packedMeta: u32) -> vec4f {
  return vec4f(
    f32(packedMeta & 0x1fu) / 31.0,
    f32((packedMeta >> 5u) & 0x3fu) / 63.0,
    f32((packedMeta >> 11u) & 0x1fu) / 31.0,
    1.0,
  );
}

fn readY(pointIndex: u32) -> f32 {
  let yStorageMode = (uniforms.flags.z >> 28u) & 0x3u;
  if (yStorageMode == 1u) {
    let packed = yValues[pointIndex >> 2u];
    return f32((packed >> ((pointIndex & 3u) * 8u)) & 0xffu);
  }
  if (yStorageMode == 2u) {
    let packed = yValues[pointIndex >> 1u];
    return f32((packed >> ((pointIndex & 1u) * 16u)) & 0xffffu);
  }
  return bitcast<f32>(yValues[pointIndex]);
}

fn readX(pointIndex: u32) -> f32 {
  if (X_STORAGE_MODE == 1u) {
    return f32(i32(pointIndex) - i32(uniforms.flags.w));
  }
  if (X_STORAGE_MODE == 2u) {
    let blockStart = (pointIndex / 24u) * 24u;
    let offset = pointIndex - blockStart;
    if (offset >= 2u && offset < 5u) {
      return f32(i32(blockStart + 2u) - i32(uniforms.flags.w));
    }
    if (offset >= 14u && offset < 16u) {
      return f32(i32(blockStart + 14u) - i32(uniforms.flags.w));
    }
    return f32(i32(pointIndex) - i32(uniforms.flags.w));
  }
  return xValues[pointIndex];
}

fn lodBucketOffset(pointBase: u32, instanceIndex: u32, stride: u32) -> u32 {
  if (stride <= 1u) {
    return 0u;
  }
  let bucketIndex = pointBase / stride + instanceIndex;
  var value = bucketIndex * 747796405u + 2891336453u;
  value = ((value >> ((value >> 28u) + 4u)) ^ value) * 277803737u;
  value = (value >> 22u) ^ value;
  return value % stride;
}

@vertex
fn pointVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOutput {
  let indexedPass = (uniforms.flags.z & 0x40000000u) != 0u;
  let selectedPass = (uniforms.flags.z & 0x80000000u) != 0u;
  let pointStride = max(uniforms.flags.y, 1u);
  var pointIndex = uniforms.flags.x + instanceIndex * pointStride +
    lodBucketOffset(uniforms.flags.x, instanceIndex, pointStride);
  if (indexedPass) {
    pointIndex = selectedIndices[instanceIndex];
  }
  let selectedVisible = !selectedPass ||
    (selectedMembership[pointIndex >> 5u] & (1u << (pointIndex & 31u))) != 0u;
  let indexedStyle = STYLE_MODE == 2u;
  let styleIndex = select(pointIndex, 0u, STYLE_MODE != 0u);
  var style: PackedStyle;
  if (styleIndex < STYLE_SPLIT_POINT) {
    style = styles[styleIndex];
  } else {
    style = stylesHigh[styleIndex - STYLE_SPLIT_POINT];
  }
  var rawColor = decodeRgb565(style.packed);
  var opacity = f32((style.packed >> 16u) & 0xfu) / 15.0;
  var shape = (style.packed >> 20u) & 0x7u;
  var rotationVector = decodeRotationVector(style.packed);
  var pointSize = decodePointSize(style.packed);
  if (indexedStyle) {
    rawColor = vec4f(
      f32(35u + (pointIndex * 17u) % 190u) / 255.0,
      f32(55u + (pointIndex * 29u) % 170u) / 255.0,
      f32(75u + (pointIndex * 43u) % 160u) / 255.0,
      235.0 / 255.0,
    );
    opacity = 0.36 + f32(pointIndex % 5u) * 0.13;
    shape = pointIndex % 5u;
    let indexedRotation = f32(pointIndex % 360u) / 180.0 * 3.141592653589793;
    rotationVector = vec2f(cos(indexedRotation), sin(indexedRotation));
    pointSize = 2.0 + f32(pointIndex % 7u) * 0.5;
  }

  let xRange = uniforms.ranges.xy;
  let yRange = uniforms.ranges.zw;
  let xSpan = max(xRange.y - xRange.x, 1e-12);
  let ySpan = max(yRange.y - yRange.x, 1e-12);
  let rawX = readX(pointIndex);
  let normalizedX = (rawX - xRange.x) / xSpan;
  let normalizedY = (readY(pointIndex) - yRange.x) / ySpan;
  let canvasSize = max(uniforms.canvasAndOrigin.xy, vec2f(1.0));
  let plotOrigin = uniforms.canvasAndOrigin.zw;
  let plotSize = uniforms.plotAndScales.xy;
  let devicePixelRatio = uniforms.plotAndScales.z;
  let userPointScale = uniforms.plotAndScales.w;
  let selectedSizeBoost = select(1.0, 1.65, selectedPass);
  let selectedOutlinePx = select(0.0, 3.0, selectedPass);
  let sizePx = max(
    pointSize * userPointScale * selectedSizeBoost * devicePixelRatio + selectedOutlinePx,
    1.0,
  );

  let corners = array<vec2f, 4>(
    vec2f(-1.0, -1.0),
    vec2f( 1.0, -1.0),
    vec2f(-1.0,  1.0),
    vec2f( 1.0,  1.0),
  );
  let corner = corners[vertexIndex];
  let c = rotationVector.x;
  let s = rotationVector.y;
  let rotatedCorner = vec2f(c * corner.x - s * corner.y, s * corner.x + c * corner.y);
  let centerPx = vec2f(
    plotOrigin.x + normalizedX * plotSize.x,
    plotOrigin.y + (1.0 - normalizedY) * plotSize.y,
  );
  let positionPx = centerPx + rotatedCorner * sizePx;
  let clip = vec2f(
    positionPx.x / canvasSize.x * 2.0 - 1.0,
    1.0 - positionPx.y / canvasSize.y * 2.0,
  );
  let invalid =
    normalizedX != normalizedX || normalizedY != normalizedY ||
    abs(normalizedX) > 1e20 || abs(normalizedY) > 1e20;
  let normalizedPadding = vec2f(
    sizePx / max(plotSize.x, 1.0),
    sizePx / max(plotSize.y, 1.0),
  );
  let culled =
    invalid || !selectedVisible ||
    normalizedX < -normalizedPadding.x || normalizedX > 1.0 + normalizedPadding.x ||
    normalizedY < -normalizedPadding.y || normalizedY > 1.0 + normalizedPadding.y;

  let mixedColor = mix(rawColor.rgb, uniforms.mixColor.rgb, clamp(uniforms.alpha.w, 0.0, 1.0));
  let sourceAlpha = clamp(
    rawColor.a * opacity * uniforms.alpha.x * uniforms.alpha.y * uniforms.alpha.z,
    0.0,
    1.0,
  );
  let alphaWeight = f32(max(uniforms.flags.z & 0x07ffffffu, 1u));
  let baseAlpha = 1.0 - pow(max(0.0, 1.0 - sourceAlpha), alphaWeight);
  var output: VertexOutput;
  output.position = select(vec4f(clip, 0.0, 1.0), vec4f(2.0, 2.0, 0.0, 1.0), culled);
  output.color = select(
    vec4f(mixedColor, baseAlpha),
    uniforms.selectedColor,
    selectedPass,
  );
  output.local = corner;
  output.shape = shape;
  return output;
}

@fragment
fn pointFragment(input: VertexOutput) -> @location(0) vec4f {
  var visible = true;
  if (input.shape == 0u) {
    visible = dot(input.local, input.local) <= 1.0;
  } else if (input.shape == 2u) {
    visible = input.local.y >= -1.0 && input.local.y <= 1.0 - abs(input.local.x) * 2.0;
  } else if (input.shape == 3u) {
    let headLocal = vec2f(input.local.x, input.local.y - 0.22);
    let head = dot(headLocal, headLocal) <= 0.3844;
    let point = input.local.y >= -1.0 && input.local.y <= -0.18 &&
      abs(input.local.x) <= (input.local.y + 1.0) * 0.39;
    visible = head || point;
  } else if (input.shape == 4u) {
    let shaft = input.local.y >= -1.0 && input.local.y <= 0.2 && abs(input.local.x) <= 0.28;
    let head = input.local.y >= 0.0 && input.local.y <= 1.0 &&
      abs(input.local.x) <= (1.0 - input.local.y) * 0.82;
    visible = shaft || head;
  }
  if (!visible || input.color.a <= 0.0) {
    discard;
  }
  return input.color;
}

struct BackgroundOutput {
  @builtin(position) position: vec4f,
};

@vertex
fn backgroundVertex(@builtin(vertex_index) vertexIndex: u32) -> BackgroundOutput {
  let positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0),
  );
  var output: BackgroundOutput;
  output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  return output;
}

@fragment
fn backgroundFragment() -> @location(0) vec4f {
  return uniforms.subplotColor;
}
`;

export const FAST_SCATTER_WEBGPU_COMPOSITE_SHADER = /* wgsl */ `
struct CompositeUniforms {
  currentRanges: vec4f,
  cachedRanges: vec4f,
  canvasAndOrigin: vec4f,
  plotAndPadding: vec4f,
  subplotColor: vec4f,
  interaction: vec4f,
  cacheCanvasAndOrigin: vec4f,
  cachePlotSize: vec4f,
};

@group(0) @binding(0) var compositeSampler: sampler;
@group(0) @binding(1) var cachedFrame: texture_2d<f32>;
@group(0) @binding(2) var<uniform> uniforms: CompositeUniforms;

struct CompositeOutput {
  @builtin(position) position: vec4f,
  @location(0) sourceUv: vec2f,
  @location(1) @interpolate(flat) validMin: vec2f,
  @location(2) @interpolate(flat) validMax: vec2f,
};

@vertex
fn compositeVertex(@builtin(vertex_index) vertexIndex: u32) -> CompositeOutput {
  let corners = array<vec2f, 4>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0),
    vec2f(0.0, 1.0), vec2f(1.0, 1.0),
  );
  let corner = corners[vertexIndex];
  let canvasSize = max(uniforms.canvasAndOrigin.xy, vec2f(1.0));
  let plotOrigin = uniforms.canvasAndOrigin.zw;
  let plotSize = uniforms.plotAndPadding.xy;
  let currentX = mix(uniforms.currentRanges.x, uniforms.currentRanges.y, corner.x);
  let currentY = mix(uniforms.currentRanges.w, uniforms.currentRanges.z, corner.y);
  let cachedXSpan = max(uniforms.cachedRanges.y - uniforms.cachedRanges.x, 1e-12);
  let cachedYSpan = max(uniforms.cachedRanges.w - uniforms.cachedRanges.z, 1e-12);
  let cachedNormalized = vec2f(
    (currentX - uniforms.cachedRanges.x) / cachedXSpan,
    (currentY - uniforms.cachedRanges.z) / cachedYSpan,
  );
  let destinationPx = plotOrigin + corner * plotSize;
  let sourcePx = vec2f(
    uniforms.cacheCanvasAndOrigin.z + cachedNormalized.x * uniforms.cachePlotSize.x,
    uniforms.cacheCanvasAndOrigin.w + (1.0 - cachedNormalized.y) * uniforms.cachePlotSize.y,
  );
  var output: CompositeOutput;
  output.position = vec4f(
    destinationPx.x / canvasSize.x * 2.0 - 1.0,
    1.0 - destinationPx.y / canvasSize.y * 2.0,
    0.0,
    1.0,
  );
  let cacheCanvasSize = max(uniforms.cacheCanvasAndOrigin.xy, vec2f(1.0));
  let cachePlotOrigin = uniforms.cacheCanvasAndOrigin.zw;
  output.sourceUv = sourcePx / cacheCanvasSize;
  output.validMin = cachePlotOrigin / cacheCanvasSize;
  output.validMax = (cachePlotOrigin + uniforms.cachePlotSize.xy) / cacheCanvasSize;
  return output;
}

@fragment
fn compositeFragment(input: CompositeOutput) -> @location(0) vec4f {
  let valid = all(input.sourceUv >= input.validMin) && all(input.sourceUv <= input.validMax);
  let sourceUv = clamp(input.sourceUv, input.validMin, input.validMax);
  let sampled = textureSample(cachedFrame, compositeSampler, sourceUv);
  return select(uniforms.subplotColor, sampled, valid);
}
`;

export const FAST_SCATTER_WEBGPU_AGGREGATE_SHADER = /* wgsl */ `
struct AggregateUniforms {
  ranges: vec4f,
  canvasAndOrigin: vec4f,
  plotAndScale: vec4f,
  selectedColor: vec4f,
  hoverColor: vec4f,
  themeMix: vec4f,
  borderColor: vec4f,
  params: vec4f,
  cellSize: vec4f,
};

struct AggregateInstance {
  center: vec2f,
  extent: vec2f,
  packedColor: u32,
  selectedFraction: f32,
  hovered: f32,
  _padding: u32,
};

@group(0) @binding(0) var<uniform> uniforms: AggregateUniforms;
@group(0) @binding(1) var<storage, read> instances: array<AggregateInstance>;

struct AggregateVertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
  @location(1) local: vec2f,
  @location(2) selectedFraction: f32,
  @location(3) hovered: f32,
  @location(4) radiusOrMinHalfSizePx: f32,
};

fn decodeRgba8(packed: u32) -> vec4f {
  return vec4f(
    f32(packed & 0xffu) / 255.0,
    f32((packed >> 8u) & 0xffu) / 255.0,
    f32((packed >> 16u) & 0xffu) / 255.0,
    f32((packed >> 24u) & 0xffu) / 255.0,
  );
}

@vertex
fn aggregateVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> AggregateVertexOutput {
  let instance = instances[instanceIndex];
  let corners = array<vec2f, 4>(
    vec2f(-1.0, -1.0),
    vec2f( 1.0, -1.0),
    vec2f(-1.0,  1.0),
    vec2f( 1.0,  1.0),
  );
  let corner = corners[vertexIndex];
  let xSpan = max(uniforms.ranges.y - uniforms.ranges.x, 1e-12);
  let ySpan = max(uniforms.ranges.w - uniforms.ranges.z, 1e-12);
  let canvasSize = max(uniforms.canvasAndOrigin.xy, vec2f(1.0));
  let plotOrigin = uniforms.canvasAndOrigin.zw;
  let plotSize = max(uniforms.plotAndScale.xy, vec2f(1.0));
  let bubbleMode = uniforms.params.x < 0.5;
  let pointMode = uniforms.params.x > 1.5;
  let roundMode = bubbleMode || pointMode;
  let centerPx = vec2f(
    plotOrigin.x + ((instance.center.x - uniforms.ranges.x) / xSpan) * plotSize.x,
    plotOrigin.y + (1.0 - (instance.center.y - uniforms.ranges.z) / ySpan) * plotSize.y,
  );
  var halfSizePx: vec2f;
  if (roundMode) {
    halfSizePx = instance.extent.xx * uniforms.plotAndScale.zw * uniforms.cellSize.z;
  } else {
    halfSizePx = vec2f(
      (instance.extent.x / xSpan) * plotSize.x,
      (instance.extent.y / ySpan) * plotSize.y,
    );
  }
  let positionPx = centerPx + corner * halfSizePx;
  let clip = vec2f(
    positionPx.x / canvasSize.x * 2.0 - 1.0,
    1.0 - positionPx.y / canvasSize.y * 2.0,
  );
  let rawColor = select(decodeRgba8(instance.packedColor), uniforms.borderColor, bubbleMode);
  let mixedRgb = select(
    rawColor.rgb,
    mix(rawColor.rgb, uniforms.themeMix.rgb, clamp(uniforms.themeMix.a, 0.0, 1.0)),
    bubbleMode,
  );
  let themeAlpha = select(1.0, uniforms.params.w, bubbleMode);
  var output: AggregateVertexOutput;
  output.position = vec4f(clip, 0.0, 1.0);
  output.color = vec4f(mixedRgb, rawColor.a * uniforms.params.z * themeAlpha);
  output.local = corner;
  output.selectedFraction = clamp(instance.selectedFraction, 0.0, 1.0);
  output.hovered = instance.hovered;
  output.radiusOrMinHalfSizePx = select(
    max(1.0, min(halfSizePx.x, halfSizePx.y)),
    max(1.0, instance.extent.x * min(uniforms.plotAndScale.z, uniforms.plotAndScale.w) * uniforms.cellSize.z),
    roundMode,
  );
  return output;
}

@fragment
fn aggregateFragment(input: AggregateVertexOutput) -> @location(0) vec4f {
  let bubbleMode = uniforms.params.x < 0.5;
  let pointMode = uniforms.params.x > 1.5;
  let roundMode = bubbleMode || pointMode;
  let distanceFromCenter = select(
    max(abs(input.local.x), abs(input.local.y)),
    length(input.local),
    roundMode,
  );
  if (distanceFromCenter > 1.0 || input.color.a <= 0.0) {
    discard;
  }

  let edgeSoftness = select(
    0.06,
    max(0.75 / input.radiusOrMinHalfSizePx, 0.0025),
    roundMode,
  );
  let fillMask = select(
    1.0,
    1.0 - smoothstep(1.0 - edgeSoftness, 1.0, distanceFromCenter),
    roundMode,
  );
  var color = vec4f(input.color.rgb, clamp(input.color.a * fillMask, 0.0, 1.0));
  if (input.selectedFraction > 0.0) {
    let selectedMix = select(
      min(0.26, 0.08 + input.selectedFraction * 0.24),
      min(0.25, 0.08 + input.selectedFraction * 0.22),
      bubbleMode,
    );
    color = vec4f(mix(color.rgb, uniforms.selectedColor.rgb, selectedMix), color.a);
  }

  let selectedRingPx = select(
    min(4.0, 1.0 + input.selectedFraction * 3.0),
    min(4.0, 1.25 + input.selectedFraction * 2.75),
    bubbleMode,
  );
  let hoverRingPx = select(
    3.0,
    min(5.0, max(2.0, input.radiusOrMinHalfSizePx * 0.14)),
    bubbleMode,
  );
  let selectedThreshold = 1.0 - selectedRingPx / input.radiusOrMinHalfSizePx;
  let hoverThreshold = 1.0 - hoverRingPx / input.radiusOrMinHalfSizePx;
  let selectedRing = select(
    0.0,
    smoothstep(selectedThreshold, min(1.0, selectedThreshold + edgeSoftness * 3.0), distanceFromCenter),
    input.selectedFraction > 0.0,
  );
  let hoverRing = select(
    0.0,
    smoothstep(hoverThreshold, min(1.0, hoverThreshold + edgeSoftness * 3.0), distanceFromCenter),
    input.hovered > 0.5,
  );

  if (!bubbleMode && uniforms.params.y > 0.0) {
    let borderThresholdX = 1.0 - 2.0 / max(uniforms.cellSize.x, 1.0);
    let borderThresholdY = 1.0 - 2.0 / max(uniforms.cellSize.y, 1.0);
    let borderMask = max(
      smoothstep(borderThresholdX, min(1.0, borderThresholdX + 0.08), abs(input.local.x)),
      smoothstep(borderThresholdY, min(1.0, borderThresholdY + 0.08), abs(input.local.y)),
    );
    color = mix(color, vec4f(uniforms.borderColor.rgb, max(color.a, uniforms.borderColor.a)), borderMask * uniforms.params.y);
  }
  if (selectedRing > 0.0) {
    color = mix(color, uniforms.selectedColor, selectedRing);
  }
  if (hoverRing > 0.0) {
    color = mix(color, uniforms.hoverColor, hoverRing);
  }
  if (color.a <= 0.0) {
    discard;
  }
  return color;
}
`;
