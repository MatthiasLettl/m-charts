import {
  PARALLEL_ABOVE_VIEWPORT_DISPLAY_VALUE,
  PARALLEL_ABOVE_VIEWPORT_ROUTE_NORMALIZED_Y,
  PARALLEL_AXIS_MAX_DISPLAY_VALUE,
  PARALLEL_AXIS_MIN_DISPLAY_VALUE,
  PARALLEL_BELOW_VIEWPORT_DISPLAY_VALUE,
  PARALLEL_MISSING_AXIS_DISPLAY_VALUE,
  PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y,
} from '../../m-parallel/core/index.js';

const WGSL_MISSING_DISPLAY = PARALLEL_MISSING_AXIS_DISPLAY_VALUE.toFixed(8);
const WGSL_BELOW_DISPLAY = PARALLEL_BELOW_VIEWPORT_DISPLAY_VALUE.toFixed(8);
const WGSL_AXIS_MIN_DISPLAY = PARALLEL_AXIS_MIN_DISPLAY_VALUE.toFixed(8);
const WGSL_AXIS_MAX_DISPLAY = PARALLEL_AXIS_MAX_DISPLAY_VALUE.toFixed(8);
const WGSL_ABOVE_DISPLAY = PARALLEL_ABOVE_VIEWPORT_DISPLAY_VALUE.toFixed(8);
const WGSL_MISSING_ROUTE = PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y.toFixed(8);
const WGSL_ABOVE_ROUTE = PARALLEL_ABOVE_VIEWPORT_ROUTE_NORMALIZED_Y.toFixed(8);

