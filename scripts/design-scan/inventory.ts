import { findingFingerprint } from '#control-analysis/review-ledger'
import { productScope } from '#control-analysis/scope'
import { artworkFile, localArtworkDiff } from '#design-conformance/artwork'
import { inspectSnapshotFacts, prepareSnapshotFacts } from '#design-conformance/conformance'
import {
  centralInventory,
  componentContract,
  isRegistry,
  registry,
} from '#design-conformance/contracts'
import { designSystem } from '#design-conformance/design-system'
import { extract } from '#design-conformance/extract'
import { canonical, type Facts, type Finding, hash } from '#design-conformance/model'
import { SourceIndex } from '#design-conformance/source-summary'
import {
  compare,
  type GitSource,
  regular,
  type SourceEntry,
} from '#design-conformance/worktree-source'

export interface Diagnostic {
  file: string
  line: number
  context: string
  reason: string
}
export interface InventoryFinding extends Finding {
  id: string
  observedFrom: string[]
}
export interface Inventory {
  mode: 'snapshot' | 'working-tree'
  status: 'completed'
  commit: string
  centralHash: string
  treeHash: string
  findings: InventoryFinding[]
  unchecked: Diagnostic[]
  coverage: {
    files: Record<string, number>
    governedInputs: number
    ungovernedInputs: number
    filesWithFindings: number
    violationOccurrences: number
    rootsInspected: number
  }
  limitations: string[]
}
export interface ScanOptions {
  order?: 'forward' | 'reverse'
  batchSize?: number
  /** Verified landing-owned shared renderers are outside product styling coverage. */
  excludedPaths?: ReadonlySet<string>
  withSourceIndex?: (
    index: SourceIndex,
    findings: InventoryFinding[],
    system: Awaited<ReturnType<typeof designSystem>>
  ) =>
    | undefined
    | {
        findings: InventoryFinding[]
        unchecked: Diagnostic[]
        replaceFindings?: InventoryFinding[]
      }
  progress?: (completed: number, total: number) => void
}

