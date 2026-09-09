import assert from 'node:assert/strict';

import {
  createClientDataView,
  evaluateClientDataPredicate,
  type ClientDataSet,
  type ClientDataViewChangeEvent,
} from '../../packages/m-charts/src/client-data-view/index.ts';
import {
  createFastScatterClientDataView,
  evaluateFastScatterClientView,
  selectFastScatterSourceIndicesInBounds,
  type FastScatterPointColumns,
} from '../../packages/m-charts/src/m-scatter/index.ts';

const dataset: ClientDataSet = {
  datasetKey: 'measurements',
  datasetVersion: 'v1',
  fields: {
    accepted: { kind: 'boolean', values: new Uint8Array([1, 0, 1, 1, 1]) },
    category: { kind: 'categorical', values: ['a', 'noise', 'a', 'b', 'b'] },
    group: { kind: 'categorical', values: ['left', 'left', 'left', 'right', 'right'] },
    nullable: { kind: 'numeric', values: [1, null, Number.NaN, 4, 5] },
    time: { kind: 'datetime-ns', values: [1n, 2n, 3n, 4n, 5n] },
    value: { kind: 'numeric', values: new Float64Array([1, 100, 4, 10, 16]) },
  },
  rowCount: 5,
};

const changes: ClientDataViewChangeEvent[] = [];
const filterChanges: ClientDataViewChangeEvent[] = [];
const styleChanges: ClientDataViewChangeEvent[] = [];
const transformationChanges: ClientDataViewChangeEvent[] = [];
const view = createClientDataView({ dataset });
view.on('change', (event) => changes.push(event));
view.on('filterchange', (event) => filterChanges.push(event));
view.on('stylechange', (event) => styleChanges.push(event));
view.on('transformationchange', (event) => transformationChanges.push(event));

view.addFilter({
  id: 'accepted-category-and-time',
  predicate: {
    args: [
      { field: 'accepted', op: 'eq', value: true },
      { field: 'category', op: 'notIn', values: ['noise'] },
      { field: 'time', min: '1', max: '5', op: 'between' },
    ],
    op: 'and',
  },
});
view.addTransformation({
  direction: 'forward',
  id: 'filtered-delta',
  input: 'value',
  missingValue: 'zero',
  op: 'difference',
  orderBy: 'time',
  output: 'delta',
  partitionBy: ['group'],
});
view.addTransformation({
  factor: 2,
  id: 'scaled-delta',
  input: 'delta',
  offset: 1,
  op: 'affine',
  output: 'scaledDelta',
});
view.addStyle({
  channels: {
    color: { field: 'category', op: 'hashedColor' },
    opacity: {
      branches: [{
        value: { op: 'constant', value: 0.35 },
        when: { field: 'accepted', op: 'eq', value: true },
      }],
      fallback: { op: 'constant', value: 1 },
      op: 'case',
    },
    rotation: {
      domain: [1, 16],
      field: 'value',
      op: 'continuous',
      range: [0, Math.PI],
    },
    shape: {
      fallback: { op: 'constant', value: 4 },
      field: 'category',
      op: 'categorical',
      values: { a: 2 },
    },
    size: {
      domain: [1, 16],
      field: 'value',
      op: 'continuous',
      range: [3, 9],
    },
  },
  id: 'all-style-channels',
});

const evaluation = view.evaluate();
assert.deepEqual(Array.from(evaluation.activeSourceIndices), [0, 2, 3, 4]);
assert.equal(evaluation.metrics.activeRowCount, 4);
assert.equal(evaluation.metrics.backend, 'typescript');
assert.equal(evaluation.activeMask[0], 0b1_1101);
assert.deepEqual(
  Array.from(evaluation.fields.delta!.values as Float64Array),
  [3, Number.NaN, 0, 6, 0],
);
assert.deepEqual(
  Array.from(evaluation.fields.scaledDelta!.values as Float64Array),
  [7, Number.NaN, 1, 13, 1],
);
assert.equal(evaluation.styles.color?.assigned[1], 0);
assert.equal(evaluation.styles.color?.values[0], evaluation.styles.color?.values[2]);
assert.notEqual(evaluation.styles.color?.values[0], evaluation.styles.color?.values[3]);
assert.equal(evaluation.styles.opacity?.values[0], Math.fround(0.35));
assert.equal(evaluation.styles.shape?.values[0], 2);
assert.equal(evaluation.styles.shape?.values[3], 4);
assert.equal(evaluation.styles.size?.values[0], 3);
assert.equal(evaluation.styles.size?.values[4], 9);

