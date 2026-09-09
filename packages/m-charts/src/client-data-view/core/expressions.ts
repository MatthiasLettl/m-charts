import type { ClientDataExpression, ClientDataField, ClientDataFieldKind, ClientDataPredicate, ClientDataValue } from './types.js';

type Fields = Readonly<Record<string, ClientDataField>>;
type PredicateCompiler = (predicate: ClientDataPredicate, fields: Fields) => (row: number) => boolean;
export interface CompiledExpression {
  kind: ClientDataFieldKind;
  read: (row: number) => ClientDataValue;
}

export function datetimeBigInt(value: ClientDataValue): bigint | null {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  return null;
}
export function finiteNumeric(value: ClientDataValue): number | null {
  if (typeof value !== 'number' && typeof value !== 'bigint') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
export function validFieldValue(value: ClientDataValue, kind: ClientDataFieldKind): boolean {
  if (value == null || (typeof value === 'number' && !Number.isFinite(value))) return false;
  if (kind === 'datetime-ns') return datetimeBigInt(value) !== null;
  if (kind === 'numeric') return finiteNumeric(value) !== null;
  if (kind === 'boolean') return typeof value === 'boolean' || value === 0 || value === 1;
  return true;
}

/** Compile once, without eval/Function or per-row AST traversal. */
export function compileDataExpression(expression: ClientDataExpression, fields: Fields, predicate: PredicateCompiler): CompiledExpression {
  if (!expression || typeof expression !== 'object') throw new TypeError('Client expressions must be objects.');
  const compile = (value: ClientDataExpression) => compileDataExpression(value, fields, predicate);
  const finite = (value: number) => Number.isFinite(value) ? value : null;
  if (expression.op === 'field') {
    if (!Object.hasOwn(fields, expression.field)) throw new TypeError(`Unknown client data field "${expression.field}".`);
    const field = fields[expression.field]!;
    return { kind: field.kind, read: (row) => validFieldValue(field.values[row], field.kind) ? field.values[row] : null };
  }
  if (expression.op === 'literal') {
    const value = expression.value;
    if (value !== null && !['number', 'boolean', 'string'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('Client literal requires a finite JSON scalar or null.');
    return { kind: typeof value === 'string' ? 'categorical' : typeof value === 'boolean' ? 'boolean' : 'numeric', read: () => value };
  }
  if (expression.op === 'case') {
    if (!Array.isArray(expression.branches)) throw new TypeError('Client case requires branches.');
    const branches = expression.branches.map((b) => ({ when: predicate(b.when, fields), value: compile(b.value) }));
    const fallback = compile(expression.fallback);
    const values = [...expression.branches.map((b) => b.value), expression.fallback];
    const compiled = [...branches.map((b) => b.value), fallback];
    const kind = compiled.find((_, i) => !(values[i]?.op === 'literal' && values[i].value === null))?.kind ?? 'numeric';
    compiled.forEach((v, i) => {
      if (v.kind !== kind && !(values[i]?.op === 'literal' && values[i].value === null)) throw new TypeError('Client case branches must have compatible types.');
    });
    return { kind, read: (row) => { for (const b of branches) if (b.when(row)) return b.value.read(row); return fallback.read(row); } };
  }
  if (expression.op === 'coalesce' || expression.op === 'concat') {
    if (!Array.isArray(expression.args) || expression.args.length === 0) throw new TypeError('Client coalesce/concat requires at least one argument.');
    const args = expression.args.map(compile);
    if (expression.op === 'concat') return { kind: 'categorical', read: (row) => args.map((arg) => arg.read(row) ?? '').join('') };
    const nonNull = args.filter((_, i) => !(expression.args[i]?.op === 'literal' && expression.args[i].value === null));
    const kind = nonNull[0]?.kind ?? 'numeric';
    if (nonNull.some((arg) => arg.kind !== kind)) throw new TypeError('Client coalesce arguments must have compatible types.');
    return { kind, read: (row) => { for (const arg of args) { const value = arg.read(row); if (value != null) return value; } return null; } };
  }
  if ('input' in expression) {
    const input = compile(expression.input);
    if (expression.op === 'lower' || expression.op === 'upper' || expression.op === 'trim') {
      if (input.kind !== 'categorical') throw new TypeError('Client string operations require a categorical input.');
      return { kind: 'categorical', read: (row) => { const value = input.read(row); return value == null ? null : expression.op === 'lower' ? String(value).toLowerCase() : expression.op === 'upper' ? String(value).toUpperCase() : String(value).trim(); } };
    }
    const functions = { abs: Math.abs, negate: (n: number) => -n, log: Math.log, log10: Math.log10, sqrt: Math.sqrt, exp: Math.exp, round: Math.round, floor: Math.floor, ceil: Math.ceil };
    const operation = functions[expression.op];
    if (!operation || input.kind !== 'numeric') throw new TypeError('Client numeric operation requires a numeric input.');
    return { kind: 'numeric', read: (row) => { const value = finiteNumeric(input.read(row)); return value === null ? null : finite(operation(value)); } };
  }
  if ('left' in expression && 'right' in expression) {
    const left = compile(expression.left); const right = compile(expression.right);
    if (expression.op === 'subtract' && left.kind === 'datetime-ns' && right.kind === 'datetime-ns') return { kind: 'numeric', read: (row) => {
      const a = datetimeBigInt(left.read(row)); const b = datetimeBigInt(right.read(row));
      return a === null || b === null ? null : finite(Number(a - b));
    } };
    if (left.kind !== 'numeric' || right.kind !== 'numeric') throw new TypeError('Client arithmetic requires numeric inputs (or two datetimes for subtraction).');
    const operations = { add: (a: number, b: number) => a + b, subtract: (a: number, b: number) => a - b, multiply: (a: number, b: number) => a * b, divide: (a: number, b: number) => a / b, modulo: (a: number, b: number) => a % b, power: Math.pow, min: Math.min, max: Math.max };
    const operation = operations[expression.op];
    if (!operation) throw new TypeError(`Unsupported client expression "${expression.op}".`);
    return { kind: 'numeric', read: (row) => { const a = finiteNumeric(left.read(row)); const b = finiteNumeric(right.read(row)); return a === null || b === null ? null : finite(operation(a, b)); } };
  }
  throw new TypeError(`Unsupported client expression "${String((expression as { op?: unknown }).op)}".`);
}