/** Full inventory reuses the maintained styling analysis and adds review diagnostics. */
export async function inspectInventory(
  source: GitSource,
  options: ScanOptions = {}
): Promise<Inventory> {
  const batchSize = options.batchSize ?? 25
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000)
    throw new Error('Batch size must be 1–1000')
  const input = source.central()
  const system = await designSystem(input)
  const notes = new Map<string, Diagnostic>()
  const note = (n: Diagnostic) => notes.set(canonical(n), n)
  const counts: Record<string, number> = {
    central: 0,
    excluded: 0,
    unsupported: 0,
    nonRegular: 0,
    oversized: 0,
    consumer: 0,
  }
  const consumers: SourceEntry[] = []
  const central: SourceEntry[] = []
  for (const entry of source.entries) {
    if (options.excludedPaths?.has(entry.path) || entry.path.startsWith('apps/sim/app/(docs)/')) {
      counts.excluded++
      continue
    }
    if (centralInventory(entry.path) || artworkFile(entry.path) || isRegistry(entry.path)) {
      counts.central++
      if (centralInventory(entry.path) && regular(entry)) central.push(entry)
      continue
    }
    if (registry.artwork?.brandingFiles.includes(entry.path))
      note({
        file: entry.path,
        line: 1,
        context: 'artwork-ownership',
        reason: 'Mixed provider/product artwork is inventoried by the maintained artwork pass',
      })
    const scope = productScope(entry.path)
    if (scope === 'exclude') counts.excluded++
    else if (scope === 'unsupported') {
      counts.unsupported++
      note({
        file: entry.path,
        line: 1,
        context: '',
        reason: 'Unsupported file format; no styling inspected',
      })
    } else if (!regular(entry)) {
      counts.nonRegular++
      note({ file: entry.path, line: 1, context: '', reason: 'Symlink/submodule is not followed' })
    } else if (entry.bytes > registry.limits.sourceBytes) {
      counts.oversized++
      note({
        file: entry.path,
        line: 1,
        context: '',
        reason: 'Source exceeds the 2 MiB parsing limit',
      })
    } else {
      consumers.push(entry)
      counts.consumer++
    }
  }
  const read = (entry: SourceEntry) =>
    extract(source.read(entry), entry.path, true, {
      conformance: true,
      resolve: system.resolve,
      contract: (target) => componentContract(target, system.metadata),
    })
  /** Keep only detached metadata between passes; no ASTs or application execution. */
  const metadata = [...central, ...consumers]
    .sort((a, b) => compare(a.path, b.path))
    .map((entry) => {
      const facts = read(entry)
      return {
        file: entry.path,
        facts: {
          syntax: facts.syntax,
          atoms: [],
          unchecked: [],
          surfaces: facts.surfaces?.map((s) => ({
            ...s,
            atoms: [],
            references: [],
            unresolved: undefined,
          })),
        } satisfies Facts,
      }
    })
  /** Canonical construction and inspection order keep budget decisions independent of discovery. */
  const index = new SourceIndex(metadata, undefined, undefined, system.metadata)
  metadata.length = 0
  const orderedEntries = options.order === 'reverse' ? [...consumers].reverse() : consumers
  const factsByFile = new Map<string, Facts>()
  /** Discovery order exercises the parser independently; semantic processing is always canonical. */
  let retainedBytes = 0
  for (const entry of orderedEntries) {
    if (retainedBytes >= 64 * 1024 * 1024) break
    const facts = read(entry)
    retainedBytes += Buffer.byteLength(canonical(facts))
    factsByFile.set(entry.path, facts)
  }
  const findings = new Map<string, InventoryFinding>()
  const add = (finding: Finding) => {
    const id = hash(
      canonical([
        finding.file,
        finding.line,
        finding.column,
        finding.rule,
        finding.property,
        finding.value,
        finding.context,
      ])
    )
    findings.set(id, {
      ...finding,
      identity: findingFingerprint(finding),
      id,
      observedFrom: [finding.file],
    })
  }
  let governed = 0
  let ungoverned = 0
  try {
    for (const [i, entry] of consumers.entries()) {
      const facts = factsByFile.get(entry.path) ?? read(entry)
      factsByFile.delete(entry.path)
      const result = inspectSnapshotFacts(
        prepareSnapshotFacts(facts, entry.path, index),
        entry.path,
        system
      )
      governed += result.governed
      ungoverned += result.ungoverned
      for (const n of result.unchecked) note({ ...n, file: entry.path })
      for (const f of result.findings) add(f)
      for (const f of localArtworkDiff({ atoms: [], surfaces: [], unchecked: [] }, facts, {
        before: null,
        after: entry,
        status: 'A',
      }))
        add(f)
      if ((i + 1) % batchSize === 0 || i + 1 === consumers.length)
        options.progress?.(i + 1, consumers.length)
    }
    for (const n of index.notes)
      note({
        ...n,
        file: n.file ?? '<shared-source-index>',
        reason: n.reason.replace('Per-PR', 'Shared source index'),
      })
    const additional = options.withSourceIndex?.(index, [...findings.values()], system)
    if (additional?.replaceFindings) {
      findings.clear()
      for (const finding of additional.replaceFindings) add(finding)
    }
    for (const finding of additional?.findings ?? []) add(finding)
    for (const diagnostic of additional?.unchecked ?? []) note(diagnostic)
  } finally {
    index.release()
    factsByFile.clear()
  }
  const ordered = [...findings.values()].sort((a, b) =>
    compare(
      canonical([a.file, a.line, a.column, a.rule, a.id]),
      canonical([b.file, b.line, b.column, b.rule, b.id])
    )
  )
  return {
    mode: source.mode,
    status: 'completed',
    commit: source.commit,
    centralHash: input.snapshot.hash,
    treeHash: hash(canonical(source.entries)),
    findings: ordered,
    unchecked: [...notes.values()].sort((a, b) => compare(canonical(a), canonical(b))),
    coverage: {
      files: counts,
      governedInputs: governed,
      ungovernedInputs: ungoverned,
      filesWithFindings: new Set(ordered.map((f) => f.file)).size,
      violationOccurrences: ordered.length,
      rootsInspected: consumers.length,
    },
    limitations: [
      'Shared generated contracts and maintained analysis identify styling inputs and source review evidence; findings do not prove visual defects.',
      'All supported source summaries share one index, replacing the old 64-module per-consumer closure. Frozen resolution depth 12, composition branch limit 64 and shared metadata budget 32 MiB still apply; failures remain explicit.',
      'Dynamic helpers, arbitrary runtime CSS cascade, cross-file CSS-variable assignments and undocumented slot delegation remain unsupported. Central provenance does not prove intended design.',
      'Each authored input is checked once with the available global caller context. observedFrom identifies the inspected owner, not runtime multiplicity.',
      'Source declarations may be unused. User-authored content, landing, docs, native desktop/build code and intentional presentation exclusions remain outside this audit. Browser desktop product screens remain in scope.',
      'The maintained colour-assignment pass additionally checks local CSS-variable writers. Verified alias provenance resolves matching colour usage findings; all unresolved writes and diagnostics remain visible. Provenance does not prove CSS cascade, inheritance or runtime coverage.',
    ],
  }
}
