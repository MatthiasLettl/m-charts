export type ClientDataFieldKind =
  | 'numeric'
  | 'datetime-ns'
  | 'categorical'
  | 'boolean';

/** JSON-serializable scalar used by exported filter and style state. */
export type ClientDataScalar = boolean | number | string;
/** Resident columns may additionally use bigint for lossless datetime-ns values. */
export type ClientDataValue = ClientDataScalar | bigint | null | undefined;
export type ClientDataFieldValues = ArrayLike<ClientDataValue>;

export interface ClientDataField {
  readonly kind: ClientDataFieldKind;
  readonly values: ClientDataFieldValues;
}

export interface ClientDataSet {
  readonly datasetKey?: string;
  readonly datasetVersion?: string;
  readonly fields: Readonly<Record<string, ClientDataField>>;
  readonly rowCount: number;
}

/** A serializable expression; invalid arithmetic produces null, never infinity. */
export type ClientDataExpression =
  | { readonly op: 'field'; readonly field: string }
  | { readonly op: 'literal'; readonly value: ClientDataScalar | null }
  | { readonly op: 'add' | 'subtract' | 'multiply' | 'divide' | 'modulo' | 'power' | 'min' | 'max'; readonly left: ClientDataExpression; readonly right: ClientDataExpression }
  | { readonly op: 'abs' | 'negate' | 'log' | 'log10' | 'sqrt' | 'exp' | 'round' | 'floor' | 'ceil' | 'lower' | 'upper' | 'trim'; readonly input: ClientDataExpression }
  | { readonly op: 'coalesce' | 'concat'; readonly args: readonly ClientDataExpression[] }
  | { readonly op: 'case'; readonly branches: readonly { readonly when: ClientDataPredicate; readonly value: ClientDataExpression }[]; readonly fallback: ClientDataExpression };

