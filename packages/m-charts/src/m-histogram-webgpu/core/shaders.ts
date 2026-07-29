export const HISTOGRAM_WEBGPU_SHADER = /* wgsl */ `
struct CanvasUniform {
  size: vec2<f32>,
  _padding: vec2<f32>,
}

@group(0) @binding(0) var<uniform> canvas: CanvasUniform;

struct VertexInput {
  @location(0) corner: vec2<f32>,
  @location(1) rect: vec4<f32>,
  @location(2) color: vec4<f32>,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  let pixel = input.rect.xy + input.corner * input.rect.zw;
  let clip = vec2<f32>(
    pixel.x / canvas.size.x * 2.0 - 1.0,
    1.0 - pixel.y / canvas.size.y * 2.0,
  );
  var output: VertexOutput;
  output.position = vec4<f32>(clip, 0.0, 1.0);
  output.color = input.color;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  return input.color;
}
`;
