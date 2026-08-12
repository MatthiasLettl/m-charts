import {
  WEBGPU_SERVER_STREAM_CHUNK_SIZE_HEADER,
  WEBGPU_SERVER_STREAM_COUNT,
  WEBGPU_SERVER_STREAM_COUNT_HEADER,
  WEBGPU_SERVER_STREAM_PROTOCOL,
  WEBGPU_SERVER_STREAM_PROTOCOL_HEADER,
  WEBGPU_SERVER_STREAM_RECORDS_PER_CHUNK,
  WEBGPU_SERVER_STREAM_TIMESTAMP_ORIGIN_NS,
  WEBGPU_SERVER_STREAM_TIMESTAMP_STEP_NS,
  type WebgpuServerStreamRecord,
} from '../apps/demo/src/data/webgpuServerStreamProtocol.js';

const STREAM_CHUNK_DELAY_MS = 20;
const PHASES = ['idle', 'ramp', 'steady', 'cooldown'] as const;
const SHAPES = ['circle', 'rectangle', 'triangle', 'pin', 'arrow'] as const;
const ACCEPTED_COLORS = ['#2563eb', '#059669', '#7c3aed', '#0891b2'] as const;
const REJECTED_COLORS = ['#dc2626', '#ea580c'] as const;

// Plain `api/*.ts` functions otherwise use Vercel's legacy Node req/res bridge.
export const config = { useWebApi: true };

export default function webgpuStreamHandler(request: Request): Response {
  return createWebgpuServerStreamResponse(request);
}

export function createWebgpuServerStreamResponse(request: Request): Response {
  if (request.method === 'HEAD') {
    return new Response(null, { headers: createResponseHeaders(), status: 200 });
  }
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', {
      headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' },
      status: 405,
    });
  }

  const encoder = new TextEncoder();
  let nextRecord = 0;
  let opened = false;
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (closed) return;
      if (request.signal.aborted) {
        closed = true;
        controller.error(
          request.signal.reason ?? new DOMException('Request aborted.', 'AbortError'),
        );
        return;
      }
      if (!opened) {
        opened = true;
        controller.enqueue(encoder.encode(
          `{"protocol":${JSON.stringify(WEBGPU_SERVER_STREAM_PROTOCOL)},` +
          `"count":${WEBGPU_SERVER_STREAM_COUNT},"records":[`,
        ));
        return;
      }
      if (nextRecord >= WEBGPU_SERVER_STREAM_COUNT) {
        closed = true;
        controller.enqueue(encoder.encode(']}'));
        controller.close();
        return;
      }

      const end = Math.min(
        WEBGPU_SERVER_STREAM_COUNT,
        nextRecord + WEBGPU_SERVER_STREAM_RECORDS_PER_CHUNK,
      );
      const records = new Array<string>(end - nextRecord);
      for (let index = nextRecord; index < end; index += 1) {
        records[index - nextRecord] = JSON.stringify(createRecord(index));
      }
      const prefix = nextRecord === 0 ? '' : ',';
      nextRecord = end;
      controller.enqueue(encoder.encode(`${prefix}${records.join(',')}`));
      if (nextRecord < WEBGPU_SERVER_STREAM_COUNT) {
        await delay(STREAM_CHUNK_DELAY_MS, request.signal);
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(body, { headers: createResponseHeaders(), status: 200 });
}

function createResponseHeaders(): Headers {
  return new Headers({
    'Cache-Control': 'no-store, max-age=0',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    [WEBGPU_SERVER_STREAM_CHUNK_SIZE_HEADER]: String(
      WEBGPU_SERVER_STREAM_RECORDS_PER_CHUNK,
    ),
    [WEBGPU_SERVER_STREAM_COUNT_HEADER]: String(WEBGPU_SERVER_STREAM_COUNT),
    [WEBGPU_SERVER_STREAM_PROTOCOL_HEADER]: WEBGPU_SERVER_STREAM_PROTOCOL,
  });
}

function createRecord(index: number): WebgpuServerStreamRecord {
  const phaseIndex = Math.floor(index / 300) % PHASES.length;
  const accepted = index % 9 !== 0 && index % 17 !== 0;
  const signalValue = 65 + Math.sin(index * 0.017) * 28 +
    Math.cos(index * 0.003) * 7 + phaseIndex * 2;
  const timestampIndex = generatedOverlapXValue(index);
  return {
    accepted,
    color: accepted
      ? ACCEPTED_COLORS[phaseIndex]!
      : REJECTED_COLORS[index % REJECTED_COLORS.length]!,
    id: `server-${String(index).padStart(6, '0')}`,
    opacity: accepted ? 0.82 : 0.9,
    phase: PHASES[phaseIndex]!,
    rotation: (index * 23) % 360,
    shape: SHAPES[index % SHAPES.length]!,
    signalValue: Math.round(signalValue * 1_000) / 1_000,
    size: 3 + (index % 6),
    timestampNs: (
      WEBGPU_SERVER_STREAM_TIMESTAMP_ORIGIN_NS +
      BigInt(timestampIndex) * WEBGPU_SERVER_STREAM_TIMESTAMP_STEP_NS
    ).toString(),
  };
}

function generatedOverlapXValue(index: number): number {
  const blockStart = Math.floor(index / 24) * 24;
  const offset = index - blockStart;
  if (offset >= 2 && offset < 5) return blockStart + 2;
  if (offset >= 14 && offset < 16) return blockStart + 14;
  return index;
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(
      signal.reason ?? new DOMException('Request aborted.', 'AbortError'),
    );
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timeout);
      reject(signal.reason ?? new DOMException('Request aborted.', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}