export const PARALLEL_WEBGPU_COMPUTE_SHADER = /* wgsl */ `
struct AxisConfig {
  view: vec4<f32>,
  brushes0: vec4<f32>,
  brushes1: vec4<f32>,
  metadata: vec4<u32>,
}

struct ComputeUniform {
  pageRecordCount: u32,
  pageStart: u32,
  axisCount: u32,
  resolution: u32,
  pairCount: u32,
  selectionFromBrushes: u32,
  pairStart: u32,
  selectedMaskActive: u32,
  preselectedMaskActive: u32,
  uniformStyle: u32,
  refinementActive: u32,
  refinementLimit: u32,
  refinementStride: u32,
  refinementUniformStyle: u32,
  refinementStyleOffset: u32,
  refinementSourceOffset: u32,
}

struct RefinementState {
  qualifiedCount: atomic<u32>,
  acceptedCount: atomic<u32>,
  _padding0: atomic<u32>,
  _padding1: atomic<u32>,
}

struct Bin {
  count: atomic<u32>,
  red: atomic<u32>,
  green: atomic<u32>,
  blue: atomic<u32>,
  alpha: atomic<u32>,
  selected: atomic<u32>,
  preselected: atomic<u32>,
  _padding: atomic<u32>,
}

@group(0) @binding(0) var<storage, read> values: array<u32>;
@group(0) @binding(1) var<storage, read> styles: array<u32>;
@group(0) @binding(2) var<storage, read_write> bins: array<Bin>;
@group(0) @binding(3) var<storage, read_write> selectedMask: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read> preselectedMask: array<u32>;
@group(0) @binding(5) var<storage, read> axes: array<AxisConfig>;
@group(0) @binding(6) var<uniform> uniforms: ComputeUniform;
@group(0) @binding(7) var<storage, read_write> refinedRecords: array<u32>;
@group(0) @binding(8) var<storage, read_write> refinement: RefinementState;

const EMPTY_BIN: u32 = 0xffffffffu;
var<workgroup> localKeys: array<atomic<u32>, 256>;
var<workgroup> localCount: array<atomic<u32>, 256>;
var<workgroup> localRed: array<atomic<u32>, 256>;
var<workgroup> localGreen: array<atomic<u32>, 256>;
var<workgroup> localBlue: array<atomic<u32>, 256>;
var<workgroup> localAlpha: array<atomic<u32>, 256>;
var<workgroup> localSelected: array<atomic<u32>, 256>;
var<workgroup> localPreselected: array<atomic<u32>, 256>;

fn isFiniteValue(value: f32) -> bool {
  return (bitcast<u32>(value) & 0x7f800000u) != 0x7f800000u;
}

fn readQuantizedValue(localIndex: u32, axisIndex: u32) -> u32 {
  let linearIndex = localIndex * uniforms.axisCount + axisIndex;
  let packed = values[linearIndex >> 1u];
  return (packed >> ((linearIndex & 1u) * 16u)) & 65535u;
}

fn readValue(localIndex: u32, axisIndex: u32) -> f32 {
  let quantized = readQuantizedValue(localIndex, axisIndex);
  return select(f32(quantized) / 65534.0, -1.0, quantized == 65535u);
}

fn hashSourceIndex(sourceIndex: u32) -> u32 {
  var value = sourceIndex * 747796405u + 2891336453u;
  value = ((value >> ((value >> 28u) + 4u)) ^ value) * 277803737u;
  return (value >> 22u) ^ value;
}

fn matchesAxisBrush(value: f32, axis: AxisConfig) -> bool {
  let count = axis.metadata.x;
  if (count == 0u) { return true; }
  if (!isFiniteValue(value)) { return false; }
  if (count > 0u && value >= axis.brushes0.x && value <= axis.brushes0.y) {
    return true;
  }
  if (count > 1u && value >= axis.brushes0.z && value <= axis.brushes0.w) {
    return true;
  }
  if (count > 2u && value >= axis.brushes1.x && value <= axis.brushes1.y) {
    return true;
  }
  if (count > 3u && value >= axis.brushes1.z && value <= axis.brushes1.w) {
    return true;
  }
  return false;
}

fn axisBin(value: f32, axis: AxisConfig) -> u32 {
  if (!isFiniteValue(value) || value < 0.0) { return 0u; }
  if (value < axis.view.x) { return 1u; }
  if (value > axis.view.y) { return uniforms.resolution + 2u; }
  let span = max(0.0000001, axis.view.y - axis.view.x);
  let projected = clamp((value - axis.view.x) / span, 0.0, 0.99999994);
  return 2u + min(uniforms.resolution - 1u, u32(projected * f32(uniforms.resolution)));
}

@compute @workgroup_size(256)
fn aggregate(
  @builtin(global_invocation_id) id: vec3<u32>,
  @builtin(local_invocation_index) localId: u32,
) {
  let localIndex = id.x;
  let recordActive = localIndex < uniforms.pageRecordCount;
  let sourceIndex = uniforms.pageStart + localIndex;
  var selected = false;
  var hasBrush = false;
  if (recordActive) {
    selected = true;
    for (var axisIndex = 0u; axisIndex < uniforms.axisCount; axisIndex += 1u) {
      let axis = axes[axisIndex];
      if (axis.metadata.x > 0u) {
        hasBrush = true;
        selected = selected && matchesAxisBrush(
          readValue(localIndex, axisIndex),
          axis,
        );
      }
    }
  }
  let maskWord = sourceIndex >> 5u;
  let maskBit = 1u << (sourceIndex & 31u);
  if (recordActive && uniforms.selectionFromBrushes != 0u) {
    if (selected && hasBrush) {
      atomicOr(&selectedMask[maskWord], maskBit);
    }
  } else if (recordActive && uniforms.selectedMaskActive != 0u) {
    selected = (atomicLoad(&selectedMask[maskWord]) & maskBit) != 0u;
  } else {
    selected = false;
  }
  let preselected = recordActive && uniforms.preselectedMaskActive != 0u &&
    (preselectedMask[maskWord] & maskBit) != 0u;
  var stylePair = 0u;
  if (recordActive && uniforms.uniformStyle == 0u) {
    stylePair = styles[localIndex >> 1u];
  }
  let packed = select(
    stylePair & 65535u,
    stylePair >> 16u,
    (localIndex & 1u) != 0u,
  );
  let red = packed & 15u;
  let green = (packed >> 4u) & 15u;
  let blue = (packed >> 8u) & 15u;
  let alpha = ((packed >> 12u) & 15u) * 127u / 15u;
  if (recordActive && uniforms.refinementActive != 0u) {
    var viewportQualified = true;
    let quantizationMargin = 1.0 / 65534.0;
    for (var axisIndex = 0u; axisIndex < uniforms.axisCount; axisIndex += 1u) {
      let axis = axes[axisIndex];
      if (axis.metadata.z != 0u) {
        let value = readValue(localIndex, axisIndex);
        viewportQualified = viewportQualified && isFiniteValue(value) &&
          value >= axis.view.x - quantizationMargin &&
          value <= axis.view.y + quantizationMargin;
      }
    }
    if (viewportQualified) {
      atomicAdd(&refinement.qualifiedCount, 1u);
      let stride = max(1u, uniforms.refinementStride);
      if (hashSourceIndex(sourceIndex) % stride == 0u) {
        let outputIndex = atomicAdd(&refinement.acceptedCount, 1u);
        if (outputIndex < uniforms.refinementLimit) {
          refinedRecords[uniforms.refinementSourceOffset + outputIndex] =
            sourceIndex;
        }
      }
    }
  }
  let logicalResolution = uniforms.resolution + 3u;
  let binsPerPair = logicalResolution * logicalResolution;
  for (var pairOffset = 0u; pairOffset < uniforms.pairCount; pairOffset += 1u) {
    let pair = uniforms.pairStart + pairOffset;
    var binIndex = EMPTY_BIN;
    if (recordActive) {
      let startBin = axisBin(readValue(localIndex, pair), axes[pair]);
      let endBin = axisBin(readValue(localIndex, pair + 1u), axes[pair + 1u]);
      binIndex = pair * binsPerPair + startBin * logicalResolution + endBin;
    }
    let selectedIncrement = select(
      0u,
      1u,
      selected && (hasBrush || uniforms.selectionFromBrushes == 0u),
    );
    let preselectedIncrement = select(0u, 1u, preselected);
    let combineLocally = axes[pair].metadata.y != 0u && axes[pair + 1u].metadata.y != 0u;
    if (combineLocally) {
      atomicStore(&localKeys[localId], EMPTY_BIN);
      atomicStore(&localCount[localId], 0u);
      atomicStore(&localRed[localId], 0u);
      atomicStore(&localGreen[localId], 0u);
      atomicStore(&localBlue[localId], 0u);
      atomicStore(&localAlpha[localId], 0u);
      atomicStore(&localSelected[localId], 0u);
      atomicStore(&localPreselected[localId], 0u);
      workgroupBarrier();
      if (recordActive) {
        var slot = (binIndex * 2654435761u) & 255u;
        loop {
          let claimed = atomicCompareExchangeWeak(&localKeys[slot], EMPTY_BIN, binIndex);
          if (claimed.exchanged || claimed.old_value == binIndex) {
            atomicAdd(&localCount[slot], 1u);
            if (uniforms.uniformStyle == 0u) {
              atomicAdd(&localRed[slot], red);
              atomicAdd(&localGreen[slot], green);
              atomicAdd(&localBlue[slot], blue);
              atomicAdd(&localAlpha[slot], alpha);
            }
            atomicAdd(&localSelected[slot], selectedIncrement);
            atomicAdd(&localPreselected[slot], preselectedIncrement);
            break;
          }
          slot = (slot + 1u) & 255u;
        }
      }
      workgroupBarrier();
      let combinedBin = atomicLoad(&localKeys[localId]);
      if (combinedBin != EMPTY_BIN) {
        atomicAdd(&bins[combinedBin].count, atomicLoad(&localCount[localId]));
        if (uniforms.uniformStyle == 0u) {
          atomicAdd(&bins[combinedBin].red, atomicLoad(&localRed[localId]));
          atomicAdd(&bins[combinedBin].green, atomicLoad(&localGreen[localId]));
          atomicAdd(&bins[combinedBin].blue, atomicLoad(&localBlue[localId]));
          atomicAdd(&bins[combinedBin].alpha, atomicLoad(&localAlpha[localId]));
        }
        let combinedSelected = atomicLoad(&localSelected[localId]);
        let combinedPreselected = atomicLoad(&localPreselected[localId]);
        if (combinedSelected > 0u) {
          atomicAdd(&bins[combinedBin].selected, combinedSelected);
        }
        if (combinedPreselected > 0u) {
          atomicAdd(&bins[combinedBin].preselected, combinedPreselected);
        }
      }
      workgroupBarrier();
    } else if (recordActive) {
      atomicAdd(&bins[binIndex].count, 1u);
      if (uniforms.uniformStyle == 0u) {
        atomicAdd(&bins[binIndex].red, red);
        atomicAdd(&bins[binIndex].green, green);
        atomicAdd(&bins[binIndex].blue, blue);
        atomicAdd(&bins[binIndex].alpha, alpha);
      }
      if (selectedIncrement > 0u) {
        atomicAdd(&bins[binIndex].selected, selectedIncrement);
      }
      if (preselectedIncrement > 0u) {
        atomicAdd(&bins[binIndex].preselected, preselectedIncrement);
      }
    }
  }
}
`;

