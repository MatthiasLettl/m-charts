import { useMemo, useState } from 'react';
import type { ClientDataView, ClientDataViewState, ClientStyleRule, ClientDataExpression } from 'm-charts/client-data-view';
import { useClientViewState } from '../state/demoClientView';

export function ClientViewControls({ view, selectedSourceIndices, onApplied }: {
  view: ClientDataView;
  selectedSourceIndices: ArrayLike<number>;
  onApplied?: () => void;
}) {
  const state = useClientViewState(view)!;
  const evaluation = view.evaluate();
  const numericFields = Object.entries(evaluation.fields).filter(([key, field]) => field.kind === 'numeric' && key !== 'sourceRow').map(([key]) => key);
  const [fieldChoice, setFieldChoice] = useState(numericFields[0] ?? '');
  const field = numericFields.includes(fieldChoice) ? fieldChoice : numericFields[0] ?? 'sourceRow';
  const sourceFields = view.dataset.fields;
  const defaultRange = useMemo(() => {
    const values = sourceFields[field]?.values;
    let low = Infinity; let high = -Infinity;
    if (values) for (let i = 0; i < values.length; i += 1) {
      const value = values[i];
      if (typeof value === 'number' && Number.isFinite(value)) { low = Math.min(low, value); high = Math.max(high, value); }
    }
    if (!Number.isFinite(low)) return ['0', '1'] as const;
    return [String(Number((low + (high - low) * 0.25).toPrecision(6))), String(Number((low + (high - low) * 0.75).toPrecision(6)))] as const;
  }, [field, sourceFields]);
  const [ranges, setRanges] = useState<Record<string, [string, string]>>({});
  const [min, max] = ranges[field] ?? defaultRange;
  const setMin = (value: string) => setRanges({ ...ranges, [field]: [value, max!] });
  const setMax = (value: string) => setRanges({ ...ranges, [field]: [min!, value] });
  const [factor, setFactor] = useState('1.25');
  const [offset, setOffset] = useState('-0.15');
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');
  const [missingValue, setMissingValue] = useState<'null' | 'zero'>('null');
  const [partitionBy, setPartitionBy] = useState('');
  const [colorMode, setColorMode] = useState('group');
  const [colorEnabled, setColorEnabled] = useState(true);
  const [opacityEnabled, setOpacityEnabled] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [filterStage, setFilterStage] = useState<'source' | 'transformed'>('source');
  const [calculation, setCalculation] = useState('abs');
  const [otherField, setOtherField] = useState('');
  const [textField, setTextField] = useState('');
  const [textQuery, setTextQuery] = useState('');
  const textFields = Object.entries(filterStage === 'transformed' ? evaluation.fields : sourceFields)
    .filter(([, field]) => field.kind === 'categorical' && Array.from({ length: Math.min(field.values.length, 32) }, (_, row) => field.values[row]).some((value) => typeof value === 'string'))
    .map(([key]) => key);
  const selectedTextField = textFields.includes(textField) ? textField : textFields[0];
  const [importText, setImportText] = useState('');
  const apply = (action: () => void) => {
    setPending(true);
    void view.batchAsync(action).then((applied) => { if (applied) { setError(''); onApplied?.(); } },
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setPending(false));
  };
  const nextId = (prefix: string) => `${prefix}-${state.revision + 1}`;
  const valid = (...values: string[]) => values.every((v) => v.trim() !== '' && Number.isFinite(Number(v)));
  const reset = () => view.replaceState({ ...view.exportState(), filters: [], transformations: [], styles: [], sourceStyleMode: 'preserve' });
  const keepSelection = (inside: boolean) => apply(() => view.addFilter({ id: nextId(inside ? 'selection-inside' : 'selection-outside'), predicate: {
    op: inside ? 'in' : 'notIn', field: 'sourceRow', values: Array.from(selectedSourceIndices),
  } }));
  const items = (kind: 'filters' | 'styles' | 'transformations') => (
    <ul className="scatter-client-view-items">
      {state[kind].map((item, index) => <li key={item.id}>
        <label><input type="checkbox" checked={item.enabled !== false} onChange={(event) => apply(() => {
          const enabled = event.target.checked;
          view.replaceState({ ...view.exportState(), [kind]: state[kind].map((entry) => entry.id === item.id ? { ...entry, enabled } : entry) });
        })} />{item.id}</label>
        <div className="button-row">
          <button type="button" aria-label={`Move ${item.id} up`} disabled={index === 0} onClick={() => apply(() => {
            const ordered = [...state[kind]];
            [ordered[index - 1], ordered[index]] = [ordered[index]!, ordered[index - 1]!];
            view.replaceState({ ...view.exportState(), [kind]: ordered });
          })}>↑</button>
          <button type="button" aria-label={`Move ${item.id} down`} disabled={index === state[kind].length - 1} onClick={() => apply(() => {
            const next = [...view.getState()[kind]]; [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
            view.replaceState({ ...view.exportState(), [kind]: next });
          })}>↓</button>
          <button type="button" aria-label={`Remove ${item.id}`} onClick={() => apply(() => view.replaceState({ ...view.exportState(), [kind]: state[kind].filter((entry) => entry.id !== item.id) }))}>Remove</button>
        </div>
      </li>)}
    </ul>
  );
  return <section className="control-section scatter-client-view-panel chart-client-view-panel" data-testid="client-view-panel">
    <h2>Client data pipeline</h2>
    <p className="compact-note">Optional application state: source filters → transform → result filters → style. Changes use resident data and retain source record identities.</p>
    <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0 }}>
    {pending && <p role="status">Applying pipeline…</p>}
    <div className="button-row"><button type="button" data-testid="client-view-reset" onClick={() => apply(reset)}>Reset pipeline</button></div>
    <label>Numeric field<select aria-label="Client numeric field" value={field} onChange={(event) => setFieldChoice(event.target.value)}>
      {numericFields.map((key) => <option key={key}>{key}</option>)}
    </select></label>
    {error && <p role="alert">{error}</p>}
    <details className="control-disclosure" open><summary>Filters</summary><div className="control-disclosure-body">
      <label>Filter values<select aria-label="Filter stage" value={filterStage} onChange={(e) => setFilterStage(e.target.value as typeof filterStage)}><option value="source">Before transformations</option><option value="transformed">After transformations</option></select></label>
      <div className="scatter-client-inputs">
        <label>Minimum<input type="number" step="any" aria-label="Client filter minimum" value={min} onChange={(e) => setMin(e.target.value)} /></label>
        <label>Maximum<input type="number" step="any" aria-label="Client filter maximum" value={max} onChange={(e) => setMax(e.target.value)} /></label>
      </div>
      <div className="button-row scatter-client-view-actions">
        <button type="button" data-testid="client-filter-range" disabled={!valid(min, max) || Number(min) > Number(max)} onClick={() => apply(() => view.addFilter({ id: nextId('range'), stage: filterStage, predicate: { op: 'between', field, min: Number(min), max: Number(max) } }))}>Keep range</button>
        <button type="button" data-testid="client-filter-category" onClick={() => apply(() => view.addFilter({ id: nextId('group'), predicate: { op: 'in', field: 'group', values: [0, 1] } }))}>Keep groups 0 + 1</button>
        <button type="button" data-testid="client-filter-boolean" onClick={() => apply(() => view.addFilter({ id: nextId('reference'), predicate: { op: 'eq', field: 'isReferenceMember', value: true } }))}>Keep reference members</button>
      </div>
      <div className="button-row scatter-client-view-actions">
        <button type="button" data-testid="client-filter-selection-inside" disabled={selectedSourceIndices.length === 0} onClick={() => keepSelection(true)}>Keep selection</button>
        <button type="button" data-testid="client-filter-selection-outside" disabled={selectedSourceIndices.length === 0} onClick={() => keepSelection(false)}>Exclude selection</button>
      </div>
      {textFields.length > 0 && <div>
        <label>Text field<select value={selectedTextField} onChange={(e) => setTextField(e.target.value)}>{textFields.map((key) => <option key={key}>{key}</option>)}</select></label>
        <label>Contains text<input value={textQuery} onChange={(e) => setTextQuery(e.target.value)} /></label>
        <button type="button" disabled={!textQuery} onClick={() => apply(() => view.addFilter({ id: nextId('text'), stage: filterStage, predicate: { op: 'contains', field: selectedTextField!, value: textQuery, caseSensitive: false } }))}>Keep matching text</button>
      </div>}{items('filters')}
    </div></details>
    <details className="control-disclosure"><summary>Transformations</summary><div className="control-disclosure-body">
      <p className="compact-note">Applied to {field}, in the order listed, after filtering.</p>
      <div className="scatter-client-inputs">
        <label>Factor<input type="number" step="any" aria-label="Client transform factor" value={factor} onChange={(e) => setFactor(e.target.value)} /></label>
        <label>Offset<input type="number" step="any" aria-label="Client transform offset" value={offset} onChange={(e) => setOffset(e.target.value)} /></label>
      </div>
      <button type="button" data-testid="client-transform-affine" disabled={!valid(factor, offset)} onClick={() => apply(() => view.addTransformation({ id: nextId('linear'), op: 'affine', input: field, output: field, factor: Number(factor), offset: Number(offset) }))}>Apply linear transform</button>
      <label>Difference direction<select aria-label="Difference direction" value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}><option value="forward">Forward</option><option value="backward">Backward</option></select></label>
      <label>Missing neighbor<select aria-label="Missing neighbor" value={missingValue} onChange={(e) => setMissingValue(e.target.value as typeof missingValue)}><option value="null">Missing</option><option value="zero">Zero</option></select></label>
      <label>Partition by<select aria-label="Difference partition" value={partitionBy} onChange={(e) => setPartitionBy(e.target.value)}><option value="">All rows</option><option value="group">Group</option><option value="isReferenceMember">Reference membership</option></select></label>
      <button type="button" data-testid="client-transform-delta" onClick={() => apply(() => view.addTransformation({ id: nextId('difference'), op: 'difference', input: field, output: field, direction, missingValue, ...(partitionBy ? { partitionBy: [partitionBy] } : {}) }))}>Apply difference</button>
      <label>Calculation<select aria-label="Client calculation" value={calculation} onChange={(e) => setCalculation(e.target.value)}>
        {['abs', 'log', 'log10', 'sqrt', 'round', 'add', 'subtract', 'multiply', 'divide'].map((op) => <option key={op}>{op}</option>)}
      </select></label>
      <label>Other numeric field<select aria-label="Other numeric field" value={otherField || field} onChange={(e) => setOtherField(e.target.value)}>{numericFields.map((key) => <option key={key}>{key}</option>)}</select></label>
      <button type="button" onClick={() => apply(() => {
        const input: ClientDataExpression = { op: 'field', field };
        const expression: ClientDataExpression = ['add', 'subtract', 'multiply', 'divide'].includes(calculation)
          ? { op: calculation as 'add' | 'subtract' | 'multiply' | 'divide', left: input, right: { op: 'field', field: otherField || field } }
          : { op: calculation as 'abs' | 'log' | 'log10' | 'sqrt' | 'round', input };
        view.addTransformation({ id: nextId('calculate'), op: 'calculate', output: field, expression });
      })}>Apply calculation</button>
      {items('transformations')}
    </div></details>
    <details className="control-disclosure"><summary>Styles</summary><div className="control-disclosure-body">
      <div className="segmented-control" aria-label="Client style source">
        {(['preserve', 'ignore'] as const).map((mode) => <button type="button" key={mode} data-testid={mode === 'preserve' ? 'client-style-dataset-base' : 'client-style-data-only'} aria-pressed={state.sourceStyleMode === mode} className={state.sourceStyleMode === mode ? 'is-active' : undefined} onClick={() => apply(() => view.replaceState({ ...view.exportState(), sourceStyleMode: mode }))}>{mode === 'preserve' ? 'Dataset styles' : 'Theme defaults'}</button>)}
      </div>
      <fieldset className="scatter-client-channels"><legend>Compute channels</legend>
        <label><input type="checkbox" checked={colorEnabled} onChange={(e) => setColorEnabled(e.target.checked)} />Color</label>
        <label><input type="checkbox" checked={opacityEnabled} onChange={(e) => setOpacityEnabled(e.target.checked)} />Opacity</label>
      </fieldset>
      <label>Color mapping<select aria-label="Client color mapping" value={colorMode} onChange={(e) => setColorMode(e.target.value)}><option value="group">Hashed group colors</option><option value="continuous">Continuous numeric gradient</option></select></label>
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
      })}>Use client-computed preset</button>{items('styles')}
    </div></details>
    <details className="control-disclosure"><summary>State and diagnostics</summary><div className="control-disclosure-body">
      <dl className="selection-grid">
        <div><dt>Revision</dt><dd data-testid="client-view-revision">{state.revision}</dd></div>
        <div><dt>Resident rows</dt><dd>{evaluation.metrics.rowCount.toLocaleString('en-US')}</dd></div>
        <div><dt>Visible rows</dt><dd data-testid="client-view-visible-count">{evaluation.metrics.activeRowCount.toLocaleString('en-US')}</dd></div>
        <div><dt>Evaluation</dt><dd>{evaluation.metrics.durationMs.toFixed(1)} ms · {evaluation.metrics.backend}</dd></div>
        <div><dt>Network refetch</dt><dd>none</dd></div>
      </dl>
      <button type="button" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(view.exportState(), null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'chart-client-view.json'; link.click(); URL.revokeObjectURL(url); }}>Export state</button>
      <label>Import state JSON<textarea aria-label="Import client state JSON" value={importText} onChange={(e) => setImportText(e.target.value)} /></label>
      <button type="button" disabled={!importText.trim()} onClick={() => apply(() => view.replaceState(JSON.parse(importText) as ClientDataViewState))}>Import state</button>
      <pre className="compact-code-block" data-testid="client-view-state-json"><code>{JSON.stringify(state, (_key, value: unknown) => Array.isArray(value) && value.length > 200 ? [...value.slice(0, 200), '…'] : value, 2)}</code></pre>
    </div></details>
    </fieldset>
  </section>;
}
