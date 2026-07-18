export type {
  CreateFastScatterBuffersOptions,
  FastScatterBufferBuildMetrics,
  FastScatterBufferBuildRecord,
  FastScatterBufferBuildResult,
  FastScatterBufferStyleLimits,
  FastScatterShapeName,
} from './buffers.js';
export {
  createFastScatterBuffers,
  createFastScatterBuffers as createScatterBuffers,
  FAST_SCATTER_SHAPE_CODES,
  normalizeRotationDegrees,
  normalizeRotationRadians,
  packRgba8Color,
} from './buffers.js';
export {
  FAST_SCATTER_RENDERING_MODES,
  resolveFastScatterAlphaPolicy,
} from './alphaPolicy.js';
export {
  buildFastScatterAggregation,
  buildFastScatterBubbleAggregation,
  buildFastScatterHeatmapAggregation,
  collectFastScatterAggregationTransferables,
  getFastScatterAggregationByteLength,
  locateFastScatterHeatmapCellAtAxisValue,
  locateFastScatterHeatmapCellAtPixel,
  materializeFastScatterBubbleSourceIndices,
  materializeFastScatterHeatmapCellSourceIndices,
} from './aggregation.js';
export {
  createFastScatterEasterEggPointLayout,
} from './easterEgg.js';
export type {
  FastScatterEasterEggPoint,
  FastScatterEasterEggPointLayout,
} from './easterEgg.js';
export {
  FAST_SCATTER_DEFAULT_OPACITY_SCALE,
  FAST_SCATTER_OPACITY_SCALE_PARAM,
  FAST_SCATTER_OPACITY_SCALE_STEPS,
  formatOpacityScaleParam,
  getNextOpacityScale,
  getPreviousOpacityScale,
  parseOpacityScaleSearchParam,
  snapOpacityScaleToStep,
} from './opacityScale.js';
export {
  FAST_SCATTER_DEFAULT_POINT_SIZE_SCALE,
  FAST_SCATTER_POINT_SIZE_SCALE_PARAM,
  FAST_SCATTER_POINT_SIZE_SCALE_STEPS,
  formatPointSizeScaleParam,
  getNextPointSizeScale,
  getPreviousPointSizeScale,
  parsePointSizeScaleSearchParam,
  snapPointSizeScaleToStep,
} from './pointSizeScale.js';
export type {
  FastScatterAlphaMode,
  FastScatterAlphaPolicy,
  FastScatterAlphaPolicyInput,
  FastScatterEffectiveRenderingMode,
  FastScatterPointRenderingPolicy,
  FastScatterRenderingMode,
} from './alphaPolicy.js';
export type {
  FastScatterDatasetSchema,
  FastScatterEncodedAxis,
  FastScatterEncodedAxisBase,
  FastScatterEncodedAxisKind,
  FastScatterEncodedSchemaColumns,
  FastScatterEncodeSchemaResult,
  FastScatterSchemaAxisType,
  FastScatterSchemaCategory,
  FastScatterSchemaColumn,
} from './axisSchema.js';
export {
  createAxisTitle,
  encodeFastScatterSchemaRows,
  encodeFastScatterSchemaRows as encodeScatterSchemaRows,
} from './axisSchema.js';
export type {
  FastScatterAxisTick,
  FastScatterAxisTickOptions,
  FastScatterDatetimeTickContext,
} from './axisTicks.js';
export {
  createFastScatterAxisTicks,
  createFastScatterDatetimeTickContext,
  formatFastScatterDatetimeNsEpochValue,
  formatFastScatterAxisValue,
} from './axisTicks.js';
export type {
  FastScatterDisplayField,
  FastScatterDisplayField as ScatterDisplayField,
  FastScatterDisplayColumns,
  FastScatterDisplayColumns as ScatterDisplayColumns,
  FastScatterFormattedPoint,
  FastScatterFormattedPoint as ScatterFormattedPoint,
  FastScatterFormattedPointValue,
  FastScatterFormattedPointValue as ScatterFormattedPointValue,
} from './axisDisplay.js';
export {
  createFastScatterAggregateDisplayFields,
  createFastScatterAggregateMeasurementDisplayFields,
  createFastScatterMeasurementDisplayFields,
  createFastScatterPointDisplayFields,
  createFastScatterSourceDisplayFields,
  formatFastScatterAxisDeltaForDisplay,
  formatFastScatterColumnValueForDisplay,
  formatFastScatterFormattedPointValueForDisplay,
  formatFastScatterPointForDisplay,
} from './axisDisplay.js';
export {
  createFastScatterSelectionState,
  estimateFastScatterSelectionCandidateCount,
  getFastScatterSelectionPolygonBounds,
  isFastScatterPointInPolygon,
  materializeFastScatterSelectedIds,
  materializeFastScatterSelectedRecords,
  materializeFastScatterSelectedIdSample,
  mergeFastScatterSelectionSourceIndices,
  normalizeSelectionSourceIndices,
  selectFastScatterSourceIndicesInBounds,
  selectFastScatterSourceIndicesInPolygon,
  serializeFastScatterSelectedIdsForExport,
  serializeFastScatterSelectedRecordsForExport,
} from './selection.js';
export type { FastScatterSelectedRecord } from './selection.js';
export type {
  CreateFastScatterCompactHoverIndexOptions,
  CreateFastScatterHoverIndexOptions,
  FastScatterNearestPointHit,
  FastScatterNearestPointLookupDiagnostics,
  FastScatterNearestPointLookupInput,
  FastScatterNearestPointLookupResult,
} from './hoverLookup.js';
export type { FastScatterAggregateHoverHit } from './hoverLookup.js';
export {
  createFastScatterCompactHoverIndex,
  createFastScatterHoverIndex,
  createFastScatterPointRef,
  lookupFastScatterAggregateHit,
  lookupFastScatterNearestPoint,
} from './hoverLookup.js';
export {
  createFastScatterMeasurementReferenceFromHover,
} from './measurement.js';
export type {
  FastScatterCompareSummaries,
  FastScatterCompareSummary,
  FastScatterMetricSummary,
} from './summaryStats.js';
export {
  createFastScatterCompareSummaries,
  createFastScatterSelectedCompareSummary,
  createFastScatterVisibleCompareSummary,
} from './summaryStats.js';
export type {
  CreateFastScatterSelectionStateOptions,
  FastScatterPolygonSelectionDiagnostics,
  FastScatterPolygonSelectionResult,
  FastScatterSelectionBounds,
  FastScatterSelectionPoint,
  FastScatterSelectionPolygon,
  FastScatterSelectionState,
} from './selection.js';

