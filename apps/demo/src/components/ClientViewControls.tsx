import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClientPipelinePanel, ClientPipelineState, ClientViewItemList } from './ClientPipelinePanel';
import type { ClientDataView, ClientDataViewState, ClientStyleRule, ClientDataExpression } from 'm-charts/client-data-view';
import { useClientViewState } from '../state/demoClientView';

export type ClientPipelineAction = 'filter' | 'selection' | 'transformation' | 'style' | 'reset' | 'import';

export function ClientViewControls({ view, selectedSourceIndices, selectedCount, resolveSelectedSourceIndices, onApplied, chart, uploads }: {
  view: ClientDataView;
  selectedSourceIndices: ArrayLike<number>;
  selectedCount?: number;
  resolveSelectedSourceIndices?: () => ArrayLike<number>;
  onApplied?: (action: ClientPipelineAction) => void;
  chart: 'histogram' | 'parallel';
  uploads?: { sourceUploadBytes: number; viewUploadBytes: number };
}) {
  const state = useClientViewState(view)!;
  const evaluation = view.evaluate();
  const numericFields = Object.entries(evaluation.fields).filter(([key, field]) => field.kind === 'numeric' && key !== 'sourceRow').map(([key]) => key);
  const [fieldChoice, setFieldChoice] = useState(numericFields[0] ?? '');
  const field = numericFields.includes(fieldChoice) ? fieldChoice : numericFields[0] ?? 'sourceRow';
  const sourceFields = view.dataset.fields;
  const [filterStage, setFilterStage] = useState<'source' | 'transformed'>('source');
  const rangeFields = filterStage === 'transformed' ? evaluation.fields : sourceFields;
  const defaultRange = useMemo(() => {
    const values = rangeFields[field]?.values;
    let low = Infinity; let high = -Infinity;
    if (values) for (let i = 0; i < values.length; i += 1) {
      const value = values[i];
      if (typeof value === 'number' && Number.isFinite(value)) { low = Math.min(low, value); high = Math.max(high, value); }
    }
    if (!Number.isFinite(low)) return ['0', '1'] as const;
    return [String(Number((low + (high - low) * 0.25).toPrecision(6))), String(Number((low + (high - low) * 0.75).toPrecision(6)))] as const;
  }, [field, rangeFields]);
  const [ranges, setRanges] = useState<Record<string, [string, string]>>({});
  const rangeKey = `${filterStage}:${field}`;
  const [min, max] = ranges[rangeKey] ?? defaultRange;
  const setMin = (value: string) => setRanges({ ...ranges, [rangeKey]: [value, max!] });
  const setMax = (value: string) => setRanges({ ...ranges, [rangeKey]: [min!, value] });
  const [factor, setFactor] = useState('1.25');
  const [offset, setOffset] = useState('-0.15');
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');
  const [missingValue, setMissingValue] = useState<'null' | 'zero'>('null');
  const [partitionBy, setPartitionBy] = useState('');
  const [orderBy, setOrderBy] = useState('');
  const [colorMode, setColorMode] = useState('group');
  const [colorEnabled, setColorEnabled] = useState(true);
  const [opacityEnabled, setOpacityEnabled] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [calculation, setCalculation] = useState('abs');
  const [otherField, setOtherField] = useState('');
  const [textField, setTextField] = useState('');
  const [textQuery, setTextQuery] = useState('');
  const textFields = Object.entries(filterStage === 'transformed' ? evaluation.fields : sourceFields)
    .filter(([, field]) => field.kind === 'categorical' && Array.from({ length: Math.min(field.values.length, 32) }, (_, row) => field.values[row]).some((value) => typeof value === 'string'))
    .map(([key]) => key);
  const selectedTextField = textFields.includes(textField) ? textField : textFields[0];
  const apply = useCallback(async (action: () => void, kind: ClientPipelineAction = 'filter') => {
    setPending(true);
    try {
      const applied = await view.batchAsync(action);
      if (applied) { setError(''); onApplied?.(kind); }
      return applied;
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return false; }
    finally { setPending(false); }
  }, [view, onApplied]);
  const upsertFilter = (filter: ClientDataViewState['filters'][number]) => {
    if (view.getFilters().some((item) => item.id === filter.id)) view.updateFilter(filter.id, filter);
    else view.addFilter(filter);
  };
  const upsertTransformation = (transformation: ClientDataViewState['transformations'][number]) => {
    if (view.getTransformations().some((item) => item.id === transformation.id)) view.updateTransformation(transformation.id, transformation);
    else view.addTransformation(transformation);
  };
  const nextId = (prefix: string) => `${prefix}-${state.revision + 1}`;
  const valid = (...values: string[]) => values.every((v) => v.trim() !== '' && Number.isFinite(Number(v)));
  const reset = () => view.replaceState({ ...view.exportState(), filters: [], transformations: [], styles: [], sourceStyleMode: 'preserve' });
  const selectionCount = selectedCount ?? selectedSourceIndices.length;
  const keepSelection = useCallback((inside: boolean) => {
    if (pending || selectionCount === 0) return;
    void apply(() => {
      // Histogram membership is deferred until an action needs exact source rows.
      const values = Array.from(resolveSelectedSourceIndices?.() ?? selectedSourceIndices);
      if (values.length === 0) throw new Error('The selection has no available source rows. Select rows again.');
      view.addFilter({ id: `selection-${view.getState().revision + 1}`, predicate: {
        op: inside ? 'in' : 'notIn', field: 'sourceRow', values,
      } });
    }, 'selection');
  }, [apply, pending, resolveSelectedSourceIndices, selectedSourceIndices, selectionCount, view]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.repeat || (event.target instanceof HTMLElement && event.target.closest('input, select, textarea, [contenteditable="true"]'))) return;
      const key = event.key.toLowerCase();
      if (key !== 'i' && key !== 'o') return;
      event.preventDefault(); keepSelection(key === 'i');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [keepSelection]);
  const items = (kind: 'filters' | 'styles' | 'transformations') => {
    const action = kind === 'transformations' ? 'transformation' : kind === 'styles' ? 'style' : 'filter';
    return <ClientViewItemList items={state[kind]}
      onToggle={(id, enabled) => { void apply(() => view.replaceState({ ...view.exportState(), [kind]: view.getState()[kind].map((item) => item.id === id ? { ...item, enabled } : item) }), action); }}
      onMove={(id, direction) => { void apply(() => {
        const ordered = [...view.getState()[kind]]; const index = ordered.findIndex((item) => item.id === id); const other = index + direction;
        if (index < 0 || other < 0 || other >= ordered.length) return;
        [ordered[index], ordered[other]] = [ordered[other]!, ordered[index]!];
        view.replaceState({ ...view.exportState(), [kind]: ordered });
      }, action); }}
      onRemove={(id) => { void apply(() => view.replaceState({ ...view.exportState(), [kind]: view.getState()[kind].filter((item) => item.id !== id) }), action); }} />;
  };
  return <ClientPipelinePanel state={state} visibleRows={evaluation.metrics.activeRowCount}
    pending={pending} error={error} onReset={() => { void apply(reset, 'reset'); }}
    fieldControl={<label>Numeric field<select aria-label="Client numeric field" value={field} onChange={(event) => setFieldChoice(event.target.value)}>
      {numericFields.map((key) => <option key={key}>{key}</option>)}
    </select></label>}
    filters={<>
      <p className="compact-note">{chart === 'histogram' ? 'Select bins' : 'Brush an axis or select lines'} to keep inside or outside rows. Filters combine; remove a rule to restore rows. Source filters → transformations → result filters → styles.</p>
      <label>Filter values<select aria-label="Filter stage" value={filterStage} onChange={(e) => setFilterStage(e.target.value as typeof filterStage)}><option value="source">Before transformations</option><option value="transformed">After transformations</option></select></label>
      <div className="scatter-client-inputs">
        <label>Minimum<input type="number" step="any" aria-label="Client filter minimum" value={min} onChange={(e) => setMin(e.target.value)} /></label>
        <label>Maximum<input type="number" step="any" aria-label="Client filter maximum" value={max} onChange={(e) => setMax(e.target.value)} /></label>
      </div>
      <div className="button-row scatter-client-view-actions">
        <button type="button" data-testid="client-filter-range" disabled={!valid(min, max) || Number(min) > Number(max)} onClick={() => apply(() => upsertFilter({ id: `range-${field}-${filterStage}`, stage: filterStage, predicate: { op: 'between', field, min: Number(min), max: Number(max) } }))}>Keep range</button>
        <button type="button" data-testid="client-filter-category" onClick={() => apply(() => upsertFilter({ id: 'group', predicate: { op: 'in', field: 'group', values: [0, 1] } }))}>Keep groups 0 + 1</button>
        <button type="button" data-testid="client-filter-boolean" onClick={() => apply(() => upsertFilter({ id: 'reference', predicate: { op: 'eq', field: 'isReferenceMember', value: true } }))}>Keep reference members</button>
      </div>
      <div className="button-row scatter-client-view-actions">
        <button type="button" data-testid="client-filter-selection-inside" disabled={selectionCount === 0} onClick={() => keepSelection(true)} title="Alt+I">Keep inside · remove outside</button>
        <button type="button" data-testid="client-filter-selection-outside" disabled={selectionCount === 0} onClick={() => keepSelection(false)} title="Alt+O">Keep outside · remove inside</button>
      </div>
      {textFields.length > 0 && <div>
        <label>Text field<select value={selectedTextField} onChange={(e) => setTextField(e.target.value)}>{textFields.map((key) => <option key={key}>{key}</option>)}</select></label>
        <label>Contains text<input value={textQuery} onChange={(e) => setTextQuery(e.target.value)} /></label>
        <button type="button" disabled={!textQuery} onClick={() => apply(() => upsertFilter({ id: `text-${selectedTextField}-${filterStage}`, stage: filterStage, predicate: { op: 'contains', field: selectedTextField!, value: textQuery, caseSensitive: false } }))}>Keep matching text</button>
      </div>}{items('filters')}
    </>}
    transformations={<>
      <p className="compact-note">Numeric field: {field}. Applied in the order listed, between source and result filters. Updating a transform keeps its position.</p>
      <div className="scatter-client-inputs">
        <label>Scale factor<input type="number" step="any" aria-label="Client transform factor" value={factor} onChange={(e) => setFactor(e.target.value)} /></label>
        <label>Offset<input type="number" step="any" aria-label="Client transform offset" value={offset} onChange={(e) => setOffset(e.target.value)} /></label>
      </div>
      <p className="compact-note">value′ = value × {factor || '?'} + ({offset || '?'})</p>
      {!valid(factor, offset) && <p role="alert" className="compact-note">Enter finite numbers for factor and offset.</p>}
      <button type="button" data-testid="client-transform-affine" disabled={!valid(factor, offset)} onClick={() => apply(() => upsertTransformation({ id: `linear-${field}`, op: 'affine', input: field, output: field, factor: Number(factor), offset: Number(offset) }), 'transformation')}>Apply linear transform</button>
      <label>Difference direction<select aria-label="Difference direction" value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}><option value="forward">Forward: next − current</option><option value="backward">Backward: current − previous</option></select></label>
      <label>Missing neighbor<select aria-label="Missing neighbor" value={missingValue} onChange={(e) => setMissingValue(e.target.value as typeof missingValue)}><option value="null">Missing (null)</option><option value="zero">Use zero</option></select></label>
      <label>Partition by<select aria-label="Difference partition" value={partitionBy} onChange={(e) => setPartitionBy(e.target.value)}><option value="">All rows</option><option value="group">Group</option><option value="isReferenceMember">Reference membership</option></select></label>
      <label>Difference order<select aria-label="Difference order" value={orderBy} onChange={(event) => setOrderBy(event.target.value)}><option value="">Source row order</option>{numericFields.map((key) => <option key={key}>{key}</option>)}</select></label>
      <p className="compact-note">Differences use rows remaining after source filters, ordered by {orderBy || 'source row'}. To scale a difference, apply it before the linear transform.</p>
      <button type="button" data-testid="client-transform-delta" onClick={() => apply(() => upsertTransformation({ id: `difference-${field}`, op: 'difference', input: field, output: field, direction, missingValue, ...(partitionBy ? { partitionBy: [partitionBy] } : {}), ...(orderBy ? { orderBy } : {}) }), 'transformation')}>Apply difference</button>
      <label>Calculation<select aria-label="Client calculation" value={calculation} onChange={(e) => setCalculation(e.target.value)}>
        {['abs', 'log', 'log10', 'sqrt', 'round', 'add', 'subtract', 'multiply', 'divide'].map((op) => <option key={op}>{op}</option>)}
      </select></label>
      {['add', 'subtract', 'multiply', 'divide'].includes(calculation) && <label>Other numeric field<select aria-label="Other numeric field" value={otherField || field} onChange={(e) => setOtherField(e.target.value)}>{numericFields.map((key) => <option key={key}>{key}</option>)}</select></label>}
      <button type="button" onClick={() => apply(() => {
        const input: ClientDataExpression = { op: 'field', field };
        const expression: ClientDataExpression = ['add', 'subtract', 'multiply', 'divide'].includes(calculation)
          ? { op: calculation as 'add' | 'subtract' | 'multiply' | 'divide', left: input, right: { op: 'field', field: otherField || field } }
          : { op: calculation as 'abs' | 'log' | 'log10' | 'sqrt' | 'round', input };
        view.addTransformation({ id: nextId('calculate'), op: 'calculate', output: field, expression });
      }, 'transformation')}>Apply calculation</button>
      {items('transformations')}
    </>}
    styles={<>
      <p className="compact-note">Base styling</p>
      <div className="segmented-control" aria-label="Client pipeline base styling">
        {(['preserve', 'ignore'] as const).map((mode) => <button type="button" key={mode} data-testid={mode === 'preserve' ? 'client-style-dataset-base' : 'client-style-data-only'} aria-pressed={(state.sourceStyleMode ?? 'preserve') === mode} className={(state.sourceStyleMode ?? 'preserve') === mode ? 'is-active' : undefined} onClick={() => apply(() => view.replaceState({ ...view.exportState(), sourceStyleMode: mode }), 'style')}>{mode === 'preserve' ? 'Dataset styles' : 'Theme defaults'}</button>)}
      </div>
      <fieldset className="scatter-client-channels"><legend>Compute channels</legend>
        <label><input type="checkbox" checked={colorEnabled} onChange={(e) => setColorEnabled(e.target.checked)} />Color</label>
        <label><input type="checkbox" checked={opacityEnabled} onChange={(e) => setOpacityEnabled(e.target.checked)} />Opacity</label>
      </fieldset>
      <label>Color mapping<select aria-label="Client color mapping" value={colorMode} onChange={(e) => setColorMode(e.target.value)}><option value="group">Hashed group colors</option><option value="continuous">Continuous numeric gradient</option></select></label>
      <p className="compact-note">{chart === 'histogram' ? 'Color and opacity style source rows before they are grouped into bin stacks.' : 'Color and opacity style the lines for each source row.'} Apply adds a rule over the selected base. Later matching rules override only the checked channels.</p>
      <button type="button" data-testid="client-style-preset" disabled={!colorEnabled && !opacityEnabled} onClick={() => apply(() => {
        let low = Infinity; let high = -Infinity;
        const values = evaluation.fields[field]!.values;
        for (const row of evaluation.activeSourceIndices) { const v = Number(values[row]); if (Number.isFinite(v)) { low = Math.min(low, v); high = Math.max(high, v); } }
        if (!Number.isFinite(low)) { low = 0; high = 1; }
        const channels: ClientStyleRule['channels'] = {
          ...(colorEnabled ? { color: colorMode === 'group' ? { op: 'hashedColor' as const, field: 'group' } : { op: 'continuous' as const, field, domain: [low, high > low ? high : low + 1] as const, range: ['#2855d9', '#f37252'] as const } } : {}),
          ...(opacityEnabled ? { opacity: { op: 'case' as const, branches: [{ when: { op: 'eq' as const, field: 'isReferenceMember', value: true }, value: { op: 'constant' as const, value: 1 } }], fallback: { op: 'constant' as const, value: 0.35 } } } : {}),
        };
        view.addStyle({ id: nextId('style'), channels });
      }, 'style')}>Use client-computed preset</button>{items('styles')}
    </>}
    diagnostics={<ClientPipelineState view={view} state={state} metrics={evaluation.metrics}
      filename={`${chart}-client-view.json`} uploads={uploads}
      onImport={(json) => { void apply(() => view.replaceState(JSON.parse(json) as ClientDataViewState), 'import'); }} />}
  />;
}
