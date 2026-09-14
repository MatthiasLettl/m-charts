/** Demo-owned data and query semantics. Nothing here is imported by m-charts. */
export const SENSOR_COLORS = ['#168b86', '#6574d9', '#c16098'] as const;
export const SENSOR_NAMES = ['Chamber A', 'Chamber B', 'Chamber C'] as const;
export const DIMENSIONS = [
  { key: 'temperature', label: 'Temperature', unit: '°C', min: 18, max: 46 },
  { key: 'pressure', label: 'Pressure', unit: 'kPa', min: 95, max: 123 },
  { key: 'vibration', label: 'Vibration', unit: 'mm/s', min: 0, max: 9 },
  { key: 'humidity', label: 'Humidity', unit: '%', min: 25, max: 72 },
] as const;
export type Measurement = (typeof DIMENSIONS)[number]['key'];
export type Dimension = Measurement | 'time';
export type ViewId =
  | 'timeline'
  | 'scatter'
  | 'histogram'
  | 'parallel'
  | 'density';
export const VIEW_LABELS: Record<ViewId, string> = {
  timeline: 'Time window',
  scatter: 'Temperature × pressure',
  histogram: 'Temperature distribution',
  parallel: 'Sensor fingerprint',
  density: 'Vibration × pressure',
};
export interface SensorReading {
  id: string;
  sourceIndex: number;
  sensor: number;
  time: number;
  temperature: number;
  pressure: number;
  vibration: number;
  humidity: number;
  anomaly: 'heat' | 'drift' | null;
}
export interface Range {
  min: number;
  max: number;
}
export type Ranges = Partial<Record<Dimension, readonly Range[]>>;
export interface ExplorerFilters {
  selections?: Partial<Record<ViewId, ReadonlySet<number>>>;
  sensors: readonly number[];
  anomalyOnly: boolean;
  views: Partial<Record<ViewId, Ranges>>;
}
export function initialFilters(): ExplorerFilters {
  return { sensors: [0, 1, 2], anomalyOnly: false, views: {} };
}
export function createSensorReadings(samplesPerSensor = 4000): SensorReading[] {
  let seed = 7391;
  const noise = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296 - 0.5;
  };
  return Array.from({ length: samplesPerSensor * 3 }, (_, sourceIndex) => {
    const sensor = sourceIndex % 3;
    const time =
      (Math.floor(sourceIndex / 3) / Math.max(1, samplesPerSensor - 1)) * 120;
    const cycle = Math.sin(time / 9 + sensor * 0.45);
    const heat = sensor === 1 && time >= 48 && time <= 66;
    const drift = sensor === 2 && time >= 88;
    const pulse = heat ? Math.sin(((time - 48) / 18) * Math.PI) : 0;
    return {
      id: `TC-${sensor + 1}-${Math.floor(sourceIndex / 3)
        .toString()
        .padStart(4, '0')}`,
      sourceIndex,
      sensor,
      time,
      temperature: 26 + cycle * 3.7 + sensor * 1.4 + pulse * 12 + noise() * 1.8,
      pressure:
        103 +
        cycle * 2.8 +
        sensor * 1.5 +
        pulse * 5 +
        (drift ? (time - 88) * 0.38 : 0) +
        noise() * 2,
      vibration:
        1.8 +
        sensor * 0.45 +
        Math.abs(cycle) * 0.9 +
        pulse * 4 +
        (drift ? 1.3 : 0) +
        noise() * 0.65,
      humidity: 55 - cycle * 5 - sensor * 2 - pulse * 12 + noise() * 3,
      anomaly: heat ? 'heat' : drift ? 'drift' : null,
    };
  });
}
export function matchesRanges(reading: SensorReading, ranges: Ranges): boolean {
  return (Object.entries(ranges) as [Dimension, readonly Range[]][]).every(
    ([key, intervals]) =>
      intervals.length === 0 ||
      intervals.some(
        ({ min, max }) =>
          reading[key] >= Math.min(min, max) &&
          reading[key] <= Math.max(min, max),
      ),
  );
}
/** OR within an axis; AND between axes, views, and experiment controls. */
export function filterReadings(
  readings: readonly SensorReading[],
  filters: ExplorerFilters,
): SensorReading[] {
  return readings.filter(
    (reading) =>
      filters.sensors.includes(reading.sensor) &&
      (!filters.anomalyOnly || reading.anomaly !== null) &&
      Object.values(filters.views).every(
        (ranges) => !ranges || matchesRanges(reading, ranges),
      ) &&
      Object.values(filters.selections ?? {}).every(
        (indices) => !indices || indices.has(reading.sourceIndex),
      ),
  );
}
export function summarizeReadings(readings: readonly SensorReading[]) {
  const count = readings.length;
  return {
    count,
    anomalies: readings.filter((reading) => reading.anomaly !== null).length,
    temperature: count
      ? readings.reduce((sum, row) => sum + row.temperature, 0) / count
      : null,
    pressure: count
      ? readings.reduce((sum, row) => sum + row.pressure, 0) / count
      : null,
  };
}
export function describeRanges(ranges: Ranges): string {
  return (Object.entries(ranges) as [Dimension, readonly Range[]][])
    .map(
      ([key, values]) =>
        `${key}: ${values.map(({ min, max }) => `${min.toFixed(1)}–${max.toFixed(1)}`).join(' or ')}`,
    )
    .join(', ');
}

/** Native scatter hit testing binary-searches X without reordering source IDs. */
export function createSensorXOrder(values: Float32Array): Uint32Array {
  return Uint32Array.from(values, (_, index) => index).sort(
    (a, b) => values[a] - values[b] || a - b,
  );
}
