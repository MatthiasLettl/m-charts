# Client Data Views

Client data views are an additive, serializable pipeline for filtering,
transforming, and styling data that is already resident in the browser. The
WebGPU scatter, parallel-coordinate, and raw histogram plots all support
the same chart-independent `m-charts/client-data-view` controller.

If `clientView` is omitted, all existing chart contracts remain available. Existing
columns and embedded styles, selection callbacks, commands, streaming,
aggregation, WebGL2 use, and plot updates keep their current contracts.
Streaming append is rejected while a client view is attached.
With a view attached, the source dataset is creation-bound: recreate both the
view and plot to replace `columns`. Other mutable scatter options continue to
use `plot.update(...)`; repeatedly passing the same source-column object is a
no-op for the resident data.

## When To Use It

Opt in when users repeatedly explore the same loaded dataset: narrow a range,
keep selected rows, calculate a delta or ratio, or recolor records without a
server round trip. This is especially useful for large datasets, where fetching,
decoding, and uploading replacement source buffers for every edit can dominate
interaction latency. Keep the source resident and change the view configuration.
The controller never fetches data or initiates network requests.

Using a client view is optional. Keep the existing chart API when your app
already prepares the desired columns/styles, needs streaming append, or replaces
query results. Client filters only see resident rows; they cannot retrieve rows
or evaluate server-only query clauses that were not loaded. Complete a finite
load before attaching a view, and recreate both view and plot for a new dataset.

Buffer residency does not mean that the entire pipeline runs on the GPU or that
edits have no cost:

| Operation | Work performed and reused |
| --- | --- |
| Scatter/parallel filtering | Reuse immutable GPU source coordinates; update visibility and active/representative data. If transforms depend on filtered rows, recompute affected derived coordinates too. |
| Coordinate transformations | Evaluate derived fields and upload changed chart coordinates; preserve source rows and their identities. |
| Styling | Reuse unchanged coordinates; evaluate and upload changed style data, composing over source styles by default. |
| Raw histogram edits | Reuse resident CPU/WASM columns and unchanged sorted indexes, reaggregate affected bins/stacks, and upload the resulting bar geometry. Raw rows are not a GPU point buffer. |

The shared evaluator runs in TypeScript, synchronously by default or in an
optional module worker. WebGPU handles rendering/culling and parallel density;
WASM handles eligible aggregation/selection work. Masks, derived arrays, worker
copies, and GPU projections still consume memory and time. Measure evaluation
and settled-frame latency separately; zero source-upload bytes does not mean
zero derived uploads or zero aggregation work.