const continuousColorView = createClientDataView({ dataset });
continuousColorView.addStyle({
  channels: {
    color: {
      domain: [1, 16],
      field: 'value',
      op: 'continuous',
      range: ['#000000', '#ffffff'],
    },
  },
  id: 'continuous-color',
});
const continuousColors = continuousColorView.evaluate().styles.color?.values;
assert.equal(continuousColors?.[0], 0x000000ff);
assert.equal(continuousColors?.[4], 0xffffffff);

assert.equal(filterChanges.length, 1);
assert.equal(styleChanges.length, 1);
assert.equal(transformationChanges.length, 2);
assert.equal(changes.length, 4);
assert.equal(changes[0]?.operation, 'add');
assert.equal(view.evaluate(), evaluation, 'the validated evaluation is cached after a change');

const exported = view.exportState();
assert.doesNotThrow(() => JSON.stringify(exported));
assert.notEqual(exported, view.getState());
assert.deepEqual(view.getFilters(), exported.filters);
assert.deepEqual(view.getStyles(), exported.styles);
assert.deepEqual(view.getTransformations(), exported.transformations);

view.reorderTransformations(['filtered-delta', 'scaled-delta']);
assert.deepEqual(view.getTransformations().map(({ id }) => id), ['filtered-delta', 'scaled-delta']);
assert.throws(
  () => view.reorderTransformations(['scaled-delta']),
  /contain every ID exactly once/u,
);
view.updateFilter('accepted-category-and-time', {
  enabled: false,
  id: 'ignored-by-update',
  predicate: { field: 'value', op: 'gt', value: 5 },
});
assert.equal(view.getFilters()[0]?.id, 'accepted-category-and-time');
view.removeStyle('all-style-channels');
assert.equal(view.getStyles().length, 0);

const importedView = createClientDataView({ dataset });
importedView.replaceState(exported);
assert.equal(importedView.getState().revision, 1);
assert.deepEqual(Array.from(importedView.evaluate().activeSourceIndices), [0, 2, 3, 4]);
assert.throws(
  () => importedView.replaceState({ ...exported, datasetVersion: 'other' }),
  /datasetVersion does not match/u,
);

assert.equal(
  evaluateClientDataPredicate(
    {
      op: 'pointInPolygon',
      points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }],
      xField: 'time',
      yField: 'value',
    },
    dataset.fields,
    2,
  ),
  true,
);
assert.equal(
  evaluateClientDataPredicate(
    {
      op: 'pointInPolygon',
      points: [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 5 }, { x: 1, y: 5 }],
      xField: 'time',
      yField: 'value',
    },
    dataset.fields,
    0,
  ),
  true,
  'selection-derived polygon filters include boundary points',
);
assert.equal(
  evaluateClientDataPredicate({ field: 'nullable', op: 'isNull' }, dataset.fields, 2),
  true,
);

