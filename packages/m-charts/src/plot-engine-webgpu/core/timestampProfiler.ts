export interface WebgpuTimestampFrame {
  readonly timestampWrites: GPURenderPassTimestampWrites;
  resolve(encoder: GPUCommandEncoder): void;
  submitted(): void;
}

interface TimestampSlot {
  busy: boolean;
  querySet: GPUQuerySet;
  readBuffer: GPUBuffer;
  resolveBuffer: GPUBuffer;
}

export class WebgpuTimestampProfiler {
  private disposed = false;
  private readonly slots: TimestampSlot[];
  lastDurationMs: number | undefined;

  constructor(device: GPUDevice, supported: boolean, slotCount = 3) {
    this.slots = supported
      ? Array.from({ length: slotCount }, (_, index) => createTimestampSlot(device, index))
      : [];
  }

  get supported(): boolean {
    return this.slots.length > 0;
  }

  beginFrame(onComplete?: (durationMs: number) => void): WebgpuTimestampFrame | null {
    if (this.disposed) return null;
    const slot = this.slots.find((candidate) => !candidate.busy);
    if (slot === undefined) return null;
    slot.busy = true;

    return {
      resolve: (encoder) => {
        encoder.resolveQuerySet(slot.querySet, 0, 2, slot.resolveBuffer, 0);
        encoder.copyBufferToBuffer(slot.resolveBuffer, 0, slot.readBuffer, 0, 16);
      },
      submitted: () => {
        void slot.readBuffer.mapAsync(GPUMapMode.READ).then(() => {
          if (!this.disposed) {
            const timestamps = new BigUint64Array(slot.readBuffer.getMappedRange());
            if (timestamps.length >= 2 && timestamps[1]! >= timestamps[0]!) {
              this.lastDurationMs = Number(timestamps[1]! - timestamps[0]!) / 1_000_000;
              onComplete?.(this.lastDurationMs);
            }
          }
          slot.readBuffer.unmap();
          slot.busy = false;
        }).catch(() => {
          slot.busy = false;
        });
      },
      timestampWrites: {
        beginningOfPassWriteIndex: 0,
        endOfPassWriteIndex: 1,
        querySet: slot.querySet,
      },
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.slots) {
      slot.querySet.destroy();
      slot.readBuffer.destroy();
      slot.resolveBuffer.destroy();
    }
  }
}

function createTimestampSlot(device: GPUDevice, index: number): TimestampSlot {
  return {
    busy: false,
    querySet: device.createQuerySet({
      count: 2,
      label: `plot-engine-webgpu/timestamps/${index}`,
      type: 'timestamp',
    }),
    readBuffer: device.createBuffer({
      label: `plot-engine-webgpu/timestamp-read/${index}`,
      size: 16,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    }),
    resolveBuffer: device.createBuffer({
      label: `plot-engine-webgpu/timestamp-resolve/${index}`,
      size: 16,
      usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.QUERY_RESOLVE,
    }),
  };
}
