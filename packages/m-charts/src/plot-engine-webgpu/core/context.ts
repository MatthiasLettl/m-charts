import type {
  WebgpuContext,
  WebgpuContextOptions,
  WebgpuDeviceLimitsSnapshot,
  WebgpuSupportDiagnostic,
} from './types.js';

export const WEBGPU_UNAVAILABLE_MESSAGE =
  'WebGPU is unavailable in this browser or device. Use a secure context and a browser with WebGPU enabled.';

export async function createWebgpuContext(
  options: WebgpuContextOptions,
): Promise<WebgpuContext> {
  const gpu = globalThis.navigator?.gpu;
  if (gpu === undefined) {
    throw new Error(WEBGPU_UNAVAILABLE_MESSAGE);
  }

  const adapter = await gpu.requestAdapter({
    powerPreference: options.powerPreference ?? 'high-performance',
  });
  if (adapter === null) {
    throw new Error(`${WEBGPU_UNAVAILABLE_MESSAGE} No GPU adapter was returned.`);
  }

  const timestampQuerySupported =
    options.requestTimestampQuery === true && adapter.features.has('timestamp-query');
  const requiredFeatures: GPUFeatureName[] = timestampQuerySupported
    ? ['timestamp-query']
    : [];
  const requestedStorageSize = options.requiredStorageBufferBindingSize;
  const requestedBufferSize = options.requiredBufferSize;
  if (requestedBufferSize !== undefined && requestedBufferSize > adapter.limits.maxBufferSize) {
    throw new Error(
      `The WebGPU dataset requires a ${requestedBufferSize}-byte buffer, but this adapter supports ${adapter.limits.maxBufferSize} bytes.`,
    );
  }
  if (
    requestedStorageSize !== undefined &&
    requestedStorageSize > adapter.limits.maxStorageBufferBindingSize
  ) {
    throw new Error(
      `The WebGPU dataset requires a ${requestedStorageSize}-byte storage binding, but this adapter supports ${adapter.limits.maxStorageBufferBindingSize} bytes.`,
    );
  }
  const requiredLimits = requestedStorageSize === undefined && requestedBufferSize === undefined
    ? undefined
    : {
        ...(requestedBufferSize === undefined ? {} : { maxBufferSize: requestedBufferSize }),
        ...(requestedStorageSize === undefined
          ? {}
          : { maxStorageBufferBindingSize: requestedStorageSize }),
      };
  const device = await adapter.requestDevice({ requiredFeatures, requiredLimits });
  const canvasContext = options.canvas.getContext('webgpu');
  if (canvasContext === null) {
    device.destroy();
    throw new Error('The canvas could not create a WebGPU context.');
  }

  const format = gpu.getPreferredCanvasFormat();
  canvasContext.configure({
    alphaMode: options.alphaMode ?? 'opaque',
    device,
    format,
  });
  void device.lost.then((info) => options.onDeviceLost?.(info));

  return {
    adapter,
    canvasContext,
    device,
    format,
    limits: snapshotWebgpuDeviceLimits(device.limits),
    timestampQuerySupported,
  };
}

export async function diagnoseWebgpuSupport(): Promise<WebgpuSupportDiagnostic> {
  const gpu = globalThis.navigator?.gpu;
  if (gpu === undefined) {
    return {
      adapterAvailable: false,
      hasNavigatorGpu: false,
      message: WEBGPU_UNAVAILABLE_MESSAGE,
    };
  }

  try {
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (adapter === null) {
      return {
        adapterAvailable: false,
        hasNavigatorGpu: true,
        message: 'WebGPU is exposed, but no adapter was returned.',
      };
    }

    return {
      adapterAvailable: true,
      hasNavigatorGpu: true,
      limits: snapshotWebgpuDeviceLimits(adapter.limits),
      timestampQuerySupported: adapter.features.has('timestamp-query'),
    };
  } catch (error) {
    return {
      adapterAvailable: false,
      hasNavigatorGpu: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function snapshotWebgpuDeviceLimits(
  limits: GPUSupportedLimits,
): WebgpuDeviceLimitsSnapshot {
  return {
    maxBufferSize: limits.maxBufferSize,
    maxComputeInvocationsPerWorkgroup: limits.maxComputeInvocationsPerWorkgroup,
    maxComputeWorkgroupStorageSize: limits.maxComputeWorkgroupStorageSize,
    maxComputeWorkgroupsPerDimension: limits.maxComputeWorkgroupsPerDimension,
    maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
    maxStorageBuffersPerShaderStage: limits.maxStorageBuffersPerShaderStage,
  };
}