const scatterColumns: FastScatterPointColumns = {
  color: new Uint32Array([0x111111ff, 0x222222ff, 0x333333ff]),
  colorFormat: 'rgba32',
  ids: ['a', 'b', 'c'],
  opacity: new Float32Array([1, 0.8, 0.6]),
  size: new Float32Array([3, 4, 5]),
  x: new Float64Array([0, 1, 2]),
  y: { value: new Float64Array([10, 20, 30]) },
};
const scatterView = createFastScatterClientDataView({
  columns: scatterColumns,
  datasetKey: 'scatter',
  fields: { selectedInApplication: { kind: 'boolean', values: new Uint8Array([1, 0, 1]) } },
});
scatterView.addFilter({
  id: 'keep-application-selection',
  predicate: { field: 'selectedInApplication', op: 'eq', value: true },
});
scatterView.addTransformation({
  factor: 0.5,
  id: 'halve-y',
  input: 'value',
  offset: 0,
  op: 'affine',
  output: 'value',
});
scatterView.addStyle({
  channels: { size: { op: 'constant', value: 9 } },
  id: 'large',
});
const scatterEvaluation = evaluateFastScatterClientView({ view: scatterView }, scatterColumns);
assert.deepEqual(Array.from(scatterEvaluation.activeSourceIndices), [0, 2]);
assert.deepEqual(Array.from(scatterEvaluation.interactionColumns.x), [0, 1, 2]);
assert.deepEqual(Array.from(scatterEvaluation.renderColumns.y.value!), [5, Number.NaN, 15]);
assert.deepEqual(Array.from(scatterEvaluation.interactionColumns.y.value!), [5, Number.NaN, 15]);
assert.deepEqual(Array.from(scatterEvaluation.renderColumns.size!), [9, 4, 9]);
assert.equal(scatterEvaluation.renderColumns.color, scatterColumns.color);
assert.deepEqual(
  Array.from(selectFastScatterSourceIndicesInBounds(scatterEvaluation.interactionColumns, {
    x: { min: 1.5, max: 2.5 },
    y: { min: 14, max: 16 },
    yKey: 'value',
  })),
  [2],
  'filtered holes must not invalidate sorted-X selection lookup',
);

scatterView.addTransformation({
  factor: -1,
  id: 'reverse-x',
  input: 'x',
  offset: 0,
  op: 'affine',
  output: 'x',
});
const transformedXEvaluation = evaluateFastScatterClientView({ view: scatterView }, scatterColumns);
assert.deepEqual(Array.from(transformedXEvaluation.renderColumns.x), [0, Number.NaN, -2]);
assert.deepEqual(Array.from(transformedXEvaluation.renderColumns.xOrder ?? []), [2, 0, 1]);
assert.deepEqual(
  Array.from(selectFastScatterSourceIndicesInBounds(transformedXEvaluation.interactionColumns, {
    x: { min: -2.5, max: -1.5 },
    y: { min: 14, max: 16 },
    yKey: 'value',
  })),
  [2],
  'transformed X must publish a matching sort order for interactions',
);

const rgba8Columns: FastScatterPointColumns = {
  color: new Uint8Array([
    0x11, 0x22, 0x33, 0x44,
    0x55, 0x66, 0x77, 0x88,
  ]),
  colorFormat: 'rgba8',
  ids: ['left', 'right'],
  x: new Float64Array([0, 1]),
  y: { value: new Float64Array([2, 3]) },
};
const rgba8View = createFastScatterClientDataView({ columns: rgba8Columns });
rgba8View.addStyle({
  channels: { size: { op: 'constant', value: 7 } },
  id: 'size-only',
});
const rgba8Evaluation = evaluateFastScatterClientView({ view: rgba8View }, rgba8Columns);
assert.equal(rgba8Evaluation.renderColumns.color, rgba8Columns.color);
assert.equal(rgba8Evaluation.renderColumns.colorFormat, 'rgba8');

const datetimeDifferenceView = createClientDataView({
  dataset: {
    fields: {
      time: {
        kind: 'datetime-ns',
        values: [1_700_000_000_000_000_000n, 1_700_000_000_000_000_001n],
      },
    },
    rowCount: 2,
  },
});
datetimeDifferenceView.addTransformation({
  direction: 'forward',
  id: 'nanosecond-delta',
  input: 'time',
  op: 'difference',
  output: 'delta',
});
assert.deepEqual(
  Array.from(datetimeDifferenceView.evaluate().fields.delta!.values as Float64Array),
  [1, Number.NaN],
);

const partitionBy = ['group'];
const detachedStateView = createClientDataView({ dataset });
detachedStateView.addTransformation({
  direction: 'backward',
  id: 'detached-partition',
  input: 'value',
  op: 'difference',
  output: 'delta',
  partitionBy,
});
partitionBy[0] = 'category';
const detachedTransformation = detachedStateView.getTransformations()[0];
assert.equal(detachedTransformation?.op, 'difference');
assert.deepEqual(detachedTransformation?.op === 'difference' ? detachedTransformation.partitionBy : undefined, ['group']);