export const PARALLEL_WEBGPU_SELECTION_SHADER = /* wgsl */ `
struct AxisConfig {
  view: vec4<f32>,
  brushes0: vec4<f32>,
  brushes1: vec4<f32>,
  metadata: vec4<u32>,
}

struct SelectionUniform {
  pageRecordCount: u32,
  pageStart: u32,
  axisCount: u32,
  resolution: u32,
  pairCount: u32,
  selectionFromBrushes: u32,
  binCount: u32,
  _padding: u32,
}

struct Bin {
  count: atomic<u32>,
  red: atomic<u32>,
  green: atomic<u32>,
  blue: atomic<u32>,
  alpha: atomic<u32>,
  selected: atomic<u32>,
  preselected: atomic<u32>,
  _padding: atomic<u32>,
}

@group(0) @binding(0) var<storage, read> values: array<u32>;
@group(0) @binding(1) var<storage, read_write> bins: array<Bin>;
@group(0) @binding(2) var<storage, read_write> selectedMask: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read> axes: array<AxisConfig>;
@group(0) @binding(4) var<uniform> uniforms: SelectionUniform;

fn isFiniteValue(value: f32) -> bool {
  return (bitcast<u32>(value) & 0x7f800000u) != 0x7f800000u;
}

fn readValue(localIndex: u32, axisIndex: u32) -> f32 {
  let linearIndex = localIndex * uniforms.axisCount + axisIndex;
  let packed = values[linearIndex >> 1u];
  let quantized = (packed >> ((linearIndex & 1u) * 16u)) & 65535u;
  return select(f32(quantized) / 65534.0, -1.0, quantized == 65535u);
}

fn matchesAxisBrush(value: f32, axis: AxisConfig) -> bool {
  let count = axis.metadata.x;
  if (count == 0u) { return true; }
  if (!isFiniteValue(value)) { return false; }
  // The mask is also used as a candidate set for exact CPU finalization.
  // Expand by two quantization steps so an exact boundary match is never lost
  // to packed-value or uniform rounding.
  let padding = 2.0 / 65534.0;
  if (count > 0u && value >= axis.brushes0.x - padding && value <= axis.brushes0.y + padding) {
    return true;
  }
  if (count > 1u && value >= axis.brushes0.z - padding && value <= axis.brushes0.w + padding) {
    return true;
  }
  if (count > 2u && value >= axis.brushes1.x - padding && value <= axis.brushes1.y + padding) {
    return true;
  }
  if (count > 3u && value >= axis.brushes1.z - padding && value <= axis.brushes1.w + padding) {
    return true;
  }
  return false;
}

fn axisBin(value: f32, axis: AxisConfig) -> u32 {
  if (!isFiniteValue(value) || value < 0.0) { return 0u; }
  if (value < axis.view.x) { return 1u; }
  if (value > axis.view.y) { return uniforms.resolution + 2u; }
  let span = max(0.0000001, axis.view.y - axis.view.x);
  let projected = clamp((value - axis.view.x) / span, 0.0, 0.99999994);
  return 2u + min(uniforms.resolution - 1u, u32(projected * f32(uniforms.resolution)));
}

@compute @workgroup_size(256)
fn clearSelected(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= uniforms.binCount) { return; }
  atomicStore(&bins[id.x].selected, 0u);
}

@compute @workgroup_size(256)
fn selectRecords(@builtin(global_invocation_id) id: vec3<u32>) {
  let localIndex = id.x;
  if (localIndex >= uniforms.pageRecordCount) { return; }
  let sourceIndex = uniforms.pageStart + localIndex;
  let maskWord = sourceIndex >> 5u;
  let maskBit = 1u << (sourceIndex & 31u);
  var selected = false;
  if (uniforms.selectionFromBrushes != 0u) {
    selected = true;
    var hasBrush = false;
    for (var axisIndex = 0u; axisIndex < uniforms.axisCount; axisIndex += 1u) {
      let axis = axes[axisIndex];
      if (axis.metadata.x > 0u) {
        hasBrush = true;
        selected = selected && matchesAxisBrush(readValue(localIndex, axisIndex), axis);
      }
    }
    selected = selected && hasBrush;
    if (selected) {
      atomicOr(&selectedMask[maskWord], maskBit);
    }
  } else {
    selected = (atomicLoad(&selectedMask[maskWord]) & maskBit) != 0u;
  }
  if (!selected) { return; }
  let logicalResolution = uniforms.resolution + 3u;
  let binsPerPair = logicalResolution * logicalResolution;
  for (var pair = 0u; pair < uniforms.pairCount; pair += 1u) {
    let startBin = axisBin(readValue(localIndex, pair), axes[pair]);
    let endBin = axisBin(readValue(localIndex, pair + 1u), axes[pair + 1u]);
    let binIndex = pair * binsPerPair + startBin * logicalResolution + endBin;
    atomicAdd(&bins[binIndex].selected, 1u);
  }
}
`;

