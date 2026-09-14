import { createParallelFastBuffers } from 'm-charts/m-parallel';
import { DIMENSIONS, type SensorReading } from './sensorModel.ts';

/** Keep the rendered coordinate system stable when an isolated cohort changes. */
export function createSensorParallelBuffers(
  readings: readonly SensorReading[],
  color: Uint8Array,
) {
  return createParallelFastBuffers(
    {
      ids: readings.map((row) => row.id),
      color,
      colorFormat: 'rgba8',
      axisOrder: DIMENSIONS.map((d) => d.key),
      axes: DIMENSIONS.map((d) => ({
        key: d.key,
        label: d.label,
        unit: d.unit,
        kind: 'numeric',
      })),
      valuesByAxis: Object.fromEntries(
        DIMENSIONS.map((d) => [
          d.key,
          Float32Array.from(readings, (row) => row[d.key]),
        ]),
      ),
    },
    {
      includeWebglSegmentBuffers: false,
      // Prepared domains skip the encoder scan, so reuse the already-numeric columns.
      compactTypedColumns: true,
      trustedEncodedTypedColumns: true,
      preparedDomainsByAxis: Object.fromEntries(
        DIMENSIONS.map((d) => [
          d.key,
          { min: d.min, max: d.max, span: d.max - d.min },
        ]),
      ),
    },
  );
}
