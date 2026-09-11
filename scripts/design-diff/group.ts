import { createHash } from 'node:crypto'
import type { SourceTree } from '#design-diff/source'
import type { Change, Finding, UsageCount } from '#design-diff/types'

function fileOf(change: Change) {
  return (change.after ?? change.before)?.location.file ?? ''
}

function changedValue(change: Change) {
  return (
    JSON.stringify([change.before?.value, change.before?.conditions]) !==
    JSON.stringify([change.after?.value, change.after?.conditions])
  )
}

function compare(a: Change, b: Change) {
  return (
    Number(a.decision === 'exempt') - Number(b.decision === 'exempt') ||
    Number(!changedValue(a)) - Number(!changedValue(b)) ||
    a.limitations.length - b.limitations.length ||
    fileOf(a).localeCompare(fileOf(b), 'en') ||
    ((a.after ?? a.before)?.location.line ?? 0) - ((b.after ?? b.before)?.location.line ?? 0) ||
    a.id.localeCompare(b.id, 'en')
  )
}

function usage(tree: SourceTree, file: string, symbols?: Set<string>): UsageCount {
  const references = tree.graph.usages(file, symbols)
  return {
    coverage: 'partial',
    referenceCount: references.length,
    fileCount: new Set(references.map((reference) => reference.location.file)).size,
    references,
  }
}

/** One finding per changed source, with direct evidence and one representative consumer. */
export function groupFindings(
  changes: Change[],
  causes: Map<string, Set<string>>,
  before: SourceTree,
  after: SourceTree,
  renames: Map<string, string>
): Finding[] {
  const currentPath = (file: string) => [...renames].find(([, old]) => old === file)?.[0] ?? file
  const groups = new Map<string, Change[]>()
  for (const change of changes) {
    const file = fileOf(change)
    for (const root of new Set([...(causes.get(file) ?? new Set([file]))].map(currentPath))) {
      const entries = groups.get(root) ?? []
      entries.push(change)
      groups.set(root, entries)
    }
  }
  const result: Finding[] = []
  for (const [file, entries] of groups) {
    const oldFile = renames.get(file) ?? file
    const all = [...new Map(entries.map((entry) => [entry.id, entry])).values()].sort(compare)
    const direct = all.filter((entry) => [file, oldFile].includes(fileOf(entry)))
    const indirect = all.filter((entry) => ![file, oldFile].includes(fileOf(entry)))
    const primary = direct[0] ?? indirect[0]
    if (!primary) continue
    const example = indirect[0]
    const previous = before.entries.get(oldFile)
    const next = after.entries.get(file)
    const symbols = before.graph.changedSymbols(oldFile, after.graph, file)
    const impact = {
      basis: 'resolved-static-references' as const,
      before: usage(before, oldFile, symbols),
      after: usage(after, file, symbols),
    }
    const limitations = new Set([
      ...primary.limitations,
      ...direct.flatMap((entry) => entry.limitations),
    ])
    if (example) for (const limitation of example.limitations) limitations.add(limitation)
    const ambiguousExample =
      example && new Set([...(causes.get(fileOf(example)) ?? [])].map(currentPath)).size > 1
    if (ambiguousExample)
      limitations.add(
        'The representative consumer depends on multiple changed sources; its visual effect cannot be attributed to this source alone'
      )
    for (const tree of [before, after]) {
      for (const entry of all)
        for (const limitation of tree.graph.limitations.get(fileOf(entry)) ?? [])
          limitations.add(limitation)
    }
    if (impact.before.referenceCount || impact.after.referenceCount)
      limitations.add(
        'Usage counts are resolved source references, not confirmed visual changes; overrides, inactive variants and runtime conditions can prevent an effect'
      )
    const { id: _primaryId, ...representative } = primary
    const value: Omit<Finding, 'id'> = {
      ...representative,
      decision: all.some((entry) => entry.decision === 'flag') ? 'flag' : 'exempt',
      reason:
        primary.decision === 'exempt' && all.some((entry) => entry.decision === 'flag')
          ? 'Potential downstream visual effect; static evidence is incomplete'
          : primary.reason,
      source: {
        before: previous ? { file: oldFile, blob: previous.oid } : null,
        after: next ? { file, blob: next.oid } : null,
      },
      categories: [
        ...new Set([...direct, ...(example ? [example] : [])].map((entry) => entry.category)),
      ].sort(),
      changes: direct,
      example: example
        ? {
            basis:
              changedValue(example) && !ambiguousExample
                ? 'changed-definition'
                : 'potential-consumer',
            change: example,
          }
        : null,
      impact,
      consumers: [
        ...new Set(
          [...impact.before.references, ...impact.after.references].map(
            (reference) => reference.location.file
          )
        ),
      ].sort(),
      dependencies: [
        ...new Set([
          file,
          oldFile,
          ...direct.flatMap((entry) => entry.dependencies),
          ...(example?.dependencies ?? []),
        ]),
      ].sort(),
      limitations: [...limitations].sort(),
    }
    result.push({
      ...value,
      id: createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24),
    })
  }
  return result.sort(
    (a, b) =>
      (a.source.after ?? a.source.before)?.file.localeCompare(
        (b.source.after ?? b.source.before)?.file ?? '',
        'en'
      ) ?? 0
  )
}
