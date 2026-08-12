import type { FastScatterDatasetSchema } from 'm-charts/m-scatter';

export const WEBGPU_SERVER_STREAM_ENDPOINT = '/api/webgpu-stream';
export const WEBGPU_SERVER_STREAM_PROTOCOL = 'm-charts-webgpu-record-stream-v1';
export const WEBGPU_SERVER_STREAM_COUNT = 5_000;
export const WEBGPU_SERVER_STREAM_RECORDS_PER_CHUNK = 500;
export const WEBGPU_SERVER_STREAM_BATCH_SIZE = 1_000;
export const WEBGPU_SERVER_STREAM_PROTOCOL_HEADER = 'x-m-charts-stream-protocol';
export const WEBGPU_SERVER_STREAM_COUNT_HEADER = 'x-m-charts-record-count';
export const WEBGPU_SERVER_STREAM_CHUNK_SIZE_HEADER =
  'x-m-charts-records-per-chunk';

export const WEBGPU_SERVER_STREAM_TIMESTAMP_ORIGIN_NS =
  1_717_200_000_000_000_000n;
export const WEBGPU_SERVER_STREAM_TIMESTAMP_STEP_NS = 250_000_000n;

export const WEBGPU_SERVER_STREAM_SCHEMA: FastScatterDatasetSchema = {
  version: 1,
  columns: [
    { key: 'id', role: 'id' },
    {
      axisType: 'datetime-ns',
      key: 'timestampNs',
      parameterName: 'Timestamp',
      role: 'x',
      unit: 'UTC',
    },
    {
      axisType: 'categorical',
      categories: [
        { label: 'Idle', order: 0, value: 'idle' },
        { label: 'Ramp', order: 1, value: 'ramp' },
        { label: 'Steady', order: 2, value: 'steady' },
        { label: 'Cooldown', order: 3, value: 'cooldown' },
      ],
      key: 'phase',
      parameterName: 'Process phase',
      role: 'y',
    },
    {
      axisType: 'boolean',
      categories: [
        { label: 'Rejected', value: false },
        { label: 'Accepted', value: true },
      ],
      key: 'accepted',
      parameterName: 'Acceptance',
      role: 'y',
    },
    {
      axisType: 'numeric',
      key: 'signalValue',
      parameterName: 'Signal value',
      role: 'y',
      unit: 'a.u.',
    },
    { key: 'color', role: 'style' },
    { key: 'opacity', role: 'style' },
    { key: 'rotation', role: 'style', unit: 'deg' },
    { key: 'size', role: 'style', unit: 'px' },
    { key: 'shape', role: 'style' },
  ],
  plots: [
    { id: 'phase', y: { column: 'phase' } },
    { id: 'accepted', y: { column: 'accepted' } },
    { id: 'signal', y: { column: 'signalValue' } },
  ],
  x: { column: 'timestampNs' },
};

export interface WebgpuServerStreamRecord {
  accepted: boolean;
  color: string;
  id: string;
  opacity: number;
  phase: 'cooldown' | 'idle' | 'ramp' | 'steady';
  rotation: number;
  shape: 'arrow' | 'circle' | 'pin' | 'rectangle' | 'triangle';
  signalValue: number;
  size: number;
  timestampNs: string;
}
