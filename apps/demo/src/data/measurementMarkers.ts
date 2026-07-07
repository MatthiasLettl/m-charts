import type { ScatterYAttribute } from './types.ts';

export interface LocalPoint {
  x: number;
  y: number;
}

export interface MeasurementReferenceMarker {
  anchor: LocalPoint;
  attribute: ScatterYAttribute;
}

export function createMeasurementReferenceMarkers(
  attributes: readonly ScatterYAttribute[],
  resolveAnchor: (attribute: ScatterYAttribute, index: number) => LocalPoint | null,
): MeasurementReferenceMarker[] {
  const markers: MeasurementReferenceMarker[] = [];

  attributes.forEach((attribute, index) => {
    const anchor = resolveAnchor(attribute, index);

    if (anchor === null || !isFiniteLocalPoint(anchor)) {
      return;
    }

    markers.push({ anchor, attribute });
  });

  return markers;
}

function isFiniteLocalPoint(point: LocalPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
