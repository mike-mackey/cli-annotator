// One self-contained HTML report: inline CSS, no scripts, every text escaped.
import { matchNote } from './text.js';

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ENTITIES[c]);
const e = escapeHtml;

const CSS = `
:root { --bg: #fff; --fg: #1d2330; --muted: #6b7280; --line: #e5e7eb; --exact: #2f7d4f; --equiv: #b7791f; --enc: #4a6fa5; --note: #f3f4f6; }
@media (prefers-color-scheme: dark) { :root { --bg: #14171f; --fg: #e5e7eb; --muted: #9ca3af; --line: #2a2f3a; --exact: #4fbf7f; --equiv: #e0a84a; --enc: #7f9fd0; --note: #1f2430; } }
body { margin: 0 auto; max-width: 1200px; padding: 16px; background: var(--bg); color: var(--fg); font: 14px/1.45 system-ui, sans-serif; }
h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 24px 0 8px; }
.muted { color: var(--muted); } .warn { color: var(--equiv); }
table { border-collapse: collapse; width: 100%; } td, th { border-bottom: 1px solid var(--line); padding: 4px 6px; text-align: left; vertical-align: top; }
.dump { font: 12px/1.5 ui-monospace, monospace; overflow-x: auto; }
.ln { display: flex; gap: 8px; border-left: 3px solid transparent; padding-left: 4px; white-space: pre; }
.ln .n { color: var(--muted); min-width: 3em; text-align: right; text-decoration: none; }
.ln.via-exact { border-left-color: var(--exact); } .ln.via-equivalent { border-left: 3px dashed var(--equiv); }
.ln.via-enclosing, .ln.via-all { border-left: 3px dotted var(--enc); }
.note { background: var(--note); color: var(--muted); border-radius: 4px; padding: 0 6px; font-family: system-ui, sans-serif; }
`;

const fieldText = fields => Object.entries(fields).map(([f, v]) => `${f}=${v.join(', ')}`).join('; ');

function gapList(title, items, label) {
  if (!items?.length) return '';
  return `<h3>${e(title)} (${items.length})</h3><ul>${items.map(x => `<li>${e(label(x))}</li>`).join('')}</ul>`;
}

export function toHtmlReport(result, { dumpFile = null } = {}) {
  const byId = new Map(result.instances.map(i => [i.id, i]));
  const { device, bundle, coverage: c, gaps = {} } = result;
  const name = device.sysname ?? dumpFile ?? 'device';
  const instances = result.instances.map(i => `<tr><td><a href="#L${i.opener}">${i.opener}</a></td><td>${e(i.dte.entity)}</td>`
    + `<td>${e(i.name)}</td><td>${e(fieldText(i.dte.fields))}</td><td>${e(i.topology.join(', '))}</td>`
    + `<td>${e(i.view)}${i.via === 'exact' ? '' : ` <span class="muted">(${e(i.via)})</span>`}</td></tr>`).join('\n');
  const dump = result.lines.map(l => {
    const via = l.matches[0]?.via;
    const notes = l.matches.map(m => `<span class="note">${e(matchNote(m, byId))}</span>`).join('');
    return `<div class="ln${via ? ` via-${via}` : ''}" id="L${l.n}"><a class="n" href="#L${l.n}">${l.n}</a><code>${e(l.text)}</code>${notes}</div>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(name)} — CLI annotation</title><style>${CSS}</style></head><body>
<h1>${e(name)} — CLI annotation</h1>
<p class="muted">${dumpFile ? `${e(dumpFile)} · ` : ''}dump ${e(device.softwareVersion ?? 'version unknown')} · bundle ${e(bundle.device?.name)} ${e(bundle.device?.softwareVersion)}, ${e(bundle.generatedAt)} · secrets ${result.options.redact ? 'redacted' : '<strong>not redacted</strong>'} · interface equivalence ${result.options.equivalence ? 'on' : 'off'}</p>
${result.warnings.length ? `<ul class="warn">${result.warnings.map(w => `<li>${e(w)}</li>`).join('')}</ul>` : ''}
<h2>Coverage</h2>
<p>${c.mappings.found} of ${c.mappings.total} mappings found · ${c.lines.matched} of ${c.lines.config} config lines matched · ${c.blocks.unresolved.length} of ${c.blocks.total} blocks with an unknown view${c.blocks.unresolved.length ? `: ${c.blocks.unresolved.map(b => `<a href="#L${b.opener}">${e(b.text)}</a>`).join(', ')}` : ''}</p>
<h2>Instances (${result.instances.length})</h2>
<table><thead><tr><th>Line</th><th>DTE entity</th><th>Name</th><th>Fields</th><th>Topology</th><th>View</th></tr></thead><tbody>
${instances}
</tbody></table>
<h2>Configuration</h2>
<div class="dump">
${dump}
</div>
<h2>Gaps in the bundle</h2>
${gapList('DTE entities with no CLI mapping', gaps.dteWithoutCli, g => `${g.logicalName} (topology: ${(g.topology ?? []).join(', ')})`)}
${gapList('Topology entities with no DTE mapping', gaps.topologyWithoutDte, g => `${g.entity} (${g.schema})`)}
${gapList('Schema names a DTE entity not in the dataset', gaps.dteNotFound, g => `${g.topologyEntity ?? g.entity} → ${g.dteEntity ?? g.dte}`)}
</body></html>
`;
}
