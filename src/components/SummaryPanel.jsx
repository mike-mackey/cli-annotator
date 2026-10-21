function Gap({ title, items, label }) {
  if (!items?.length) return null;
  return (
    <details>
      <summary>{title} ({items.length})</summary>
      <ul>{items.map((g, i) => <li key={i}>{label(g)}</li>)}</ul>
    </details>
  );
}

export default function SummaryPanel({ result, onSelectLine }) {
  const { device, coverage: c, gaps = {} } = result;
  return (
    <div className="summary">
      <h2>{device.sysname ?? 'Device'}</h2>
      <p className="muted">Software {device.softwareVersion ?? 'unknown'}</p>
      <div className="stats">
        <div><strong>{c.mappings.found}/{c.mappings.total}</strong><span>mappings found</span></div>
        <div><strong>{c.lines.matched}/{c.lines.config}</strong><span>config lines matched</span></div>
        <div><strong>{result.instances.length}</strong><span>instances</span></div>
      </div>
      {c.blocks.unresolved.length > 0 && (
        <details>
          <summary>Blocks with an unknown view ({c.blocks.unresolved.length} of {c.blocks.total})</summary>
          <ul>{c.blocks.unresolved.map(b => <li key={b.id}><button type="button" className="link" onClick={() => onSelectLine(b.opener)}>{b.opener}: {b.text}</button></li>)}</ul>
        </details>
      )}
      <h3>Instances</h3>
      <ul className="instances">
        {result.instances.map(i => (
          <li key={i.id}>
            <button type="button" className="link" onClick={() => onSelectLine(i.opener)}>
              <strong>{i.dte.entity}</strong> {i.name}
            </button>
            <span className="muted"> {i.topology.join(', ')}{i.via === 'exact' ? '' : ` · ${i.via}`}</span>
          </li>
        ))}
      </ul>
      <h3>Gaps in the bundle</h3>
      <Gap title="DTE entities with no CLI mapping" items={gaps.dteWithoutCli} label={g => `${g.logicalName} (${(g.topology ?? []).join(', ')})`} />
      <Gap title="Topology entities with no DTE mapping" items={gaps.topologyWithoutDte} label={g => `${g.entity} (${g.schema})`} />
      <Gap title="Schema names a missing DTE entity" items={gaps.dteNotFound} label={g => `${g.topologyEntity} → ${g.dteEntity}`} />
    </div>
  );
}