Start with the [complete source-copy example](../../docs/examples/client-data-view-source-copy.md)
for creation, filtering, calculations, styles, updates, persistence, and cleanup.
The package imports below describe workspace exports; external users should
follow the [source-copy guide](../../docs/source-copy-integration.md#optional-client-data-views).

## Mental Model And Execution Order

The immutable source dataset and mutable view state are separate:

1. Source columns are loaded once and retained in CPU/GPU storage.
2. Enabled source filters (`stage: 'source'`, the default) are ANDed.
3. Transformations execute, in array order, over those source-filtered rows.
4. Enabled `stage: 'transformed'` filters are ANDed over the resulting fields.
   They do not recalculate neighbors or feed back into transformations.
5. Style rules execute, in array order, over the final visible rows.
   Later matching rules override only the channels they assign.
6. WebGPU scatter swaps only its compact mask, X-ordered active-index list,
   and any derived coordinate or style buffers. It never removes filtered rows
   from source buffers. The active list receives the renderer's full LOD budget,
   so sparse filters remain representative above one million resident rows.

This matches a server flow that first queries a reduced dataset and then
calculates deltas and styles over that result. Difference transforms require a
direction and may specify `orderBy`, `partitionBy`, and missing-neighbor
behavior; source array order is the stable fallback without `orderBy`.

The generic evaluator currently reports `metrics.backend === 'typescript'`.
Visibility culling and drawing occur in WebGPU, source buffers stay resident,
and diagnostics report zero source-upload bytes for view changes. Derived
columns/styles upload only when those stages change. Unchanged filter masks,
transformed fields, and styles are reused between revisions; style-only edits
also reuse coordinate arrays and GPU coordinates. Scatter interaction consumers
read the visibility mask directly; filtering no longer allocates masked Y copies.
GPU work coalesces rapid revisions and retains at most one in-flight projection
plus the latest request. Constant style literals are encoded once, and difference
transforms avoid sorting already-ordered input.

Synchronous methods remain available and cache unchanged stages. For expensive
pipelines, configure the optional module worker and use `batchAsync` or
`replaceStateAsync`; the demos do this. First dataset construction, semantic
decoding, optional fingerprinting, and chart projection/upload preparation still
involve main-thread work. No frame-time guarantee applies to arbitrary rules or
row counts; measure representative pipelines on deployment devices.

### Optional worker evaluation

```ts
import { createClientDataViewWorkerEvaluator } from 'm-charts/client-data-view';

// workerUrl points to the bundled m-charts/client-data-view/worker entry.
// Resolve/bundle it with your application's module-worker tooling.
const asyncEvaluator = createClientDataViewWorkerEvaluator(
  new Worker(workerUrl, { type: 'module' }),
);
const view = createFastScatterClientDataView({ columns, asyncEvaluator });
const applied = await view.batchAsync(() => {
  view.addTransformation({
    id: 'ratio', op: 'calculate', output: 'ratio',
    expression: { op: 'divide',
      left: { op: 'field', field: 'pressure' },
      right: { op: 'field', field: 'baseline' } },
  });
  view.addFilter({ id: 'high-ratio', stage: 'transformed',
    predicate: { op: 'gt', field: 'ratio', value: 1.1 } });
});
// applied === false means a newer mutation superseded this request.
```

Use a dedicated evaluator per controller. The worker clones source columns once
per dataset identity; it never detaches caller buffers. This costs additional
memory, so large datasets should be measured before opting in. Unchanged masks,
fields, and styles retain their references when returned to the host. Requests
are bounded to one running evaluation plus the latest queued request. Stale
results cannot overwrite newer synchronous or asynchronous changes. Worker or
validation failures reject the promise and preserve the committed state.

`batchAsync` stages ordinary setters in a synchronous callback, evaluates once,
and emits one `change` event (`target: 'state'`). Do not await inside the callback
or nest batches. Separate overlapping batches start from the last committed
state; await dependent edits. Without an async evaluator these methods use the
same synchronous evaluator. Ordinary setters always remain synchronous, even
when a worker is configured. Dispose attached plots before `view.dispose()` to
release subscriptions and the worker. See the demo's worker URL setup for Vite.

## Creating And Attaching A View

```ts
import {
  createFastScatterClientDataView,
  createScatterPlot,
} from 'm-charts/m-scatter-webgpu';

const view = createFastScatterClientDataView({
  columns,
  datasetKey: 'measurements',
  datasetVersion: 'query-result-42',
  fields: {
    // Arbitrary application-owned metadata, joined to source-row order.
    isInSavedSelection: {
      kind: 'boolean',
      values: savedSelectionMembership, // Uint8Array of 0/1 values
    },
    phase: { kind: 'categorical', values: phaseCodes },
  },
});

const plot = createScatterPlot(host, {
  axisMode: 'xy',
  mode: 'zoom',
  clientView: { view },
  columns,
  spec,
  viewport,
  // all existing scatter options remain available
});
```

Fields have arbitrary host-defined names; names such as
`isInSavedSelection` are not hardcoded. If memberships live in a separate
database table, the host joins its IDs against `columns.ids` and supplies the
resulting boolean column. The chart assigns no business meaning to it.

By default, scatter fields are `columns.xKey ?? 'x'` and the keys of
`columns.y`; parallel fields are `buffers.axisOrder` keys; histogram fields are
`columns.valuesByParameter` keys. IDs and embedded style arrays do not
automatically become predicate fields. Declare additional fields explicitly,
aligned to the same source-row order.

To plot a derived field without overwriting its source, create the transform
before attaching the chart and map its output through `clientView.xField`,
`yFieldByKey`, `fieldByAxis`, or `fieldByParameter` as appropriate. For example,
`clientView: { view, yFieldByKey: { pressure: 'calibratedPressure' } }` maps the
existing `pressure` subplot to a derived output named `calibratedPressure`.
These mappings are creation-bound. A derived field used only by a filter or
style needs no chart mapping. Overwriting a plotted field's name affects the
view projection, never the immutable source array.

Every field has `rowCount` values and a kind of `numeric`, `datetime-ns`,
`categorical`, or `boolean`. Nanosecond source columns may use `bigint`;
serialized datetime predicate values should be decimal strings. Chart factories
decode category codes to semantic values, boolean codes to booleans, and
datetime display offsets to epoch nanoseconds; supplied `epochNsValues` preserve
sub-millisecond precision. Numeric scale/offset metadata is decoded too. Boolean typed
columns may use booleans or compact `Uint8Array` 0/1 values.

Data without style fields is valid. In `preserve` mode the renderer uses source
styles when present and each chart’s existing unstyled behavior otherwise
(including procedural indexed scatter styling and white histogram stacks). Client rules are computed
before the first frame, so no unstyled intermediate frame appears.
`sourceStyleMode: 'ignore'` starts from theme defaults. Conditional rules leave
unassigned channels at their source/theme values. Theme updates also refresh the
fallback color for rows without a color assignment. Static packed WebGPU
styles and paged packed-style factories can both be the preserved base. Paged
sources remain GPU-resident: per-channel client overrides are composed over the
immutable packed base without retaining expanded CPU style columns or refetching
style pages.

## Filter AST

The primary contract is a typed JSON AST, not SQL or Elasticsearch syntax. It
supports `and`, `or`, `not`, `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `between`,
`in`, `notIn`, `isNull`, `isValid`, `pointInPolygon`, `contains`, `startsWith`,
`endsWith`, and expression-to-expression `compare`:

```ts
view.addFilter({
  id: 'accepted-window',
  predicate: {
    op: 'and',
    args: [
      { op: 'eq', field: 'accepted', value: true },
      { op: 'between', field: 'timestampNs',
        min: '1700000000000000000', max: '1700003600000000000' },
      { op: 'in', field: 'phase', values: ['warmup', 'steady'] },
    ],
  },
});
```

Numeric predicate operands must be finite numbers, datetime-ns operands must
be safe integers or decimal strings, and boolean operands must be booleans or
0/1. `null`, `undefined`, `NaN`, and infinities fail ordinary comparisons and
membership tests; `isNull` matches them and `isValid` does not. `not` is a
logical negation of that two-valued result, so use an explicit `isValid` clause
when invalid values must also stay excluded from a negated predicate.

String predicates take `field`, `value`, and optional `caseSensitive` (default
`true`). Combine them with `not` for exclusions. `compare` takes `left` and
`right` calculation expressions and `comparison: 'eq' | 'ne' | 'gt' | 'gte' |
'lt' | 'lte'`, allowing field-to-field or calculated comparisons. Each filter
selects a stage; source-stage predicates cannot reference derived fields. Use
one `or` predicate for disjunctions within a stage, and `stage: 'transformed'`
when a clause combines source and derived fields.

An application that stores Elasticsearch query text, SQL, or another language
owns the adapter into this AST. It should translate supported semantics and
keep/refetch server-only clauses; unsupported clauses must never be silently
discarded. Persistence code may translate `exportState().filters` back into
its own schema. The chart does not import Elasticsearch, choose a transport,
or initiate a refetch.

Chart selection remains an ephemeral interaction and never filters by itself.
Applications may consume `selectionchange.filters` and call `addFilter` only
when their product action means “keep inside” or “keep outside.” Multiple box
or polygon regions are ORed for inside; outside is `not` around that OR. The
demo exposes both actions and binds them to `Alt+I` and `Alt+O`.

## Transformations

Affine, difference, and `calculate` transformations may overwrite a plotted field or create
a new field:

```ts
view.addTransformation({
  id: 'calibrated-pressure',
  op: 'affine',
  input: 'pressure',
  output: 'pressure',
  factor: 1.25,
  offset: -0.15,
});

view.addTransformation({
  id: 'pressure-forward-delta',
  op: 'difference',
  input: 'pressure',
  output: 'pressure',
  direction: 'forward',
  orderBy: 'timestampNs',
  partitionBy: ['sensorId'],
  missingValue: 'null', // or 'zero'
});
```

Each transform can consume fields produced by an earlier transform. Disabled
items remain in exported state but do not execute. Datetime differences
subtract bigint inputs before converting the delta to a numeric output, so
small nanosecond deltas are preserved; affine datetime outputs are numeric and
therefore have JavaScript number precision.

`calculate` has an `output` and a serializable `expression`:

- Inputs: `field` and JSON `literal` (including `null`).
- Binary arithmetic: `add`, `subtract`, `multiply`, `divide`, `modulo`, `power`,
  `min`, `max`, with `left` and `right` expressions.
- Unary math: `abs`, `negate`, `log` (natural), `log10`, `sqrt`, `exp`, `round`,
  `floor`, `ceil`, with `input`.
- Text: `lower`, `upper`, `trim` with `input`; `concat` with `args`.
- Missing values: `coalesce` chooses the first valid value from `args`.
- Conditional values: `case` takes ordered `{ when, value }` branches and a
  `fallback`. Non-null branches must have compatible types.

Output kind is inferred. Invalid arithmetic (division by zero, invalid logarithm,
overflow) becomes missing; numeric materialization uses `NaN`, other kinds use
`null`. `concat` treats missing inputs as empty strings. Subtracting two datetime
fields subtracts bigint epochs first, then returns a numeric nanosecond delta.
There is no arbitrary code execution. Transformed chart metadata is regenerated:
kind, categories, datetime encoding, and domains match displayed values. Explicit
host viewports remain under host control; fit/reset them after transforms when
desired. Removing a derived field still mapped to an attached chart is rejected
before the state/revision changes; replace the transform under the same output
name or recreate the binding to change its field mapping.

## Style Expressions

Rules set `color`, `opacity`, `rotation` (radians), `shape` (scatter shape
code), and `size`. Expressions are `constant`, explicit `categorical` maps,
`hashedColor`, numeric/color `continuous` interpolation, or predicate-driven
`case`. Direct `field` expressions read a supplied or calculated color/number
column, so calculations and conditions can drive every supported channel.
Hashed colors depend solely on the canonical field value, so the same
category always gets the same color and no user seed can change it.

```ts
view.addStyle({
  id: 'phase-and-pressure',
  channels: {
    color: { op: 'hashedColor', field: 'phase' },
    size: {
      op: 'continuous', field: 'pressure',
      domain: [980, 1040], range: [2, 9],
    },
    opacity: {
      op: 'case',
      branches: [{
        when: { op: 'eq', field: 'isInSavedSelection', value: true },
        value: { op: 'constant', value: 1 },
      }],
      fallback: { op: 'constant', value: 0.25 },
    },
  },
});
```

Explicit categorical maps accept plain keys (`steady`) or canonical keys
(`string:steady`). Saved-selection membership is simply another supplied
field.

## State, Callbacks, Persistence, And Synchronization

`getFilters()`, `getTransformations()`, `getStyles()`, and `getState()` inspect
the configuration through frozen snapshots. `exportState()` returns a detached, JSON-serializable,
versioned snapshot. `replaceState(snapshot)` validates operators, operands,
channels, transformations, and dataset identity before publishing it. Failed
mutations leave the prior state and revision untouched. Add, update, remove,
and reorder methods exist for every stage.

`updateFilter(id, filter)`, `updateTransformation(id, transformation)`, and
`updateStyle(id, style)` take complete replacement items, including their IDs,
rather than partial patches. Toggle an item with a copied snapshot and
`enabled: false`; reorder calls require every ID in that stage exactly once.
Use `replaceState` for one synchronous atomic edit, or `batchAsync` to group
ordinary setters into one evaluation and notification. There is no `view.reset()`:
save a baseline with `exportState()` and restore it with `replaceState(baseline)`.
Likewise, change the style base with
`view.replaceState({ ...view.exportState(), sourceStyleMode: 'ignore' })`.

```ts
const stop = view.on('change', (event) => {
  // event.target: filter | transformation | style | state
  // event.operation: add | update | remove | reorder | replace
  persistInApplicationSchema(event.state);
});

view.on('filterchange', notifyFilterUi);
view.on('transformationchange', notifyTransformUi);
view.on('stylechange', notifyStyleUi);
```

Callbacks run synchronously only after the complete next state has validated
and evaluated. Subscriber failures do not interrupt other subscribers or roll
back state. Set `onListenerError(error, event)` in `createClientDataView(...)` or
`createFastScatterClientDataView(...)` to report them through the host; the
default logs them with `console.error`. Reentrant changes are queued for
notification until all subscribers have seen the current event. `datasetKey`/`datasetVersion` prevent importing state for a
different resident dataset. Use a server/query content version that includes row
ordering, not just the row count. The chart factories optionally accept
`fingerprint: true` to compute `datasetVersion` from fields and row IDs once
(unless an explicit version was supplied). `createClientDataFingerprint` is
also exported. This deterministic checksum is for accidental mismatch detection,
not authentication; its full content scan has a startup cost.

`view.updateFields({ membership: { kind: 'boolean', values } }, newVersion?)`
replaces/adds same-row columns atomically and reevaluates the current pipeline.
The row count and order must stay unchanged. Content fingerprints update
automatically; hosts using their own dataset versions must supply an updated
version when relevant content changes. Do not mutate resident arrays in place.
For a new row identity/order, recreate both view and plot. `validateWith` adds a
precommit validator and returns an unsubscribe function; chart bindings use this
to prevent invalid mapped-field removals. Exported state remains version 1 for
legacy operations and automatically advances to version 2 when extended
expressions or transformed filters are used. Both versions can be imported;
older readers reject version 2 instead of applying different semantics.

A host may send the small snapshot through
`BroadcastChannel`, WebSocket, persistence, or another transport and call
`replaceState` in another chart/window. The dataset is never part of the state
or synchronization interface.

## Demo And Diagnostics

The `/m-scatter-webgpu` route adds a compact “Client data pipeline” panel for
non-streaming datasets. Numeric, category, and boolean presets combine with
selection filters. Right-drag a rectangle (or Space + right-drag a lasso) to
open selection actions: **Keep inside / remove outside** or **Keep outside /
remove inside**. Alt+I and Alt+O also apply these actions, except while editing
form fields. Escape, outside clicks, scrolling, or Dismiss close the popup.
Each action adds a removable filter and clears the ephemeral selection.

The demo declares a stable `sourceRow` numeric field and filters with `in` or
`notIn` over the selected source indices. This preserves exactly the selected
rows even after affine or noninvertible difference transforms, and successive
selections narrow the existing view. Geometric predicates over original fields
are suitable only when selection coordinates refer to those original fields.
Membership evaluation uses set lookups so large selections do not require a
scan of all selected indices for every resident row. The exported selection
filter contains row indices and is tied to the resident dataset's identity.

Linear transformations expose finite scale and offset inputs, including zero
and negative factors. Differences expose forward/backward direction, null/zero
missing-neighbor behavior, and optional phase or acceptance groups, ordered by
X. Transforms run in the displayed insertion order after filtering; updating
one preserves its position. Apply difference before linear to scale/offset the
delta. Applying/removing a transform fits its derived domain automatically.

The style preset computes all five channels and all five glyphs (circle,
rectangle, triangle, pin, arrow), distributed across row groups. Each channel
can be included independently. Color supports hashed categories or a numeric
blue-to-orange gradient; shape can be fixed to any glyph. Size (2–8 px) and
rotation (−180° to 180°) follow the numeric value, while reference membership
sets opacity (100% versus 52%). Inspect glyphs zooms to the first 200 active rows so individual glyphs can
be inspected even in dense datasets; Reset viewport restores the full view.
Apply adds a rule over the selected base, consistently across all three demos.
Choose Dataset styles to preserve source channels or Theme defaults to ignore
them. Matching rules override only their assigned channels.
The initial Dataset styles mode retains supplied packed styling, and Reset
all restores it and the original domain. Large modes retain compact paged
packed-style loading. Diagnostics include visible rows, evaluator backend/time,
source re-upload (`0 B`), network refetch (`none`), and a memoized JSON preview
with long arrays capped at 200 entries. Download pipeline state exports the
complete JSON; previews never change the actual filter membership.

For actual GPU browser validation use
`M_CHARTS_ENABLE_WEBGPU_E2E=1 pnpm test:e2e`; macOS uses native WebGPU flags and a headed browser for reliable canvas
presentation, while Linux uses the Vulkan test setup. GPU pixel comparisons capture the
composited canvas because WebGPU presentation textures are not persistent
`drawImage` readback buffers.

`plot.getWebgpuDiagnostics().clientView` exposes active count, revision,
evaluator backend/time, view-upload bytes, zero source-upload bytes, and the
active `styleSource` (`source`, `client-composed`, or `client-only`).

Unsorted source X values receive a sorted display index when a view is attached;
source buffers and row identities retain their original order. Invalid X values
are placed after finite values and excluded from finite viewport searches.
Precomputed source hover indexes are bypassed after coordinate transforms so
hover reflects the displayed coordinates; resetting transforms restores them.

The GPU regression suite in `tests/e2e/scatterClientView.spec.ts` compares canvas
pixels against plots without a view, exercises streaming capacity growth, theme
updates, transformed hover, callback failures, buffer reuse, and rapid resets.
It requires `M_CHARTS_ENABLE_WEBGPU_E2E=1` and fails if GPU initialization fails.

Diagnostics distinguish the requested `clientView.revision` from
`clientView.appliedRevision` and expose `clientView.pending`. `cacheReady` is
false while the requested projection is uploading and until a corresponding
frame is submitted. For capture/inspection, wait for `pending === false` and
`cacheReady === true`, then allow browser presentation. GPU tests use composited
canvas screenshots, never a WebGPU canvas `drawImage` readback.
Run the paged-style/LOD regression at ten million rows with
`M_CHARTS_ENABLE_WEBGPU_E2E=1 M_CHARTS_SCATTER_LARGE_E2E_ROWS=10000000 pnpm test:e2e tests/e2e/scatterClientView.spec.ts --grep 'large paged' --workers=1`.

## Parallel coordinates and histogram

These integrations are optional creation-time additions. They use the same
controller, predicate AST, ordered transformations, style expressions, atomic
state replacement, and change events described above. No server callbacks or
network requests are needed to edit the view.

| Chart | Factory | Binding mappings | Rendered style channels |
| --- | --- | --- | --- |
| Scatter | `createFastScatterClientDataView({ columns })` | `xField`, `yFieldByKey` | color, opacity, size, shape, rotation |
| Parallel | `createParallelClientDataView({ buffers })` | `fieldByAxis` | color, opacity |
| Histogram | `createHistogramClientDataView({ columns })` | `fieldByParameter` | color, opacity (embedded in stack color alpha) |

Each factory also accepts `fields`, `datasetKey`, `datasetVersion`, `fingerprint`,
`state`, `asyncEvaluator`, and `onListenerError`. `createParallelClientDataSet` / `createHistogramClientDataSet`
construct datasets for a separately managed shared controller.
`evaluateParallelClientView` / `evaluateHistogramClientView` expose projections
for host inspection, with unchanged source indices, IDs, and record identities.
The chart factories subscribe automatically and unsubscribe on disposal.
Channels that do not apply to a chart (such as glyph shape on a histogram) have
no rendering effect; a controller can still be shared with a scatter chart.

```ts
import {
  createParallelClientDataView,
  createParallelWebgpuPlot,
} from 'm-charts/m-parallel-webgpu';

// Finish loading every CPU column before creating a resident view. Lazy
// decoder columns that are still being filled are not an immutable dataset.
const view = createParallelClientDataView({
  buffers,
  datasetKey: 'measurements',
  datasetVersion: 'v1',
  fields: {
    sourceRow: { kind: 'numeric', values: Uint32Array.from(
      { length: buffers.recordCount }, (_, row) => row,
    ) },
  },
});
const plot = createParallelWebgpuPlot(host, { buffers, clientView: { view } });
await plot.ready;
view.addFilter({ id: 'range', predicate: {
  op: 'between', field: 'signal', min: 10, max: 80,
} });
view.addTransformation({
  id: 'scale', op: 'affine', input: 'signal', output: 'signal', factor: 2, offset: 0,
});
view.addStyle({ id: 'color', channels: {
  color: { op: 'continuous', field: 'signal', domain: [20, 160], range: ['#2855d9', '#f37252'] },
  opacity: { op: 'constant', value: 0.7 },
} });
```

Parallel uses an explicit active-row mask, so excluded rows do not appear in
its missing-value lane, density counts, representatives, brush selections, or
GPU hover search. Numeric transformations update axis domains, drawing,
inspection and brush coordinates together. Categorical/boolean source fields
retain their semantic kind, and datetime-ns fields retain lossless source
values; parallel display offsets remain in milliseconds. Brushes, explicit
source selections and axis viewports remain application-controlled through view edits. Brush
membership is recalculated; filtered rows never draw a selection overlay. A transform
can move records outside an existing viewport; reset the viewport when desired.

Parallel retains the GPU device and coordinate buffers. Filter-only changes
without transformations upload visibility and representative data; style-only
changes reuse coordinates. Changed coordinate projections replace derived GPU
values without changing the source dataset. Rapid updates coalesce to the latest
request. `getWebgpuDiagnostics().clientView` reports evaluation metrics,
`revision`, `pending`, `sourceStyleMode`, and source/view upload bytes. Wait for
`pending: false` and the chart's ready render state when inspecting a new frame;
`plot.ready` describes initial startup.

```ts
import {
  createHistogramClientDataView,
  createHistogramWebgpuPlot,
} from 'm-charts/m-histogram-webgpu';

const view = createHistogramClientDataView({ columns, datasetKey: 'measurements' });
const plot = createHistogramWebgpuPlot(host, {
  columns, spec, aggregationBackend: 'auto', clientView: { view },
});
await plot.ready;
view.addFilter({ id: 'valid', predicate: { op: 'isValid', field: 'signal' } });
view.addStyle({ id: 'blue', channels: {
  color: { op: 'constant', value: '#2855d9' },
  opacity: { op: 'constant', value: 0.6 },
} });
```

Histogram passes an active-row mask to binning and membership lookup. Filter-only
edits retain the original columns and sorted indexes in both TypeScript and
Rust/WASM; only the visibility mask is copied into an existing WASM session.
Domains and invalid-value statistics of a cached continuous index describe the
resident source column; bin counts and membership describe visible rows. Computed colors use packed RGBA32 stacks; encoded categorical filters
retain the WASM-compatible unsigned representation. Numeric transformations
recalculate parameter domains rather than excluding values using old domains.
The existing viewport and requested bin sizes remain under host control.
A pipeline edit redraws automatically. Data/filter changes clear histogram hover
and selection so stale bin descriptors cannot refer to a previous distribution;
style-only edits retain them. Source-index membership still identifies original
records, including a supplied `columns.sourceIndex` mapping.

WASM remains an aggregation/selection backend; the shared view evaluator is
TypeScript. Histogram style-only changes reuse sorted coordinate indexes.
Existing WASM eligibility rules and exact TypeScript fallback still apply
(for example, raw string categories or external selection indices outside the
row range). Histogram diagnostics include `clientView` evaluation metrics and
`revision` alongside the existing aggregation diagnostics.

With a binding attached, replace a dataset by disposing and recreating both
view and chart. Parallel rejects replacement `buffers`; histogram rejects
replacement `columns` and aggregation overrides. Histogram `spec` updates may
relabel/reorder subplots and configure resident raw parameters in histogram mode. Passing the original
source object again is harmless. Without a binding, existing data replacement,
streaming, bar mode, and WebGL2 behavior remain supported. Pre-aggregated
histogram bars have no raw-row pipeline and reject `clientView`; streaming
factories do not accept this creation-bound option.

The resident `/m-parallel-webgpu` and `/m-histogram-webgpu` demos include range,
category, boolean, text and exact-selection filters; source/transformed filter
stages; configurable linear/difference and generic calculation transformations; color/opacity styles; source-style base toggles; enable/remove/
reorder controls; reset; and JSON state export/import with dataset validation.
Synthetic `group` and `isReferenceMember` fields demonstrate application metadata.
Default numeric filter bounds cover the middle half of the chosen source field.
Parallel waits for its decoder's CPU columns to finish before attaching the view.
The demos evaluate edits in a module worker and bind persisted state to a content
fingerprint. Streaming and pre-aggregated bar demos continue using their existing
paths. Streaming is a loading mode: complete CPU decoding before attaching a
resident view; append/new row identities require a fresh view and chart.

The browser regression fixture `tests/browser/clientDataView.html` can be opened
through the demo Vite server’s `/@fs/` route in the in-app browser. It runs actual
WebGPU, WASM/TypeScript histogram, selection, worker, and lifecycle checks, with
side-by-side scatter style controls. `?rows=1000000` increases the parallel test
size. The same fixture is covered by `tests/e2e/clientViewExtensions.spec.ts` in
the opt-in GPU suite. Unit tests also execute the published module in a real
worker thread; typechecking includes the browser fixture.


### Generic predicate contract

The library accepts its own serializable AST, independent of any application or
search service. Host applications own parsing and translation. Unknown predicate
or calculation operators throw before a revision is committed, including unknown
operators inside Boolean groups. No query clause is silently dropped.

- `and: []` is true and `or: []` is false. Multiple enabled filters are ANDed.
- Numeric comparisons require finite numeric operands; strings are not coerced.
- Categorical equality preserves scalar types: `1` differs from `"1"`.
  Category ordering follows canonical type/value strings, not locale collation.
- Boolean values accept `true`/`false` and the equivalent `1`/`0`.
- `datetime-ns` comparisons accept safe integers or decimal epoch strings and
  compare losslessly using bigint. This is not date-string parsing.
- Null, undefined, nonfinite numbers, and invalid values for a declared field
  kind match `isNull`, not `isValid`. Ordinary comparisons, including `ne` and
  `notIn`, exclude those values. `not` negates its entire child result, so
  `not(eq(...))` can include missing values.
- `in: []` matches nothing. `notIn: []` matches valid values only.
- `between` includes both endpoints by default. With `inclusive: false`, both
  endpoints are excluded. Combine `gte` and `lt` for a half-open interval.
- Difference overflow produces a missing numeric value (`NaN` in numeric arrays),
  consistently with invalid arithmetic and missing neighbors.

### Residency and release validation

Scatter and parallel expose cumulative `clientView.totalSourceUploadBytes` and
`clientView.sourceBufferBuildCount`, in addition to per-update `viewUploadBytes`.
These include initial source setup and make unintended rebuilds observable.
Scatter theme changes update style resources/uniforms without replacing source
coordinate buffers or reloading packed-style pages. A reset reuses source data.
Histogram reports CPU/WASM setup traffic under `aggregation.setupBytes`; this
is separate from aggregate rendering uploads. Histogram remains GPU-rendered
with CPU/WASM aggregation, not a GPU query evaluator.

All three WebGPU instances expose `waitForGpuIdle(): Promise<void>` to fence
already-submitted GPU work. First settle the requested client-view revision
(`pending`/`cacheReady` and render state where available), then fence the queue;
this method does not wait for future application mutations.

Run `pnpm test:release` on a machine with a working WebGPU adapter before release.
It requires typecheck, lint, unit tests, the actual-GPU E2E suite, the serial
1M/10M/25M client pipeline performance gate, and a production build. The GPU
suite must not be replaced by the default adapter-skipping E2E run.

For the in-app browser, start `pnpm dev --host 127.0.0.1 --port 5181` and open:

- `/@fs/<absolute-repository-path>/tests/browser/clientDataView.html`
- `/@fs/<absolute-repository-path>/tests/browser/clientViewPerformance.html?rows=1000000`

Repeat the performance page with `rows=10000000` and `rows=25000000`. It constructs
in-memory fixtures and disposes each plot/worker before the next chart. It reports
three samples per operation, p95 (the maximum with three samples), evaluator
time, longest frame gap, newly retained coordinate bytes, GPU uploads, and WASM
setup bytes. Timing covers worker evaluation, projection, GPU submission/fencing,
and presentation frames; it excludes startup/reset. Coordinate allocation counts
are not a measurement of all temporary JS/worker allocations or peak heap usage.

Conservative smoke budgets are 1000/5000/10000 ms for 1M/10M/25M rows. These detect
large regressions, not a product responsiveness guarantee. Set `budgetMs` and
`samples` in the page URL, or `M_CHARTS_CLIENT_PERF_BUDGET_MS` for
`pnpm benchmark:client-view`, to enforce your deployment device's latency SLO.
Run performance gates without other GPU workloads. Structural assertions always
require zero coordinate allocations for filter/style edits, no source rebuilds,
and mask-only histogram/parallel density filtering.

Scatter, histogram, and parallel demos now expose pipeline import/export,
enable/disable, up/down ordering, removal, reset, and additive style presets.
Scatter also demonstrates case-insensitive category text matching.
Scatter presets derive numeric style ranges from visible semantic field values,
so packed coordinate scales do not flatten size, rotation, or color gradients.

## Demo pipeline controls

The resident WebGPU scatter, histogram, and parallel demos share the pipeline
panel, row/rule summary, rule controls, diagnostics, and state download/import.
Range/category/boolean/text presets and affine/difference transforms update their
existing rule; calculations and style presets append rules. Histogram and
parallel keep separate numeric-field controls, including source/result range
bounds and difference ordering. Scatter retains its glyph channels and selection
menu; histogram and parallel expose color and opacity.

Keep-inside/outside actions (Alt+I / Alt+O outside editable controls) freeze source
row identities and clear the selection after applying. Reset all clears pipeline
rules and selection, restores dataset styling, and resets the chart viewport.
Transform edits and successful imports fit the chart's projected values; histogram
fits the complete resident domain before calculating the visible bins.

Run the UI regression checks with:

```sh
M_CHARTS_ENABLE_WEBGPU_E2E=1 pnpm test:e2e tests/e2e/clientPipelineControls.spec.ts --workers=1
```

Set `M_CHARTS_E2E_PORT` to use a different test-server port when 5176 is occupied.
