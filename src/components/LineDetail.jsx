const viaText = { exact: 'exact view', equivalent: 'equivalent view', enclosing: 'enclosing block', all: 'all views' };

export default function LineDetail({ line, result, bundle, onClose }) {
  const byId = new Map(result.instances.map(i => [i.id, i]));
  return (
    <div className="detail">
      <div className="detail-head">
        <h2>Line {line.n}</h2>
        <button type="button" onClick={onClose}>Summary</button>
      </div>
      <pre className="detail-line">{line.text}</pre>
      {line.views.length > 0 && (
        <p className="muted">Block view: {line.views.map(v => (v.via === 'exact' ? v.view : `${v.view} (${v.via})`)).join(', ')}</p>
      )}
      {!line.matches.length && <p className="muted">No mapping matches this line.</p>}
      {line.matches.map((m, i) => {
        const cmd = m.featureId ? bundle.commands[m.featureId] : null;
        const inst = byId.get(m.instance);
        return (
          <section key={i} className="match">
            <h3>{m.title} <span className={`badge via-${m.via}`}>{viaText[m.via]}</span></h3>
            {m.via === 'equivalent' && <p className="muted">Mapped on {m.view}; {m.realView ? <>this block is {m.realView}.</> : 'its own view is not in the bundle.'}</p>}
            <dl>
              <dt>DTE</dt><dd>{m.dte.entity}{m.dte.field ? `.${m.dte.field}` : ''} <span className="muted">({m.relation})</span></dd>
              {m.value != null && <><dt>Value</dt><dd><code>{m.value}</code></dd></>}
              {inst && <><dt>Instance</dt><dd>{inst.dte.entity} {inst.name}</dd></>}
              {inst && <><dt>Topology</dt><dd>{inst.topology.join(', ') || '—'}
                {inst.topology.length < inst.topologyCandidates.length && <span className="muted"> (of {inst.topologyCandidates.join(', ')})</span>}</dd></>}
            </dl>
            {m.prefixOnly && <p className="warn">Matched by leading keywords only: the syntax was not understood.</p>}
            {cmd && (
              <div className="cmd">
                {cmd.syntax.filter(s => !/^undo\b/i.test(s)).map(s => <code key={s} className="syntax">{s}</code>)}
                {cmd.parameters.length > 0 && (
                  <dl className="params">
                    {cmd.parameters.map(p => <div key={p.name}><dt>{p.name}</dt><dd>{p.description}</dd></div>)}
                  </dl>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
