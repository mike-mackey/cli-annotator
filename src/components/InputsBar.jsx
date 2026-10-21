import { useState } from 'react';

function DropZone({ input, label, hint, accept, multiple, onFiles }) {
  const [over, setOver] = useState(false);
  return (
    <label
      className={`drop${over ? ' over' : ''}`}
      onDragOver={e => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files); }}
    >
      <input type="file" hidden data-input={input} accept={accept} multiple={multiple}
        onChange={e => { onFiles(e.target.files); e.target.value = ''; }} />
      <span className="drop-label">{label}</span>
      <span className="drop-hint">{hint}</span>
    </label>
  );
}

export default function InputsBar({
  bundle, remembered, onBundleFiles, onDumpFiles, onPaste,
  dumps, active, onSelectDump, onCloseDump, equivalence, onEquivalence, redact, onRedact,
}) {
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState('');
  const bundleHint = bundle
    ? `${bundle.name} · ${bundle.loaded.device?.name ?? ''} ${bundle.loaded.device?.softwareVersion ?? ''}`
    : remembered ? `Last used: ${remembered.name}. Drop it again.` : 'Exported from ontology-ui (CLI page)';
  return (
    <header className="inputs">
      <div className="inputs-row">
        <DropZone input="bundle" label={bundle ? 'Bundle ✓' : 'Bundle'} hint={bundleHint} accept=".json,application/json" onFiles={onBundleFiles} />
        <DropZone input="dumps" label="Dumps" hint="display current-configuration files" accept=".txt,.cfg,.log,text/plain" multiple onFiles={onDumpFiles} />
        <button type="button" onClick={() => setPasting(p => !p)}>{pasting ? 'Cancel paste' : 'Paste'}</button>
        <label className="toggle"><input type="checkbox" checked={equivalence} onChange={e => onEquivalence(e.target.checked)} /> Interface equivalence</label>
        <label className="toggle"><input type="checkbox" checked={redact} onChange={e => onRedact(e.target.checked)} /> Redact secrets</label>
        <span className="local-note">Files stay in this browser.</span>
      </div>
      {pasting && (
        <div className="paste">
          <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Paste a configuration dump" rows={6} />
          <button type="button" disabled={!text.trim()} onClick={() => { onPaste(text); setText(''); setPasting(false); }}>Add dump</button>
        </div>
      )}
      {dumps.length > 0 && (
        <nav className="tabs">
          {dumps.map((d, i) => (
            <span key={`${i}-${d.name}`} className={`tab${i === active ? ' active' : ''}`}>
              <button type="button" onClick={() => onSelectDump(i)}>{d.name}</button>
              <button type="button" className="close" aria-label={`Close ${d.name}`} onClick={() => onCloseDump(i)}>×</button>
            </span>
          ))}
        </nav>
      )}
    </header>
  );
}
