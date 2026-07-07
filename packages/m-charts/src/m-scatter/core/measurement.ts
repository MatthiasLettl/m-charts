import type {
  FastScatterAggregateAxisRange,
  FastScatterAggregationMembershipSpan,
} from './aggregation.js';
import type { FastScatterAggregateHoverHit } from './hoverLookup.js';
import type {
  FastScatterHoverEvent,
  FastScatterCanvasPoint,
  FastScatterMeasurementReference,
} from './types.js';

export interface FastScatterAggregateMeasurementReference {
  readonly aggregateKind: FastScatterAggregateHoverHit['aggregateKind'];
  readonly axis: {
    readonly x: FastScatterAggregateAxisRange;
    readonly y: FastScatterAggregateAxisRange;
  };
  readonly canvasPoint?: FastScatterCanvasPoint;
  readonly count: number;
  readonly membership: FastScatterAggregationMembershipSpan;
  readonly plotId: string;
  readonly sampleIds: readonly string[];
  readonly yKey: string;
}

export interface FastScatterAggregateMeasurementEvent {
  readonly current: FastScatterAggregateMeasurementReference | null;
  readonly reference: FastScatterAggregateMeasurementReference;
}

export function createFastScatterMeasurementReferenceFromHover(
  hover: FastScatterHoverEvent,
): FastScatterMeasurementReference {
  return {
    ...hover.point,
    aggregate: hover.aggregate,
    canvasPoint: hover.canvasPoint,
  };
}

export function createFastScatterAggregateMeasurementReferenceFromHover(
  hover: FastScatterAggregateHoverHit,
): FastScatterAggregateMeasurementReference {
  return {
    aggregateKind: hover.aggregateKind,
    axis: hover.axis,
    canvasPoint: hover.canvasPoint,
    count: hover.count,
    membership: hover.membership,
    plotId: hover.plotId,
    sampleIds: hover.sampleIds,
    yKey: hover.yKey,
  };
}