const revisionBeforeInvalidMutation = detachedStateView.getState().revision;
assert.throws(
  () => detachedStateView.addFilter({
    id: 'invalid-op',
    predicate: { field: 'value', op: 'unsupported-op', value: 1 } as never,
  }),
  /Unsupported client predicate op/u,
);
assert.equal(detachedStateView.getState().revision, revisionBeforeInvalidMutation);
assert.throws(
  () => detachedStateView.addFilter({
    id: 'invalid-numeric-operand',
    predicate: { field: 'value', op: 'gte', value: '10' },
  }),
  /numeric field requires finite numbers/u,
);
assert.throws(
  () => detachedStateView.addTransformation({
    id: 'invalid-transform',
    input: 'value',
    op: 'mystery',
    output: 'other',
  } as never),
  /unsupported op/u,
);
assert.throws(
  () => detachedStateView.addStyle({
    channels: { size: { op: 'mystery' } as never },
    id: 'invalid-style-expression',
  }),
  /Unsupported client style expression op/u,
);
assert.throws(
  () => detachedStateView.addStyle({
    channels: { weight: { op: 'constant', value: 2 } } as never,
    id: 'invalid-style-channel',
  }),
  /unknown channel/u,
);

scatterView.replaceState({
  ...scatterView.exportState(),
  revision: scatterView.getState().revision,
  sourceStyleMode: 'ignore',
  styles: [],
});
const ignoredStyles = evaluateFastScatterClientView({ view: scatterView }, scatterColumns);
assert.equal(ignoredStyles.renderColumns.color, undefined);
assert.equal(ignoredStyles.renderColumns.opacity, undefined);
assert.equal(ignoredStyles.renderColumns.size, undefined);

const emptyView = createClientDataView({
  dataset: { fields: { value: { kind: 'numeric', values: [] } }, rowCount: 0 },
});
assert.throws(
  () => emptyView.addStyle({
    channels: { size: { field: 'missing', op: 'continuous', domain: [0, 1], range: [1, 2] } },
    id: 'invalid-even-without-active-rows',
  }),
  /Unknown client data field "missing"/u,
);

const performanceCount = 100_000;
const performanceValues = Float64Array.from(
  { length: performanceCount },
  (_, index) => index,
);
const performanceView = createClientDataView({
  dataset: {
    fields: {
      category: { kind: 'categorical', values: new Uint8Array(performanceCount) },
      value: { kind: 'numeric', values: performanceValues },
    },
    rowCount: performanceCount,
  },
  state: {
    filters: [{
      id: 'upper-half',
      predicate: { field: 'value', op: 'gte', value: performanceCount / 2 },
    }],
    styles: [{
      channels: {
        color: { field: 'category', op: 'hashedColor' },
        size: { domain: [0, performanceCount], field: 'value', op: 'continuous', range: [1, 8] },
      },
      id: 'derived-styles',
    }],
    transformations: [{
      factor: 2,
      id: 'scaled',
      input: 'value',
      offset: 1,
      op: 'affine',
      output: 'scaled',
    }],
  },
});
const performanceStartedAt = performance.now();
const performanceEvaluation = performanceView.evaluate();
assert.equal(performanceEvaluation.metrics.activeRowCount, performanceCount / 2);
assert.ok(
  performance.now() - performanceStartedAt < 5_000,
  'the representative 100k-row local pipeline should complete within five seconds',
);

// Compiled membership matches scalar evaluation, including coercion and nulls.
for (const [field, candidates] of [
  ['accepted', [true]], ['time', ['1', '3']], ['value', [1, 16]],
  ['category', ['a']], ['nullable', [1, 4]],
] as const) {
  for (const op of ['in', 'notIn'] as const) {
    const predicate = { field, op, values: candidates };
    const membershipView = createClientDataView({ dataset });
    membershipView.addFilter({ id: 'membership', predicate });
    assert.deepEqual(Array.from(membershipView.evaluate().activeSourceIndices),
      Array.from({ length: dataset.rowCount }, (_, i) => i)
        .filter((i) => evaluateClientDataPredicate(predicate, dataset.fields, i)));
  }
}

