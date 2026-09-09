import { useState, type ReactNode } from 'react';
import type { ClientDataView, ClientDataViewState, ClientDataViewEvaluation } from 'm-charts/client-data-view';

export function ClientPipelinePanel({ state, visibleRows, pending, error, onReset, filters, transformations, styles, diagnostics, fieldControl, testId = 'client-view-panel' }: {
  state: ClientDataViewState;
  visibleRows: number;
  pending: boolean;
  error: string;
  onReset: () => void;
  filters: ReactNode;
  transformations: ReactNode;
  styles: ReactNode;
  diagnostics: ReactNode;
  fieldControl?: ReactNode;
  testId?: string;
}) {
  return <section className="control-section scatter-client-view-panel chart-client-view-panel" data-testid={testId}>
    <fieldset disabled={pending} className="client-pipeline-fieldset" aria-busy={pending}>
      <div className="control-section-heading-row">
        <div><h2>Client data pipeline</h2><p className="compact-note">Filters, transformations, and styles run locally over resident data.</p></div>
        <button type="button" data-testid="client-view-reset" onClick={onReset}>Reset all</button>
      </div>
      <div className="scatter-client-view-summary" aria-label="Client pipeline summary">
        <span>{visibleRows.toLocaleString('en-US')} visible</span>
        <span>{state.filters.length} filters</span><span>{state.transformations.length} transforms</span><span>{state.styles.length} styles</span>
        <span data-testid="client-view-style-source">{state.sourceStyleMode === 'ignore' ? 'Theme base' : 'Dataset base'}</span>
      </div>
      {pending && <p role="status">Applying pipeline…</p>}
      {error && <p role="alert">{error}</p>}
      {fieldControl}
      <details className="control-disclosure" open><summary>Filters</summary><div className="control-disclosure-body">{filters}</div></details>
      <details className="control-disclosure"><summary>Transformations</summary><div className="control-disclosure-body">{transformations}</div></details>
      <details className="control-disclosure"><summary>Styles</summary><div className="control-disclosure-body">{styles}</div></details>
      <details className="control-disclosure"><summary>Pipeline diagnostics and state</summary><div className="control-disclosure-body">{diagnostics}</div></details>
    </fieldset>
  </section>;
}

export function ClientViewItemList({ items, onToggle, onMove, onRemove }: {
  items: readonly { readonly id: string; readonly op?: string; readonly enabled?: boolean }[];
  onToggle: (id: string, enabled: boolean) => void;
  onMove: (id: string, direction: number) => void;
  onRemove: (id: string) => void;
}) {
  if (items.length === 0) return <p className="compact-note">No rules applied.</p>;
  return <ul className="scatter-client-view-items">{items.map((item, index) => <li key={item.id}>
    <label><input type="checkbox" checked={item.enabled !== false} onChange={(event) => onToggle(item.id, event.target.checked)} /><span>{item.id}{item.op === undefined ? '' : ` · ${item.op}`}</span></label>
    <div className="button-row">
      <button type="button" aria-label={`Move ${item.id} up`} disabled={index === 0} onClick={() => onMove(item.id, -1)}>↑</button>
      <button type="button" aria-label={`Move ${item.id} down`} disabled={index === items.length - 1} onClick={() => onMove(item.id, 1)}>↓</button>
      <button type="button" aria-label={`Remove ${item.id}`} onClick={() => onRemove(item.id)}>Remove</button>
    </div>
  </li>)}</ul>;
}

export function ClientPipelineState({ view, state, metrics, filename, onImport, uploads }: {
  view: ClientDataView;
  state: ClientDataViewState;
  metrics: ClientDataViewEvaluation['metrics'];
  filename: string;
  onImport: (json: string) => void;
  uploads?: { sourceUploadBytes: number; viewUploadBytes: number };
}) {
  const [importText, setImportText] = useState('');
  const formatBytes = (bytes: number) => bytes === 0 ? '0 B' : bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return <>
    <dl className="diagnostic-list">
      <div><dt>Revision</dt><dd data-testid="client-view-revision">{state.revision}</dd></div>
      <div><dt>Resident rows</dt><dd>{metrics.rowCount.toLocaleString('en-US')}</dd></div>
      <div><dt>Visible rows</dt><dd data-testid="client-view-visible-count">{metrics.activeRowCount.toLocaleString('en-US')}</dd></div>
      <div><dt>Evaluation</dt><dd>{metrics.durationMs.toFixed(1)} ms</dd></div>
      <div><dt>Evaluator backend</dt><dd>{metrics.backend}</dd></div>
      {uploads && <>
        <div><dt>Source re-upload</dt><dd data-testid="client-view-source-upload">{formatBytes(uploads.sourceUploadBytes)}</dd></div>
        <div><dt>View upload</dt><dd data-testid="client-view-view-upload">{formatBytes(uploads.viewUploadBytes)}</dd></div>
      </>}
      <div><dt>Network refetch</dt><dd data-testid="client-view-network-refetch">none</dd></div>
    </dl>
    <p className="compact-note">State preview limits long arrays to 200 entries. Download includes the complete state.</p>
    <button type="button" onClick={() => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(view.exportState(), null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }}>Download pipeline state</button>
    <label>Import state JSON<textarea aria-label="Import client state JSON" value={importText} onChange={(event) => setImportText(event.target.value)} /></label>
    <button type="button" disabled={!importText.trim()} onClick={() => onImport(importText)}>Import state</button>
    <pre className="compact-code-block" data-testid="client-view-state-json"><code>{JSON.stringify(state,
      (_key, value: unknown) => Array.isArray(value) && value.length > 200 ? [...value.slice(0, 200), `… ${value.length - 200} more entries`] : value, 2,
    )}</code></pre>
  </>;
}
