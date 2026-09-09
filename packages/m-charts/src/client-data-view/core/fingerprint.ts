import type { ClientDataSet, ClientDataValue } from './types.js';

/** Deterministic content/row-order fingerprint for local persistence, not authentication. */
export function createClientDataFingerprint(dataset: ClientDataSet, ids?: ArrayLike<string | number>): string {
  let a = 0x811c9dc5; let b = 0x9e3779b9;
  const byte = (value: number) => { a = Math.imul(a ^ value, 0x01000193) >>> 0; b = Math.imul(b ^ value, 0x85ebca6b) >>> 0; };
  const text = (value: string) => { for (let i = 0; i < value.length; i++) { const c = value.charCodeAt(i); byte(c & 255); byte(c >>> 8); } byte(255); byte(0); };
  const scalar = (value: ClientDataValue) => text(`${typeof value}:${String(value)}`);
  text(`client-data-v1:${dataset.rowCount}`);
  for (const key of Object.keys(dataset.fields).sort()) {
    const { kind, values } = dataset.fields[key]!;
    text(key); text(kind); text(String(values.length));
    if (ArrayBuffer.isView(values)) {
      text(values.constructor.name);
      const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
      for (let i = 0; i < bytes.length; i++) byte(bytes[i]!);
    } else for (let i = 0; i < values.length; i++) scalar(values[i]);
  }
  if (ids !== undefined) { text(`ids:${ids.length}`); for (let i = 0; i < ids.length; i++) scalar(ids[i]); }
  return `content-v1-${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}
