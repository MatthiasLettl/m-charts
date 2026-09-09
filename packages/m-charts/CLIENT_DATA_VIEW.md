# Client Data Views

Client data views are an additive, serializable pipeline for filtering,
transforming, and styling data that is already resident in the browser. The
WebGPU/WASM scatter, parallel-coordinate, and raw histogram plots all support
the same chart-independent `m-charts/client-data-view` controller.

If `clientView` is omitted, all existing chart contracts remain available. Existing
columns and embedded styles, selection callbacks, commands, streaming,
aggregation, WebGL2 use, and plot updates keep their current contracts.
Streaming append is rejected while a client view is attached.
With a view attached, the source dataset is creation-bound: recreate both the
view and plot to replace `columns`. Other mutable scatter options continue to
use `plot.update(...)`; repeatedly passing the same source-column object is a
no-op for the resident data.

## Mental Model And Execution Order

The immutable source dataset and mutable view state are separate:

1. Source columns are loaded once and retained in CPU/GPU storage.
2. All enabled filters are ANDed to form a visibility mask.
3. Transformations execute, in array order, only over rows that passed the
   filters.
4. Style rules execute, in array order, over filtered and transformed fields.
   Later matching rules override only the channels they assign.
5. WebGPU scatter swaps only its compact mask, X-ordered active-index list,
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
also reuse the scatter adapter's masked interaction columns and GPU coordinates.
GPU work coalesces rapid revisions and retains at most one in-flight projection
plus the latest request. Constant style literals are encoded once, and difference
transforms avoid sorting already-ordered input.

Evaluation remains synchronous: first evaluation and changed stages still scan
resident rows. Batch related edits into one `replaceState(...)` and apply costly
pipelines on an explicit action or after debouncing input. `metrics` reports zero
time for reused stages. No frame-time guarantee applies to arbitrary rules or
row counts; measure representative pipelines on the deployment devices. The declarative AST and
columnar field boundary are suitable for future WASM/WGSL compilers without an
application-state change.

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

Every field has `rowCount` values and a kind of `numeric`, `datetime-ns`,
`categorical`, or `boolean`. Nanosecond source columns may use `bigint`;
serialized datetime predicate values should be decimal strings. Boolean typed
columns may use booleans or compact `Uint8Array` 0/1 values.

Data without style fields is valid. In `preserve` mode the renderer uses source
styles when present and theme defaults otherwise. Client rules are computed
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
`in`, `notIn`, `isNull`, `isValid`, and `pointInPolygon`:

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

Affine and difference transformations may overwrite a plotted field or create
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

## Style Expressions

Rules set `color`, `opacity`, `rotation` (radians), `shape` (scatter shape
code), and `size`. Expressions are `constant`, explicit `categorical` maps,
`hashedColor`, numeric/color `continuous` interpolation, or predicate-driven
`case`. Hashed colors depend solely on the canonical field value, so the same
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
different resident dataset. A host may send the small snapshot through
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
Apply replaces the preset and starts from theme defaults. Switch to Dataset
styles afterward to compose just the enabled channels over supplied styles.
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

Each factory also accepts `fields`, `datasetKey`, `datasetVersion`, `state`, and
`onListenerError`. `createParallelClientDataSet` / `createHistogramClientDataSet`
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

Histogram filters values before binning and membership lookup, without compacting
rows. Computed colors use packed RGBA32 stacks; encoded categorical filters
retain the WASM-compatible unsigned representation. Numeric transformations
recalculate parameter domains rather than excluding values using old domains.
The existing viewport and requested bin sizes remain under host control.
A pipeline edit redraws automatically and clears histogram hover and selection so stale bin descriptors cannot refer
to a previous distribution. Source-index membership still identifies original
records, including a supplied `columns.sourceIndex` mapping.

WASM remains an aggregation/selection backend; the shared view evaluator is
TypeScript. Histogram style-only changes reuse sorted coordinate indexes.
Existing WASM eligibility rules and exact TypeScript fallback still apply
(for example, raw string categories or external selection indices outside the
row range). Histogram diagnostics include `clientView` evaluation metrics and
`revision` alongside the existing aggregation diagnostics.

With a binding attached, replace a dataset by disposing and recreating both
view and chart. Parallel rejects replacement `buffers`; histogram rejects
replacement `columns`, `spec`, and aggregation overrides. Passing the original
source object again is harmless. Without a binding, existing data replacement,
streaming, bar mode, and WebGL2 behavior remain supported. Pre-aggregated
histogram bars have no raw-row pipeline and reject `clientView`; streaming
factories do not accept this creation-bound option.

The resident `/m-parallel-webgpu` and `/m-histogram-webgpu` demos include range,
category, boolean and exact-selection filters; configurable linear/difference
transformations; color/opacity styles; source-style base toggles; enable/remove/
reorder controls; reset; and JSON state export/import with dataset validation.
Synthetic `group` and `isReferenceMember` fields demonstrate application metadata.
Default numeric filter bounds cover the middle half of the chosen source field.
Parallel waits for its decoder's CPU columns to finish before attaching the view.
Streaming and pre-aggregated bar demos continue using their existing paths.
