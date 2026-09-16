import {
  PARALLEL_WEBGPU_HOVER_OVERLAY_COMPUTE_SHADER,
  PARALLEL_WEBGPU_HOVER_OVERLAY_RENDER_SHADER,
} from './shaders.js';

/** Resident page coordinates are shared with picking; no CPU axis traversal. */
export interface ParallelHoverOverlayPage {
  count: number;
  start: number;
  representativeOnly?: boolean;
  sourceIndicesBuffer: GPUBuffer;
  sourceIndicesOffset?: number;
  valueEncoding: number;
  valuesBuffer: GPUBuffer;
}

/** GPU union of all matched segments. Storage is bounded by screen resolution. */
export class ParallelGpuHoverOverlay {
  private readonly canvas = document.createElement('canvas');
  private readonly context: GPUCanvasContext;
  private readonly compute: GPUComputePipeline;
  readonly pickingPipeline: GPUComputePipeline;
  private version = 0;
  private resolution = 0;
  private readonly render: GPURenderPipeline;
  private readonly drawArguments: GPUBuffer;
  private readonly renderUniform: GPUBuffer;
  private readonly pageUniforms: GPUBuffer[] = [];
  private mask?: GPUBuffer;
  private occupied?: GPUBuffer;
  private keys?: GPUBuffer;
  private capacity = 0;