export type {
  FastScatterDataDomain,
  FastScatterDataDomain as ScatterDataDomain,
  FastScatterLayout,
  FastScatterLayout as ScatterLayout,
  FastScatterLayoutOptions,
  FastScatterLayoutOptions as ScatterLayoutOptions,
  FastScatterPlotRect,
  FastScatterPlotRect as ScatterPlotRect,
} from './transforms.js';
export {
  axisToClip,
  axisToPixel,
  calculateFastScatterDomain,
  calculateFastScatterDomain as calculateScatterDomain,
  clipToAxis,
  createPaddedFastScatterDomainRange,
  createFastScatterLayout,
  createDefaultFastScatterViewport,
  createDefaultFastScatterViewport as createDefaultScatterViewport,
  createFastScatterPlotRects,
  normalizeFastScatterViewport,
  pixelToAxis,
  rectToDevicePixels,
} from './transforms.js';
export type {
  FastScatterRectangleZoomAxisModeStrategy,
  FastScatterRectangleZoomFeedback,
  FastScatterRectangleZoomFeedbackInput,
  FastScatterRectangleZoomInput,
  FastScatterRectangleZoomResult,
  FastScatterWheelZoomInput,
  FastScatterWheelZoomResult,
  FastScatterWheelZoomResult as ScatterWheelZoomResult,
} from './zoom.js';
export {
  createFastScatterRectangleZoomFeedback,
  findFastScatterPlotRectAtPoint,
  resolveFastScatterRectangleZoomAxisMode,
  resolveFastScatterRectangleZoomEffectiveAxisMode,
  zoomFastScatterViewportAtPointer,
  zoomFastScatterViewportToRectangle,
} from './zoom.js';
export type {
  FastScatterDragPanInput,
  FastScatterDragPanResult,
} from './pan.js';
export {
  panFastScatterViewportByFrame,
  panFastScatterViewportByStep,
  panFastScatterViewportFromDrag,
  startFastScatterDragPan,
} from './pan.js';
export type {
  FastScatterNavigatorBin,
  FastScatterNavigatorResizeInput,
  FastScatterNavigatorSummary,
  FastScatterNavigatorWindowDragInput,
} from './navigator.js';
export {
  calculateFastScatterNavigatorWindowPixels,
  clampFastScatterNavigatorWindow,
  createFastScatterNavigatorSummary,
  dragFastScatterNavigatorWindow,
  resizeFastScatterNavigatorWindow,
} from './navigator.js';
export type { FastScatterViewportSyncSummary } from './viewportSync.js';
export {
  areFastScatterRangesEqual,
  createFastScatterViewportWithSharedX,
  summarizeFastScatterViewportSync,
} from './viewportSync.js';
export type {
  FastScatterOutOfRangeInput,
  FastScatterOutOfRangeMarker,
  FastScatterOutOfRangeResult,
} from './outOfRange.js';
export { computeFastScatterOutOfRangeMarkers } from './outOfRange.js';
export type {
  FastScatterSubplotRenderPlan,
  FastScatterSubplotRenderPlanItem,
  FastScatterSelectedMaskBuildResult,
  FastScatterWebglRendererOptions,
} from './renderer.js';
export {
  normalizeFastScatterOpacityScale,
  normalizeFastScatterPointSizeScale,
  normalizeFastScatterHeatmapBinSizePx,
  normalizeFastScatterHeatmapPalette,
  normalizeFastScatterVisualizationMode,
  createFastScatterAggregationRequest,
  createFastScatterBubbleRadiusPx,
  createFastScatterHeatmapColors,
  resolveFastScatterHeatmapBorderAlpha,
  buildFastScatterSelectedMask,
  createFastScatterSubplotRenderPlan,
  FastScatterWebglRenderer,
} from './renderer.js';
export type { FastScatterGpuTimer, FastScatterGpuTimingResult } from './webgl/timing.js';
export { createFastScatterGpuTimer } from './webgl/timing.js';
export { FAST_SCATTER_VISUALIZATION_MODES } from './types.js';

