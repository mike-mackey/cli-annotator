import { useEffect } from 'react';

const chip = m => `${m.dte.entity}${m.dte.field ? `.${m.dte.field}` : ''}`;

function visible(line, filter, needle) {
  if (filter === 'matched' && !line.matches.length) return false;
  if (filter === 'unmatched' && (line.kind !== 'config' || line.matches.length)) return false;
  return !needle || line.text.toLowerCase().includes(needle);
}

export default function DumpView({ result, filter, search, selected, onSelect }) {
  useEffect(() => {
    if (selected) document.getElementById(`L${selected}`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  const needle = search.trim().toLowerCase();
  const lines = result.lines.filter(l => visible(l, filter, needle));
  return (
    <div className="dump" role="list">
      {lines.map(l => {
        const via = l.matches[0]?.via;
        return (
          <div key={l.n} id={`L${l.n}`} role="listitem"
            className={`ln ln-${l.kind}${via ? ` via-${via}` : ''}${l.n === selected ? ' sel' : ''}`}
            onClick={() => onSelect(l.n === selected ? null : l.n)}>
            <span className="n">{l.n}</span>
            <code>{l.text}</code>
            {l.matches.map((m, i) => <span key={i} className={`chip via-${m.via}`} title={`${m.title} (${m.via})`}>{chip(m)}</span>)}
          </div>
        );
      })}
      {!lines.length && <p className="muted pad">No lines match the filter.</p>}
    </div>
  );
}