export const PARALLEL_WEBGPU_RENDER_SHADER = /* wgsl */ `
struct Bin {
  count: u32,
  red: u32,
  green: u32,
  blue: u32,
  alpha: u32,
  selected: u32,
  preselected: u32,
  _padding: u32,
}

struct RenderUniform {
  axisCount: u32,
  resolution: u32,
  pairCount: u32,
  binCount: u32,
  lineOpacityScale: f32,
  selectionActive: u32,
  viewportSize: vec2<f32>,
  lineColor: vec4<f32>,
  preselectedColor: vec4<f32>,
  selectedColor: vec4<f32>,
  selectionHaloColor: vec4<f32>,
}

@group(0) @binding(0) var<storage, read> bins: array<Bin>;
@group(0) @binding(1) var<uniform> uniforms: RenderUniform;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
}

fn displayY(bin: u32) -> f32 {
  if (bin == 0u) { return ${WGSL_MISSING_DISPLAY}; }
  if (bin == 1u) { return ${WGSL_BELOW_DISPLAY}; }
  if (bin == uniforms.resolution + 2u) { return ${WGSL_ABOVE_DISPLAY}; }
  return ${WGSL_AXIS_MIN_DISPLAY} + ((f32(bin - 2u) + 0.5) / f32(uniforms.resolution)) * (${WGSL_AXIS_MAX_DISPLAY} - ${WGSL_AXIS_MIN_DISPLAY});
}

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) rawInstance: u32,
) -> VertexOutput {
  let mode = rawInstance / uniforms.binCount;
  let instance = rawInstance % uniforms.binCount;
  let logicalResolution = uniforms.resolution + 3u;
  let binsPerPair = logicalResolution * logicalResolution;
  let pair = instance / binsPerPair;
  let cell = instance % binsPerPair;
  let startBin = cell / logicalResolution;
  let endBin = cell % logicalResolution;
  let backgroundCount = bins[instance].count;
  let selectedCount = bins[instance].selected;
  let preselectedCount = bins[instance].preselected;
  let selectedMode = mode >= 2u;
  let haloMode = selectedMode && mode != 5u;
  var count = backgroundCount;
  let uniformStyle = uniforms.lineColor.a < 0.0;
  var color = uniforms.lineColor;
  if (uniformStyle) {
    color.a = -uniforms.lineColor.a - 1.0;
  }
  if (mode == 1u) {
    count = preselectedCount;
    color = uniforms.preselectedColor;
  } else if (selectedMode) {
    count = selectedCount;
    if (haloMode && selectedCount > 2u) {
      count = 0u;
    }
    color = select(uniforms.selectionHaloColor, uniforms.selectedColor, mode == 5u);
  } else if (backgroundCount > 0u && !uniformStyle) {
    if (uniforms.selectionActive != 0u) {
      count = backgroundCount - min(backgroundCount, selectedCount);
    }
    let divisor = max(1.0, f32(backgroundCount));
    color = vec4<f32>(
      f32(bins[instance].red) / (15.0 * divisor),
      f32(bins[instance].green) / (15.0 * divisor),
      f32(bins[instance].blue) / (15.0 * divisor),
      f32(bins[instance].alpha) / (127.0 * divisor),
    );
  }
  let baseAlpha = select(
    0.10,
    select(0.24, select(0.78, 0.92, mode == 5u), selectedMode),
    mode > 0u,
  );
  var aggregateAlpha = select(
    0.0,
    1.0 - pow(
      max(0.0001, 1.0 - clamp(baseAlpha * color.a * uniforms.lineOpacityScale, 0.0, 0.98)),
      f32(count),
    ),
    count > 0u,
  );
  if (haloMode) {
    aggregateAlpha = min(aggregateAlpha, 0.26);
  }
  if (uniforms.selectionActive != 0u && !selectedMode) {
    let focusAlpha = select(0.62, 0.48, mode == 1u);
    aggregateAlpha *= focusAlpha;
    if (mode == 0u) {
      let luminance = dot(color.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
      color = vec4<f32>(mix(color.rgb, vec3<f32>(luminance), 0.22), color.a);
    }
  }
  let axis = pair + min(vertexIndex, 1u);
  let startX = select(0.0, f32(pair) / f32(uniforms.axisCount - 1u), uniforms.axisCount > 1u);
  let endX = select(0.0, f32(pair + 1u) / f32(uniforms.axisCount - 1u), uniforms.axisCount > 1u);
  let startPosition = vec2<f32>(startX * 2.0 - 1.0, displayY(startBin) * 2.0 - 1.0);
  let endPosition = vec2<f32>(endX * 2.0 - 1.0, displayY(endBin) * 2.0 - 1.0);
  var position = select(startPosition, endPosition, vertexIndex > 0u);
  if (selectedMode && mode != 5u) {
    let pixelDelta = (endPosition - startPosition) * uniforms.viewportSize * 0.5;
    let pixelNormal = normalize(vec2<f32>(-pixelDelta.y, pixelDelta.x));
    var offsetPx = -0.95;
    if (mode == 3u) { offsetPx = 0.0; }
    if (mode == 4u) { offsetPx = 0.95; }
    position += pixelNormal * offsetPx * 2.0 / uniforms.viewportSize;
  }
  var output: VertexOutput;
  output.position = vec4<f32>(position, 0.0, 1.0);
  output.color = vec4<f32>(color.rgb, aggregateAlpha);
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  if (input.color.a <= 0.00001) { discard; }
  return input.color;
}
`;