  constructor(private readonly device: GPUDevice, format: GPUTextureFormat) {
    this.context = this.canvas.getContext('webgpu')!;
    this.context.configure({ device, format, alphaMode: 'premultiplied' });
    const computeModule = device.createShaderModule({ code: PARALLEL_WEBGPU_HOVER_OVERLAY_COMPUTE_SHADER });
    this.compute = device.createComputePipeline({
      layout: 'auto',
      compute: { module: computeModule, entryPoint: 'projectGroup' },
    });
    this.pickingPipeline = device.createComputePipeline({
      layout: 'auto', compute: { module: computeModule, entryPoint: 'findDistanceAndProject' },
    });
    const module = device.createShaderModule({ code: PARALLEL_WEBGPU_HOVER_OVERLAY_RENDER_SHADER });
    this.render = device.createRenderPipeline({
      layout: 'auto', vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: 'fragmentMain', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    this.drawArguments = this.buffer(16, GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST);
    this.renderUniform = this.buffer(48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  }

  /** Begin one GPU-resident result. A newer query invalidates its token. */
  prepare(encoder: GPUCommandEncoder, width: number, height: number, axisCount: number): {
    version: number; resolution: number; entries: GPUBindGroupEntry[];
  } {
    const { device } = this;
    const pairs = Math.max(1, axisCount - 1);
    // Normally one endpoint bin per device pixel. Bound even very tall plots
    // to 64 MiB of geometry, independently of how many records are matched.
    const maxBytes = Math.min(64 * 1024 * 1024, device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize);
    const resolution = Math.max(2, Math.min(height + 1, 2048, Math.floor(Math.sqrt(maxBytes / (4 * pairs)))));
    const capacity = pairs * resolution * resolution;
    if (capacity > this.capacity) {
      this.keys?.destroy(); this.occupied?.destroy();
      this.keys = this.buffer(capacity * 4, GPUBufferUsage.STORAGE);
      this.occupied = this.buffer(Math.ceil(capacity / 32) * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      this.capacity = capacity;
    }
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.resolution = resolution;
    this.version++;
    device.queue.writeBuffer(this.drawArguments, 0, new Uint32Array([6, 0, 0, 0]));
    encoder.clearBuffer(this.occupied!);
    return { version: this.version, resolution, entries: [
      { binding: 6, resource: { buffer: this.occupied! } },
      { binding: 7, resource: { buffer: this.keys! } },
      { binding: 8, resource: { buffer: this.drawArguments } },
    ] };
  }

  draw(target: HTMLCanvasElement, options: {
    axisBuffer: GPUBuffer;
    axisCount: number;
    pages: readonly ParallelHoverOverlayPage[];
    /** Four header words followed by one membership bit per source record. */
    membership: Uint32Array<ArrayBuffer>;
    activeMask: boolean;
    color: readonly number[];
  }): void {
    const { device } = this;
    const encoder = device.createCommandEncoder({ label: 'parallel hover segment union' });
    const prepared = this.prepare(encoder, target.width, target.height, options.axisCount);
    if (this.mask === undefined || this.mask.size < options.membership.byteLength) {
      this.mask?.destroy();
      this.mask = this.buffer(options.membership.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    }
    device.queue.writeBuffer(this.mask, 0, options.membership);
    const compute = encoder.beginComputePass();
    compute.setPipeline(this.compute);
    for (let i = 0; i < options.pages.length; i++) {
      const page = options.pages[i]!;
      if (page.count === 0) continue;
      const uniform = this.pageUniforms[i] ??= this.buffer(64, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
      const data = new Uint32Array(16);
      data[0] = page.count; data[1] = page.start; data[2] = options.axisCount;
      data[8] = page.valueEncoding; data[9] = page.representativeOnly === true ? 1 : 0;
      data[11] = !page.representativeOnly && options.activeMask ? 1 : 0;
      data[15] = prepared.resolution;
      device.queue.writeBuffer(uniform, 0, data);
      compute.setBindGroup(0, device.createBindGroup({
        layout: this.compute.getBindGroupLayout(0), entries: [
          { binding: 0, resource: { buffer: page.valuesBuffer } },
          { binding: 1, resource: { buffer: options.axisBuffer } },
          { binding: 2, resource: { buffer: uniform } },
          { binding: 3, resource: { buffer: this.mask } },
          { binding: 4, resource: { buffer: page.sourceIndicesBuffer, offset: page.sourceIndicesOffset ?? 0 } },
          ...prepared.entries,
        ],
      }));
      compute.dispatchWorkgroups(Math.ceil(page.count / 256));
    }
    compute.end();
    this.encodeRender(encoder, options.axisCount, options.color);
    device.queue.submit([encoder.finish()]);
    this.copyTo(target);
  }

  /** No mask upload, population scan, or geometry regeneration for the latest result. */
  drawPrepared(target: HTMLCanvasElement, version: number, axisCount: number, color: readonly number[]): boolean {
    if (version !== this.version || target.width !== this.canvas.width || target.height !== this.canvas.height) return false;
    const encoder = this.device.createCommandEncoder({ label: 'parallel prepared hover draw' });
    this.encodeRender(encoder, axisCount, color);
    this.device.queue.submit([encoder.finish()]);
    this.copyTo(target);
    return true;
  }

  private encodeRender(encoder: GPUCommandEncoder, axisCount: number, color: readonly number[]): void {
    const { device } = this;
    device.queue.writeBuffer(this.renderUniform, 0, new Float32Array([
      color[0]!, color[1]!, color[2]!, color[3]! * 0.7,
      this.resolution, axisCount, this.canvas.width, this.canvas.height, globalThis.devicePixelRatio || 1, 0, 0, 0,
    ]));
    const render = encoder.beginRenderPass({ colorAttachments: [{
      view: this.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0],
    }] });
    render.setPipeline(this.render);
    render.setBindGroup(0, device.createBindGroup({ layout: this.render.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: this.keys! } },
      { binding: 1, resource: { buffer: this.renderUniform } },
    ] }));
    render.drawIndirect(this.drawArguments, 0);
    render.end();
  }

  private copyTo(target: HTMLCanvasElement): void {
    // Canvas-to-canvas composition keeps the public overlay canvas compatible
    // without reading geometry/pixels back to JavaScript.
    const context = target.getContext('2d')!;
    context.clearRect(0, 0, target.width, target.height);
    context.drawImage(this.canvas, 0, 0);
  }

  dispose(): void {
    this.context.unconfigure();
    for (const buffer of [this.mask, this.occupied, this.keys, this.drawArguments, this.renderUniform, ...this.pageUniforms]) buffer?.destroy();
  }

  private buffer(size: number, usage: GPUBufferUsageFlags): GPUBuffer {
    return this.device.createBuffer({ size: Math.max(16, size), usage, label: 'parallel hover overlay' });
  }
}