// Source-row filters retain exact selections after noninvertible transforms.
const selectionView = createClientDataView({ dataset: {
  rowCount: 4,
  fields: {
    row: { kind: 'numeric', values: new Uint32Array([0, 1, 2, 3]) },
    y: { kind: 'numeric', values: new Float64Array([10, 20, 50, 90]) },
  },
} });
selectionView.addTransformation({ id: 'delta', op: 'difference', direction: 'forward', input: 'y', output: 'y' });
selectionView.addFilter({ id: 'selected', predicate: { field: 'row', op: 'in', values: [1, 2] } });
assert.deepEqual(Array.from(selectionView.evaluate().activeSourceIndices), [1, 2]);
selectionView.addFilter({ id: 'exclude', predicate: { field: 'row', op: 'notIn', values: [2] } });
assert.deepEqual(Array.from(selectionView.evaluate().activeSourceIndices), [1]);
selectionView.removeFilter('exclude');
assert.deepEqual(Array.from(selectionView.evaluate().activeSourceIndices), [1, 2]);

// A disabled transformation cannot supply a field to another operation.
const disabledView = createClientDataView({ dataset });
assert.throws(() => disabledView.replaceState({ ...disabledView.exportState(),
  transformations: [
    { id: 'disabled', enabled: false, op: 'affine', input: 'value', output: 'ghost', factor: 1, offset: 0 },
    { id: 'consumer', op: 'affine', input: 'ghost', output: 'result', factor: 1, offset: 0 },
  ],
}), /Unknown client data field/);
assert.equal(disabledView.getState().revision, 0);

// A style edit must reuse all upstream buffers, including the masked interaction
// coordinates. Toggling only the style base does not rerun any evaluator stage.
const cachedBinding = { view: createFastScatterClientDataView({ columns: scatterColumns }) };
cachedBinding.view.addFilter({ id: 'keep', predicate: { op: 'gt', field: 'x', value: 0 } });
cachedBinding.view.addTransformation({
  id: 'delta', op: 'difference', input: 'value', output: 'value', direction: 'forward',
});
const beforeStyle = cachedBinding.view.evaluate();
const beforeStyleScatter = evaluateFastScatterClientView(cachedBinding, scatterColumns);
cachedBinding.view.addStyle({ id: 'size', channels: { size: { op: 'constant', value: 7 } } });
const afterStyle = cachedBinding.view.evaluate();
const afterStyleScatter = evaluateFastScatterClientView(cachedBinding, scatterColumns);
assert.equal(afterStyle.activeMask, beforeStyle.activeMask);
assert.equal(afterStyle.activeSourceIndices, beforeStyle.activeSourceIndices);
assert.equal(afterStyle.fields, beforeStyle.fields);
assert.equal(afterStyle.metrics.filterMs, 0);
assert.equal(afterStyle.metrics.transformationMs, 0);
assert.equal(afterStyleScatter.renderColumns.x, beforeStyleScatter.renderColumns.x);
assert.equal(afterStyleScatter.interactionColumns.y, beforeStyleScatter.interactionColumns.y);
cachedBinding.view.replaceState({ ...cachedBinding.view.exportState(), sourceStyleMode: 'ignore' });
assert.equal(cachedBinding.view.evaluate().styles, afterStyle.styles);
assert.equal(cachedBinding.view.evaluate().metrics.styleMs, 0);
cachedBinding.view.updateFilter('keep', { id: 'keep', predicate: { op: 'gte', field: 'x', value: 0 } });
assert.notEqual(cachedBinding.view.evaluate().activeMask, afterStyle.activeMask);
assert.notEqual(cachedBinding.view.evaluate().fields, afterStyle.fields);
assert.notEqual(cachedBinding.view.evaluate().styles, afterStyle.styles);
assert.throws(() => (cachedBinding.view.getFilters() as unknown[]).push({ id: 'illegal' }), TypeError);

