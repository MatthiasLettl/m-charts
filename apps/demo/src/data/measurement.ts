import type { ScatterRecord, ScatterYAttribute } from './types.ts';

export const MAX_MEASUREMENT_REFERENCES = 3;

export interface MeasurementDelta {
  activeAttribute: ScatterYAttribute;
  activeDelta: number;
  da: number;
  db: number;
  dc: number;
  dx: number;
  hoveredRecord: ScatterRecord;
  referenceRecord: ScatterRecord;
}

export function computeMeasurementDelta({
  activeAttribute,
  hoveredRecord,
  referenceRecord,
}: {
  activeAttribute: ScatterYAttribute;
  hoveredRecord: ScatterRecord;
  referenceRecord: ScatterRecord;
}): MeasurementDelta {
  const da = hoveredRecord.a - referenceRecord.a;
  const db = hoveredRecord.b - referenceRecord.b;
  const dc = hoveredRecord.c - referenceRecord.c;

  return {
    activeAttribute,
    activeDelta: { a: da, b: db, c: dc }[activeAttribute],
    da,
    db,
    dc,
    dx: hoveredRecord.x - referenceRecord.x,
    hoveredRecord,
    referenceRecord,
  };
}

export function computeMeasurementDeltas({
  activeAttribute,
  hoveredRecord,
  referenceRecords,
}: {
  activeAttribute: ScatterYAttribute;
  hoveredRecord: ScatterRecord;
  referenceRecords: readonly ScatterRecord[];
}): MeasurementDelta[] {
  return referenceRecords.map((referenceRecord) =>
    computeMeasurementDelta({
      activeAttribute,
      hoveredRecord,
      referenceRecord,
    }),
  );
}

export function pinMeasurementReferenceId(
  currentReferenceIds: readonly string[],
  nextReferenceId: string,
  maxReferences = MAX_MEASUREMENT_REFERENCES,
): string[] {
  if (maxReferences <= 0) {
    return [];
  }

  const dedupedIds = currentReferenceIds.filter((id) => id !== nextReferenceId);

  return [nextReferenceId, ...dedupedIds].slice(0, maxReferences);
}

export interface MeasurementOverlayPoint {
  x: number;
  y: number;
}

export interface MeasurementOverlayBounds {
  height: number;
  width: number;
}

export interface MeasurementDeltaLabelPlacement {
  anchor: 'above-left' | 'above-right' | 'below-left' | 'below-right';
  left: number;
  top: number;
}

const DEFAULT_DELTA_LABEL_SIZE = {
  height: 44,
  width: 132,
};
const DELTA_LABEL_GAP_PX = 14;

export function placeMeasurementDeltaLabel({
  bounds,
  hoverAnchor,
  labelIndex = 0,
  labelSize = DEFAULT_DELTA_LABEL_SIZE,
  referenceAnchor,
}: {
  bounds: MeasurementOverlayBounds;
  hoverAnchor: MeasurementOverlayPoint;
  labelIndex?: number;
  labelSize?: MeasurementOverlayBounds;
  referenceAnchor: MeasurementOverlayPoint;
}): MeasurementDeltaLabelPlacement {
  const midpoint = {
    x: (hoverAnchor.x + referenceAnchor.x) / 2,
    y: (hoverAnchor.y + referenceAnchor.y) / 2,
  };
  const stagger = Math.max(0, labelIndex) * (labelSize.height + 6);
  const candidates: MeasurementDeltaLabelPlacement[] = [
    {
      anchor: 'above-right',
      left: midpoint.x + DELTA_LABEL_GAP_PX,
      top: midpoint.y - labelSize.height - DELTA_LABEL_GAP_PX - stagger,
    },
    {
      anchor: 'above-left',
      left: midpoint.x - labelSize.width - DELTA_LABEL_GAP_PX,
      top: midpoint.y - labelSize.height - DELTA_LABEL_GAP_PX - stagger,
    },
    {
      anchor: 'below-right',
      left: midpoint.x + DELTA_LABEL_GAP_PX,
      top: midpoint.y + DELTA_LABEL_GAP_PX + stagger,
    },
    {
      anchor: 'below-left',
      left: midpoint.x - labelSize.width - DELTA_LABEL_GAP_PX,
      top: midpoint.y + DELTA_LABEL_GAP_PX + stagger,
    },
  ];

  const sortedCandidates = candidates
    .map((candidate) => ({
      candidate,
      score:
        boundaryPenalty(candidate, labelSize, bounds) +
        proximityPenalty(candidate, labelSize, hoverAnchor) +
        proximityPenalty(candidate, labelSize, referenceAnchor) * 0.45,
    }))
    .sort((a, b) => a.score - b.score);
  const bestCandidate = sortedCandidates[0]?.candidate ?? candidates[0];

  return {
    anchor: bestCandidate.anchor,
    left: clampLabelCoordinate(bestCandidate.left, labelSize.width, bounds.width),
    top: clampLabelCoordinate(bestCandidate.top, labelSize.height, bounds.height),
  };
}

function boundaryPenalty(
  placement: MeasurementDeltaLabelPlacement,
  labelSize: MeasurementOverlayBounds,
  bounds: MeasurementOverlayBounds,
): number {
  return (
    overflowAmount(-placement.left) +
    overflowAmount(-placement.top) +
    overflowAmount(placement.left + labelSize.width - bounds.width) +
    overflowAmount(placement.top + labelSize.height - bounds.height)
  ) * 20;
}

function proximityPenalty(
  placement: MeasurementDeltaLabelPlacement,
  labelSize: MeasurementOverlayBounds,
  point: MeasurementOverlayPoint,
): number {
  const labelCenter = {
    x: placement.left + labelSize.width / 2,
    y: placement.top + labelSize.height / 2,
  };
  const distance = Math.hypot(labelCenter.x - point.x, labelCenter.y - point.y);

  return distance < 96 ? 96 - distance : 0;
}

function overflowAmount(value: number): number {
  return Math.max(0, value);
}

function clampLabelCoordinate(
  value: number,
  size: number,
  availableSize: number,
): number {
  if (!Number.isFinite(value) || availableSize <= size) {
    return 0;
  }

  return Math.min(Math.max(0, value), availableSize - size);
}