export type {
  FastScatterAggregationBuildMetrics,
  FastScatterAggregationExecutionMetrics,
  FastScatterAggregationExecutionResult,
  FastScatterAggregationMode,
  FastScatterAggregationRequest,
  FastScatterAggregationSet,
  FastScatterAggregationSubplotRequest,
  FastScatterAxisMode,
  FastScatterBubbleAggregationRequest,
  FastScatterBubbleAggregationSet,
  FastScatterBubbleSubplotAggregation,
  FastScatterCanvasPoint,
  FastScatterColorArray,
  FastScatterCompactHoverIndex,
  FastScatterController,
  FastScatterControllerOptions,
  FastScatterEasterEggPlaybackOptions,
  FastScatterHeatmapAggregationRequest,
  FastScatterHeatmapAggregationSet,
  FastScatterHeatmapCellLocation,
  FastScatterHeatmapPalette,
  FastScatterHeatmapSubplotAggregation,
  FastScatterHoverGridIndex,
  FastScatterHoverIndexSet,
  FastScatterHoverEvent,
  FastScatterInteractionMode,
  FastScatterMeasurementEvent,
  FastScatterMeasurementReference,
  FastScatterMetricsEvent,
  FastScatterPlotSpec,
  FastScatterPlotSpec as ScatterPlotSpec,
  FastScatterPointAxisKind,
  FastScatterPointAxisMetadata,
  FastScatterPointColumns,
  FastScatterPointRef,
  FastScatterRecordIdentity,
  FastScatterRendererOptions,
  FastScatterRange,
  FastScatterRange as ScatterRange,
  FastScatterSelectionCategoryValue,
  FastScatterSelectionDimension,
  FastScatterSelectionEvent,
  FastScatterSelectionFilter,
  FastScatterSelectionKind,
  FastScatterSelectionSource,
  FastScatterSelectionTool,
  FastScatterShapeCode,
  FastScatterSubplotSpec,
  FastScatterTheme,
  FastScatterTypedNumericArray,
  FastScatterVisualizationMode,
  FastScatterViewport,
  FastScatterViewport as ScatterViewport,
  FastScatterViewportChangePhase,
  FastScatterViewportChangePhase as ScatterViewportChangePhase,
  FastScatterViewportChangeReason,
  FastScatterViewportChangeReason as ScatterViewportChangeReason,
} from './types.js';