const unsortedColumns: FastScatterPointColumns = {
  ids: ['high', 'low', 'middle', 'invalid'],
  x: new Float64Array([10, 0, 5, Number.NaN]),
  y: { value: new Float64Array([1, 2, 3, 4]) },
};
const unsortedBinding = { view: createFastScatterClientDataView({ columns: unsortedColumns }) };
const sortedProjection = evaluateFastScatterClientView(unsortedBinding, unsortedColumns);
assert.equal(sortedProjection.renderColumns.x, unsortedColumns.x);
assert.deepEqual(Array.from(sortedProjection.renderColumns.xOrder!), [1, 2, 0, 3]);
assert.deepEqual(Array.from(selectFastScatterSourceIndicesInBounds(sortedProjection.interactionColumns, {
  x: { min: 9, max: 11 }, y: { min: 0, max: 2 }, yKey: 'value',
})), [0]);

const unstyledColumns: FastScatterPointColumns = {
  ids: ['first', 'second'], x: new Float64Array([0, 1]), y: { value: new Float64Array([2, 3]) },
};
const themeBinding = { view: createFastScatterClientDataView({ columns: unstyledColumns }) };
themeBinding.view.addStyle({
  id: 'first-red', when: { op: 'eq', field: 'x', value: 0 },
  channels: { color: { op: 'constant', value: '#ff0000' } },
});
const themed = evaluateFastScatterClientView(themeBinding, unstyledColumns, [255, 128, 64, 255]);
assert.deepEqual(Array.from(themed.renderColumns.color!), [0xff0000ff, 0xff8040ff]);
const rethemed = evaluateFastScatterClientView(themeBinding, unstyledColumns, [0, 128, 255, 255]);
assert.deepEqual(Array.from(rethemed.renderColumns.color!), [0xff0000ff, 0x0080ffff]);
themeBinding.view.replaceState({ ...themeBinding.view.exportState(), sourceStyleMode: 'ignore' });
assert.deepEqual(Array.from(evaluateFastScatterClientView(
  themeBinding, unstyledColumns, [0, 128, 255, 255],
).renderColumns.color!), [0xff0000ff, 0x0080ffff]);

const subscriberErrors: unknown[] = [];
const resilientView = createClientDataView({ dataset, onListenerError: (error) => subscriberErrors.push(error) });
const notifications: string[] = [];
resilientView.on('change', () => { throw new Error('Persistence unavailable'); });
resilientView.on('change', (event) => {
  notifications.push(`change:${event.state.revision}`);
  if (event.state.revision === 1) resilientView.addFilter({ id: 'nested', predicate: { op: 'isValid', field: 'value' } });
});
resilientView.on('filterchange', (event) => notifications.push(`filter:${event.state.revision}`));
assert.doesNotThrow(() => resilientView.addFilter({ id: 'initial', predicate: { op: 'isValid', field: 'value' } }));
assert.deepEqual(notifications, ['change:1', 'filter:1', 'change:2', 'filter:2']);
assert.equal(subscriberErrors.length, 2);
assert.equal(resilientView.getState().revision, 2);

const unusualCategories = createClientDataView({ dataset: {
  rowCount: 3, fields: { label: { kind: 'categorical', values: ['constructor', '__proto__', 'toString'] } },
} });
unusualCategories.addStyle({ id: 'fallback', channels: {
  color: { op: 'categorical', field: 'label', values: {}, fallback: { op: 'constant', value: '#ff0000' } },
} });
assert.deepEqual(Array.from(unusualCategories.evaluate().styles.color!.values), [0xff0000ff, 0xff0000ff, 0xff0000ff]);
const outOfOrderDifference = createClientDataView({ dataset: {
  rowCount: 3, fields: {
    time: { kind: 'numeric', values: [3, 1, 2] },
    value: { kind: 'numeric', values: [30, 10, 20] },
  },
} });
outOfOrderDifference.addTransformation({
  id: 'ordered', op: 'difference', input: 'value', output: 'delta',
  orderBy: 'time', direction: 'forward', missingValue: 'zero',
});
assert.deepEqual(Array.from(outOfOrderDifference.evaluate().fields.delta!.values as Float64Array), [0, 10, 10]);
