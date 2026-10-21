import { useMemo, useState } from 'react';
import { loadBundle } from './lib/bundle.js';
import { annotate } from './lib/annotate.js';
import { readFiles } from './files.js';
import { lastBundle, rememberBundle } from './lastBundle.js';
import InputsBar from './components/InputsBar.jsx';
import DumpView from './components/DumpView.jsx';
import LineDetail from './components/LineDetail.jsx';
import SummaryPanel from './components/SummaryPanel.jsx';
import ExportBar from './components/ExportBar.jsx';

const FILTERS = [['all', 'All'], ['matched', 'Matched'], ['unmatched', 'Unmatched']];

export default function App() {
  const [bundle, setBundle] = useState(null);            // {name, loaded}
  const [bundleError, setBundleError] = useState(null);
  const [dumpError, setDumpError] = useState(null);       // a dump file that could not be read
  const [remembered] = useState(lastBundle);
  const [tabs, setTabs] = useState({ list: [], active: 0 });  // dumps live in memory only
  const [equivalence, setEquivalence] = useState(true);
  const [redact, setRedact] = useState(true);
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const dump = tabs.list[tabs.active] ?? null;
  const { result, error } = useMemo(() => {
    if (!bundle || !dump) return { result: null, error: null };
    try {
      return { result: annotate(dump.text, bundle.loaded, { equivalence, redact }), error: null };
    } catch (e) {
      return { result: null, error: e.message };
    }
  }, [bundle, dump, equivalence, redact]);
  const line = result && selected ? result.lines[selected - 1] : null;

  async function onBundleFiles(files) {
    let f;
    try {
      [f] = await readFiles(files);
    } catch (e) {
      setBundleError(`The bundle file could not be read: ${e.message}`);
      return;
    }
    if (!f) return;
    try {
      const loaded = loadBundle(f.text);
      setBundle({ name: f.name, loaded });
      setBundleError(null);
      rememberBundle(f.name, loaded.generatedAt);
    } catch (e) {
      setBundleError(`${f.name}: ${e.message}`);
    }
  }
  async function onDumpFiles(files) {
    try {
      addDumps(await readFiles(files));
      setDumpError(null);
    } catch (e) {
      setDumpError(`A dump file could not be read: ${e.message}`);
    }
  }
  function addDumps(added) {
    if (!added.length) return;
    setTabs(t => ({ list: [...t.list, ...added], active: t.list.length }));
    setSelected(null);
  }
  function closeDump(i) {
    setTabs(t => {
      const list = t.list.filter((_, j) => j !== i);
      const active = t.active > i ? t.active - 1 : t.active;
      return { list, active: Math.min(active, Math.max(list.length - 1, 0)) };
    });
    setSelected(null);
  }

  return (
    <div className="app">
      <InputsBar
        bundle={bundle} remembered={remembered}
        onBundleFiles={onBundleFiles}
        onDumpFiles={onDumpFiles}
        onPaste={text => addDumps([{ name: `pasted-${tabs.list.length + 1}.txt`, text }])}
        dumps={tabs.list} active={tabs.active}
        onSelectDump={i => { setTabs(t => ({ ...t, active: i })); setSelected(null); }}
        onCloseDump={closeDump}
        equivalence={equivalence} onEquivalence={setEquivalence}
        redact={redact} onRedact={setRedact}
      />
      {bundleError && <p className="error">{bundleError}</p>}
      {dumpError && <p className="error">{dumpError}</p>}
      {error && <p className="error">{error}</p>}
      {!result ? (
        <div className="empty">
          <p>Drop an annotation bundle (exported from ontology-ui's CLI page) and one or more <code>display current-configuration</code> dumps.</p>
          <p className="muted">Everything runs in this browser. Nothing is uploaded and no dump is stored.</p>
        </div>
      ) : (
        <div className="main">
          <section className="center">
            <div className="toolbar">
              <div className="filters">
                {FILTERS.map(([k, label]) => (
                  <button key={k} type="button" className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{label}</button>
                ))}
              </div>
              <input type="search" placeholder="Search lines" value={search} onChange={e => setSearch(e.target.value)} />
              <ExportBar result={result} dumpName={dump.name} />
            </div>
            {result.warnings.length > 0 && <ul className="warnings">{result.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
            <DumpView result={result} filter={filter} search={search} selected={selected} onSelect={setSelected} />
          </section>
          <aside className="side">
            {line
              ? <LineDetail line={line} result={result} bundle={bundle.loaded} onClose={() => setSelected(null)} />
              : <SummaryPanel result={result} onSelectLine={setSelected} />}
          </aside>
        </div>
      )}
    </div>
  );
}