export const PARALLEL_WEBGPU_DIRECT_SHADER = /* wgsl */ `
struct AxisConfig {
  view: vec4<f32>,
  brushes0: vec4<f32>,
  brushes1: vec4<f32>,
  metadata: vec4<u32>,
}

struct DirectUniform {
  pageRecordCount: u32,
  axisCount: u32,
  pairCount: u32,
  stride: u32,
  representativeCount: u32,
  alphaScale: f32,
  focusScale: f32,
  valueEncoding: u32,
  uniformStyle: u32,
  uniformColor: u32,
  _padding0: vec2<u32>,
}

@group(0) @binding(0) var<storage, read> values: array<u32>;
@group(0) @binding(1) var<storage, read> styles: array<u32>;
@group(0) @binding(2) var<storage, read> axes: array<AxisConfig>;
@group(0) @binding(3) var<uniform> uniforms: DirectUniform;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
}

fn isFiniteValue(value: f32) -> bool {
  return (bitcast<u32>(value) & 0x7f800000u) != 0x7f800000u;
}

fn readValue(record: u32, axisIndex: u32) -> f32 {
  let linearIndex = record * uniforms.axisCount + axisIndex;
  if (uniforms.valueEncoding == 2u) {
    return bitcast<f32>(values[linearIndex]);
  }
  var quantized = values[linearIndex] & 65535u;
  if (uniforms.valueEncoding == 1u) {
    let packed = values[linearIndex >> 1u];
    quantized = (packed >> ((linearIndex & 1u) * 16u)) & 65535u;
  }
  return select(f32(quantized) / 65534.0, -1.0, quantized == 65535u);
}

fn displayY(value: f32, axis: AxisConfig) -> f32 {
  if (!isFiniteValue(value)) { return ${WGSL_MISSING_DISPLAY}; }
  if (uniforms.valueEncoding == 2u) {
    if (value < 0.0) { return ${WGSL_BELOW_DISPLAY}; }
    if (value > 1.0) { return ${WGSL_ABOVE_DISPLAY}; }
    return ${WGSL_AXIS_MIN_DISPLAY} + value * (${WGSL_AXIS_MAX_DISPLAY} - ${WGSL_AXIS_MIN_DISPLAY});
  }
  if (value < 0.0) { return ${WGSL_MISSING_DISPLAY}; }
  if (value < axis.view.x) { return ${WGSL_BELOW_DISPLAY}; }
  if (value > axis.view.y) { return ${WGSL_ABOVE_DISPLAY}; }
  let projected = clamp((value - axis.view.x) / max(0.0000001, axis.view.y - axis.view.x), 0.0, 1.0);
  return ${WGSL_AXIS_MIN_DISPLAY} + projected * (${WGSL_AXIS_MAX_DISPLAY} - ${WGSL_AXIS_MIN_DISPLAY});
}

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instance: u32,
) -> VertexOutput {
  let pair = instance % uniforms.pairCount;
  let representative = instance / uniforms.pairCount;
  let record = min(uniforms.pageRecordCount - 1u, representative * uniforms.stride);
  let axisIndex = pair + min(vertexIndex, 1u);
  let value = readValue(record, axisIndex);
  let packed = select(styles[record], uniforms.uniformColor, uniforms.uniformStyle != 0u);
  let color = vec4<f32>(
    f32(packed & 255u) / 255.0,
    f32((packed >> 8u) & 255u) / 255.0,
    f32((packed >> 16u) & 255u) / 255.0,
    f32((packed >> 24u) & 255u) / 255.0 * uniforms.alphaScale * uniforms.focusScale,
  );
  let x = select(0.0, f32(axisIndex) / f32(uniforms.axisCount - 1u), uniforms.axisCount > 1u);
  var output: VertexOutput;
  output.position = vec4<f32>(
    x * 2.0 - 1.0,
    displayY(value, axes[axisIndex]) * 2.0 - 1.0,
    0.0,
    1.0,
  );
  output.color = color;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  return input.color;
}
`;

