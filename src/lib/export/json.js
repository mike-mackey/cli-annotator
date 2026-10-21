// The instances of one annotated dump, for other tools.
export function toInstancesJson(result, { dumpFile = null } = {}) {
  return {
    format: 'cli-annotator.instances',
    version: 1,
    dumpFile,
    device: result.device,
    bundle: result.bundle,
    options: result.options,
    warnings: result.warnings,
    coverage: { mappings: result.coverage.mappings, lines: result.coverage.lines },
    instances: result.instances.map(i => ({
      id: i.id, block: i.block, opener: i.opener, view: i.view, via: i.via, name: i.name,
      dte: i.dte, topology: i.topology, topologyCandidates: i.topologyCandidates, lines: i.lines,
    })),
  };
}
