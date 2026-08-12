# Server-function streaming demonstration

The demo includes one deliberately small, genuinely chunked HTTP endpoint:

```text
GET /api/webgpu-stream
```

On Vercel, [`api/webgpu-stream.ts`](../api/webgpu-stream.ts) is deployed as a
Vercel Function. It returns a Web `ReadableStream` rather than a completed JSON
body. The response is fixed at 5,000 deterministic records, sends 500 records
per transport chunk, and cannot be enlarged with query parameters. It is an
integration example, not a large-dataset transport.

The function explicitly exports `config.useWebApi: true`. This makes Vercel
invoke the plain `api/*.ts` entry point with the Web `Request`/`Response`
interface required by its `ReadableStream` response rather than the legacy
Node request/response bridge.

The 1M, 10M, and 25M demonstrations never use this function. They remain
browser-local: streaming reads their IndexedDB pages when present and falls
back to the identical seeded browser worker when a stored copy is absent.

## End-to-end path

All three WebGPU routes use the same response and public streaming contracts:

```text
Vercel Function ReadableStream
  -> fetch(...).body
  -> createFastScatterJsonRecordBatchSource
  -> createFastScatterWebgpuStreamSourceFromRecordBatches
  -> scatter typed batches
  -> scatter / histogram / parallel WebGPU streaming constructor
```

The client never calls `response.json()`. The shared JSON decoder extracts the
top-level `records` array incrementally in 1,000-record batches. Scatter uses
those typed batches directly. The histogram adapter maps them to typed
histogram columns; the parallel adapter maps them to typed columns and packed
GPU pages.

Use these routes:

```text
/m-scatter-webgpu?webgpuData=stream-function
/m-histogram-webgpu?webgpuData=stream-function
/m-parallel-webgpu?webgpuData=stream-function
```

The route controls label this source `Server function`. It is opt-in and is
never requested merely by opening a chart or selecting a large dataset.

## Protocol and safety limits

The endpoint accepts `GET` and `HEAD`; other methods return `405`. A successful
response has:

- `Content-Type: application/json; charset=utf-8`
- `Cache-Control: no-store, max-age=0`
- `X-M-Charts-Stream-Protocol: m-charts-webgpu-record-stream-v1`
- `X-M-Charts-Record-Count: 5000`
- `X-M-Charts-Records-Per-Chunk: 500`

The browser validates the protocol and record-count headers before decoding.
The count must be a positive safe integer and cannot exceed the compiled
5,000-record cap. Cancellation propagates from route cleanup to `fetch`, the
response reader, and the chart streaming controller.

The function has an explicit 10-second maximum duration in `vercel.json`, opts
the route into request cancellation with `supportsCancellation`, uses Fluid
Compute, performs no database or upstream requests, and normally finishes in
well under a second. Its short pauses make chunk boundaries observable without
turning it into a long-running function. Function invocations, compute, memory
lifetime, and transfer may still count toward the Vercel plan, so this design
minimizes rather than promises zero cost.

## Local verification

`pnpm dev` installs a Vite development middleware backed by the exact exported
function handler. This makes the three routes and endpoint usable without a
Vercel account while preserving response framing, headers, delays, limits, and
cancellation behavior.

For Vercel's local routing/build environment, use the Vercel CLI from the
repository root:

```sh
pnpm dlx vercel dev
pnpm dlx vercel build
```

The project must be linked or the CLI must be supplied the requested project
settings. The production deployment uses the root `api` directory; Vercel gives
filesystem routes (including Functions) precedence over the SPA catch-all
rewrite to `apps/demo/dist/index.html`.

Run the repository checks before deployment:

```sh
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:e2e
pnpm build
```

After deploying, verify that the response begins before it finishes and that
the protocol headers survive the deployment:

```sh
curl --no-buffer --include https://YOUR_DEPLOYMENT/api/webgpu-stream
```

Then open each `stream-function` route and confirm that progress reaches 5,000,
the canvas remains interactive while records arrive, and cancelling navigation
does not leave an active request.
