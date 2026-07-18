export interface WebgpuDeviceLimitsSnapshot {
  maxBufferSize: number;
  maxComputeInvocationsPerWorkgroup: number;
  maxComputeWorkgroupStorageSize: number;
  maxComputeWorkgroupsPerDimension: number;
  maxStorageBufferBindingSize: number;
  maxStorageBuffersPerShaderStage: number;
}

export interface WebgpuContextOptions {
  alphaMode?: GPUCanvasAlphaMode;
  canvas: HTMLCanvasElement;
  onDeviceLost?: (info: GPUDeviceLostInfo) => void;
  powerPreference?: GPUPowerPreference;
  requiredBufferSize?: number;
  requiredStorageBufferBindingSize?: number;
  requestTimestampQuery?: boolean;
}

export interface WebgpuContext {
  adapter: GPUAdapter;
  canvasContext: GPUCanvasContext;
  device: GPUDevice;
  format: GPUTextureFormat;
  limits: WebgpuDeviceLimitsSnapshot;
  timestampQuerySupported: boolean;
}

export interface WebgpuSupportDiagnostic {
  adapterAvailable: boolean;
  hasNavigatorGpu: boolean;
  limits?: WebgpuDeviceLimitsSnapshot;
  message?: string;
  timestampQuerySupported?: boolean;
}