export const PARALLEL_WEBGPU_HOVER_SHADER = /* wgsl */ `
struct AxisConfig {
  view: vec4<f32>,
  brushes0: vec4<f32>,
  brushes1: vec4<f32>,
  metadata: vec4<u32>,
}

struct HoverUniform {
  pageRecordCount: u32,
  pageStart: u32,
  axisCount: u32,
  pairStart: u32,
  axisPosition: f32,
  normalizedValue: f32,
  plotWidth: f32,
  plotHeight: f32,
  valueEncoding: u32,
  sourceIndicesMapped: u32,
  pairCount: u32,
  _padding: u32,
}

struct HoverResult {
  distance: atomic<u32>,
  sourceIndex: atomic<u32>,
}

@group(0) @binding(0) var<storage, read> values: array<u32>;
@group(0) @binding(1) var<storage, read> axes: array<AxisConfig>;
@group(0) @binding(2) var<uniform> uniforms: HoverUniform;
@group(0) @binding(3) var<storage, read_write> result: HoverResult;
@group(0) @binding(4) var<storage, read> sourceIndices: array<u32>;

fn isFiniteValue(value: f32) -> bool {
  return (bitcast<u32>(value) & 0x7f800000u) != 0x7f800000u;
}

fn readValue(localIndex: u32, axisIndex: u32) -> f32 {
  let linearIndex = localIndex * uniforms.axisCount + axisIndex;
  if (uniforms.valueEncoding == 2u) {
    return bitcast<f32>(values[linearIndex]);
  }
  var quantized = values[linearIndex] & 65535u;
  if (uniforms.valueEncoding == 1u) {
    let packed = values[linearIndex >> 1u];
    quantized = (packed >> ((linearIndex & 1u) * 16u)) & 65535u;
  }
  return select(f32(quantized) / 65534.0, -1.0, quantized == 65535u);
}

fn displayValue(value: f32, axis: AxisConfig) -> f32 {
  if (!isFiniteValue(value)) { return ${WGSL_MISSING_DISPLAY}; }
  if (uniforms.valueEncoding == 2u) {
    if (value < 0.0) { return ${WGSL_BELOW_DISPLAY}; }
    if (value > 1.0) { return ${WGSL_ABOVE_DISPLAY}; }
    return ${WGSL_AXIS_MIN_DISPLAY} + value * (${WGSL_AXIS_MAX_DISPLAY} - ${WGSL_AXIS_MIN_DISPLAY});
  }
  if (value < 0.0) { return ${WGSL_MISSING_DISPLAY}; }
  if (value < axis.view.x) { return ${WGSL_BELOW_DISPLAY}; }
  if (value > axis.view.y) { return ${WGSL_ABOVE_DISPLAY}; }
  let projected = clamp(
    (value - axis.view.x) / max(0.0000001, axis.view.y - axis.view.x),
    0.0,
    1.0,
  );
  return ${WGSL_AXIS_MIN_DISPLAY} + projected * (${WGSL_AXIS_MAX_DISPLAY} - ${WGSL_AXIS_MIN_DISPLAY});
}

fn pointerDisplayValue(value: f32) -> f32 {
  let projected = clamp(value, ${WGSL_MISSING_ROUTE}, ${WGSL_ABOVE_ROUTE});
  if (projected <= 0.0) {
    return ${WGSL_MISSING_DISPLAY} + ((projected - ${WGSL_MISSING_ROUTE}) / (0.0 - ${WGSL_MISSING_ROUTE})) * (${WGSL_AXIS_MIN_DISPLAY} - ${WGSL_MISSING_DISPLAY});
  }
  if (projected <= 1.0) {
    return ${WGSL_AXIS_MIN_DISPLAY} + projected * (${WGSL_AXIS_MAX_DISPLAY} - ${WGSL_AXIS_MIN_DISPLAY});
  }
  return ${WGSL_AXIS_MAX_DISPLAY} + ((projected - 1.0) / (${WGSL_ABOVE_ROUTE} - 1.0)) * (${WGSL_ABOVE_DISPLAY} - ${WGSL_AXIS_MAX_DISPLAY});
}

fn distanceSquared(localIndex: u32) -> f32 {
  let axisSpan = max(1.0, f32(uniforms.axisCount - 1u));
  let pointer = vec2<f32>(
    uniforms.axisPosition / axisSpan * uniforms.plotWidth,
    (1.0 - pointerDisplayValue(uniforms.normalizedValue)) * uniforms.plotHeight,
  );
  var nearest = 3.402823466e+38;
  for (var pairOffset = 0u; pairOffset < uniforms.pairCount; pairOffset += 1u) {
    let pair = uniforms.pairStart + pairOffset;
    let startValue = displayValue(
      readValue(localIndex, pair),
      axes[pair],
    );
    let endValue = displayValue(
      readValue(localIndex, pair + 1u),
      axes[pair + 1u],
    );
    let start = vec2<f32>(
      f32(pair) / axisSpan * uniforms.plotWidth,
      (1.0 - startValue) * uniforms.plotHeight,
    );
    let end = vec2<f32>(
      f32(pair + 1u) / axisSpan * uniforms.plotWidth,
      (1.0 - endValue) * uniforms.plotHeight,
    );
    let delta = end - start;
    let denominator = max(0.000001, dot(delta, delta));
    let projection = clamp(dot(pointer - start, delta) / denominator, 0.0, 1.0);
    let difference = pointer - (start + delta * projection);
    nearest = min(nearest, dot(difference, difference));
  }
  return nearest;
}

@compute @workgroup_size(256)
fn findDistance(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= uniforms.pageRecordCount) { return; }
  atomicMin(&result.distance, bitcast<u32>(distanceSquared(id.x)));
}

@compute @workgroup_size(256)
fn findSource(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= uniforms.pageRecordCount) { return; }
  let distance = bitcast<u32>(distanceSquared(id.x));
  if (distance == atomicLoad(&result.distance)) {
    let sourceIndex = select(
      uniforms.pageStart + id.x,
      sourceIndices[id.x],
      uniforms.sourceIndicesMapped != 0u,
    );
    atomicMin(&result.sourceIndex, sourceIndex);
  }
}
`;