export type ClientDataPredicate =
  | { readonly op: 'compare'; readonly left: ClientDataExpression; readonly right: ClientDataExpression; readonly comparison: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' }
  | { readonly op: 'contains' | 'startsWith' | 'endsWith'; readonly field: string; readonly value: string; readonly caseSensitive?: boolean }
  | { readonly op: 'and'; readonly args: readonly ClientDataPredicate[] }
  | { readonly op: 'or'; readonly args: readonly ClientDataPredicate[] }
  | { readonly op: 'not'; readonly arg: ClientDataPredicate }
  | {
      readonly op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte';
      readonly field: string;
      readonly value: ClientDataScalar;
    }
  | {
      readonly op: 'between';
      readonly field: string;
      readonly min: ClientDataScalar;
      readonly max: ClientDataScalar;
      readonly inclusive?: boolean;
    }
  | {
      readonly op: 'in' | 'notIn';
      readonly field: string;
      readonly values: readonly ClientDataScalar[];
    }
  | {
      readonly op: 'pointInPolygon';
      readonly points: readonly { readonly x: number; readonly y: number }[];
      readonly xField: string;
      readonly yField: string;
    }
  | { readonly op: 'isNull' | 'isValid'; readonly field: string };

export interface ClientDataFilter {
  /** Defaults to source. Transformed filters do not feed back into differences. */
  readonly stage?: 'source' | 'transformed';
  readonly enabled?: boolean;
  readonly id: string;
  readonly predicate: ClientDataPredicate;
}

export interface ClientDataAffineTransformation {
  readonly enabled?: boolean;
  readonly factor: number;
  readonly id: string;
  readonly input: string;
  readonly offset: number;
  readonly op: 'affine';
  readonly output: string;
}

export interface ClientDataDifferenceTransformation {
  readonly direction: 'backward' | 'forward';
  readonly enabled?: boolean;
  readonly id: string;
  readonly input: string;
  readonly missingValue?: 'null' | 'zero';
  readonly op: 'difference';
  readonly orderBy?: string;
  readonly output: string;
  readonly partitionBy?: readonly string[];
}

export type ClientDataTransformation =
  | { readonly op: 'calculate'; readonly id: string; readonly enabled?: boolean; readonly output: string; readonly expression: ClientDataExpression }
  | ClientDataAffineTransformation
  | ClientDataDifferenceTransformation;

export type ClientStyleChannel = 'color' | 'opacity' | 'rotation' | 'shape' | 'size';
export type ClientStyleValue = number | string;

export type ClientStyleExpression =
  | { readonly op: 'field'; readonly field: string }
  | { readonly op: 'constant'; readonly value: ClientStyleValue }
  | {
      readonly op: 'categorical';
      readonly field: string;
      /** Keys use the canonical `${type}:${value}` form or the plain string form. */
      readonly values?: Readonly<Record<string, ClientStyleValue>>;
      readonly fallback?: ClientStyleExpression;
    }
  | { readonly op: 'hashedColor'; readonly field: string }
  | {
      readonly clamp?: boolean;
      readonly domain: readonly [number, number];
      readonly field: string;
      readonly op: 'continuous';
      readonly range: readonly [ClientStyleValue, ClientStyleValue];
    }
  | {
      readonly branches: readonly {
        readonly value: ClientStyleExpression;
        readonly when: ClientDataPredicate;
      }[];
      readonly fallback?: ClientStyleExpression;
      readonly op: 'case';
    };

export interface ClientStyleRule {
  readonly channels: Partial<Readonly<Record<ClientStyleChannel, ClientStyleExpression>>>;
  readonly enabled?: boolean;
  readonly id: string;
  readonly when?: ClientDataPredicate;
}

export interface ClientDataViewState {
  readonly datasetKey?: string;
  readonly datasetVersion?: string;
  readonly filters: readonly ClientDataFilter[];
  readonly revision: number;
  readonly sourceStyleMode?: 'ignore' | 'preserve';
  readonly styles: readonly ClientStyleRule[];
  readonly transformations: readonly ClientDataTransformation[];
  readonly version: 1 | 2;
}

export type ClientDataViewChangeTarget = 'filter' | 'state' | 'style' | 'transformation';
export type ClientDataViewChangeOperation =
  | 'add'
  | 'remove'
  | 'reorder'
  | 'replace'
  | 'update';

export interface ClientDataViewChangeEvent {
  readonly operation: ClientDataViewChangeOperation;
  readonly origin: 'import' | 'local';
  readonly previousState: ClientDataViewState;
  readonly state: ClientDataViewState;
  readonly target: ClientDataViewChangeTarget;
  readonly targetId?: string;
}

export interface ClientDataViewEvaluationMetrics {
  readonly activeRowCount: number;
  /** Evaluator used for this materialized local projection. */
  readonly backend: 'typescript';
  readonly durationMs: number;
  readonly filterMs: number;
  readonly rowCount: number;
  readonly styleMs: number;
  readonly transformationMs: number;
}

export interface ClientComputedStyleChannel<TArray extends ArrayBufferView> {
  readonly assigned: Uint8Array;
  readonly values: TArray;
}

export interface ClientComputedStyles {
  readonly color?: ClientComputedStyleChannel<Uint32Array>;
  readonly opacity?: ClientComputedStyleChannel<Float32Array>;
  readonly rotation?: ClientComputedStyleChannel<Float32Array>;
  readonly shape?: ClientComputedStyleChannel<Uint8Array>;
  readonly size?: ClientComputedStyleChannel<Float32Array>;
}

export interface ClientDataViewEvaluation {
  readonly activeMask: Uint32Array;
  readonly activeSourceIndices: Uint32Array;
  readonly fields: Readonly<Record<string, ClientDataField>>;
  readonly metrics: ClientDataViewEvaluationMetrics;
  readonly revision: number;
  readonly styles: ClientComputedStyles;
}

export type ClientDataViewListener = (event: ClientDataViewChangeEvent) => void;
export type ClientDataViewUnsubscribe = () => void;

export interface ClientDataAsyncEvaluator {
  evaluate(dataset: ClientDataSet, state: ClientDataViewState): Promise<ClientDataViewEvaluation>;
  dispose?(): void;
}

export interface ClientDataView {
  readonly dataset: ClientDataSet;
  addFilter(filter: ClientDataFilter): void;
  addStyle(style: ClientStyleRule): void;
  addTransformation(transformation: ClientDataTransformation): void;
  evaluate(): ClientDataViewEvaluation;
  /** Reject a mutation before it becomes visible to any subscriber. */
  validateWith(validator: (evaluation: ClientDataViewEvaluation, state: ClientDataViewState) => void): ClientDataViewUnsubscribe;
  exportState(): ClientDataViewState;
  getFilters(): readonly ClientDataFilter[];
  getState(): Readonly<ClientDataViewState>;
  getStyles(): readonly ClientStyleRule[];
  getTransformations(): readonly ClientDataTransformation[];
  on(
    event: 'change' | 'filterchange' | 'stylechange' | 'transformationchange',
    listener: ClientDataViewListener,
  ): ClientDataViewUnsubscribe;
  removeFilter(id: string): void;
  removeStyle(id: string): void;
  removeTransformation(id: string): void;
  reorderFilters(ids: readonly string[]): void;
  reorderStyles(ids: readonly string[]): void;
  reorderTransformations(ids: readonly string[]): void;
  replaceState(state: ClientDataViewState): void;
  /** Atomic worker evaluation. Resolves false if superseded by another mutation. */
  replaceStateAsync(state: ClientDataViewState): Promise<boolean>;
  /** Stage ordinary mutations synchronously, evaluate once in the configured worker. */
  batchAsync(action: () => void): Promise<boolean>;
  /** Replace same-row metadata columns; attached plots validate their mappings first. */
  updateFields(fields: Readonly<Record<string, ClientDataField>>, datasetVersion?: string): void;
  /** Releases the optional evaluator and all subscriptions. Dispose plots first. */
  dispose(): void;
  updateFilter(id: string, filter: ClientDataFilter): void;
  updateStyle(id: string, style: ClientStyleRule): void;
  updateTransformation(id: string, transformation: ClientDataTransformation): void;
}

export interface CreateClientDataViewOptions {
  readonly asyncEvaluator?: ClientDataAsyncEvaluator;
  /** Receives subscriber errors after commit; other subscribers still run. Defaults to console.error. */
  readonly onListenerError?: (error: unknown, event: ClientDataViewChangeEvent) => void;
  readonly dataset: ClientDataSet;
  readonly state?: Partial<Omit<ClientDataViewState, 'revision' | 'version'>>;
}
