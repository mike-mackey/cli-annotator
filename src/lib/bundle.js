// Loads an ontology-ui annotation bundle (docs/topo-cli-bundle.md in ontology-ui)
// and builds the lookups the annotator needs. Only an unreadable bundle throws.
export const BUNDLE_FORMAT = 'ontology-ui.topo-cli-annotation-bundle';

// v1 bundles carry paths for the mapped views only; derive the same shape as v2's viewIndex.
function viewIndexFromPaths(views) {
  const index = {};
  for (const [view, entry] of Object.entries(views ?? {})) {
    const path = entry?.path ?? [];
    const last = path[path.length - 1];
    const prev = path[path.length - 2];
    index[view] = {
      entryCommand: last?.entryCommand ?? null,
      params:       last?.params ?? [],
      parentView:   prev && prev.view !== 'user view' ? prev.view : null,
    };
  }
  return index;
}

function addEnteredBy(index, commands) {
  for (const [fid, c] of Object.entries(commands)) {
    for (const v of c.enableViews ?? []) {
      index[v] ??= { entryCommand: null, params: [], parentView: c.parentViews?.[0] ?? null };
      const entered = (index[v].enteredBy ??= []);
      if (!entered.includes(fid)) entered.push(fid);
    }
  }
}

export function loadBundle(input) {
  let b = input;
  if (typeof input === 'string') {
    try { b = JSON.parse(input); } catch (e) { throw new Error(`Bundle is not valid JSON: ${e.message}`, { cause: e }); }
  }
  if (!b || typeof b !== 'object' || b.format !== BUNDLE_FORMAT) {
    throw new Error(`Not an annotation bundle: expected format "${BUNDLE_FORMAT}", got "${b?.format ?? typeof b}".`);
  }
  if (b.formatVersion !== 1 && b.formatVersion !== 2) {
    throw new Error(`Unsupported bundle formatVersion ${b.formatVersion}; this annotator reads versions 1 and 2.`);
  }

  const warnings = [];
  const commands = b.commands ?? {};
  let viewIndex;
  if (b.formatVersion === 2 && b.viewIndex) {
    viewIndex = structuredClone(b.viewIndex);
  } else {
    viewIndex = viewIndexFromPaths(b.views);
    addEnteredBy(viewIndex, commands);
    warnings.push('Bundle format v1 has no view index: interface equivalence is limited to the views the mappings use. Export the bundle again from ontology-ui for full coverage.');
  }

  const mappings = b.mappings ?? [];
  const commandMappings = [];
  const viewMappings = {};
  const noSyntax = [];
  const noView = [];
  const families = [];
  for (const m of mappings) {
    if (m.sourceType === 'command') {
      if (commands[m.featureId]?.syntax?.length) commandMappings.push(m);
      else noSyntax.push(m.title || m.featureId);
    } else if (m.sourceType === 'view-family') {
      // The bundle names the family but not its member views, so it cannot be applied.
      families.push(m.title || m.viewFamily || m.id);
    } else if (m.view) {
      (viewMappings[m.view] ??= []).push(m);
    } else {
      noView.push(m.title || m.id);
    }
  }
  if (noSyntax.length) {
    warnings.push(`No catalogue syntax for ${noSyntax.length} mapped command(s), so they are never matched: ${[...new Set(noSyntax)].join(', ')}.`);
  }
  if (families.length) {
    warnings.push(`${families.length} view-family mapping(s) are not applied, since the bundle does not list the family's views: ${[...new Set(families)].join(', ')}.`);
  }
  if (noView.length) warnings.push(`${noView.length} view mapping(s) name no view and are not used: ${noView.join(', ')}.`);

  return {
    formatVersion: b.formatVersion,
    device:        b.device ?? {},
    generatedAt:   b.generatedAt ?? null,
    mappings, commands, viewIndex,
    dteEntities:   b.dteEntities ?? {},
    gaps:          b.gaps ?? {},
    commandMappings, viewMappings, warnings,
  };
}
