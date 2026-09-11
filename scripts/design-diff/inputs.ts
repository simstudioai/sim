import path from 'node:path'
import { canonicalJson } from '#design-diff/ast'
import { compareDefinitions } from '#design-diff/compare'
import { Resolver } from '#design-diff/resolve'
import type { SourceTree } from '#design-diff/source'
import type { Change, Config, Data, Definition } from '#design-diff/types'

/** Explicit file-loading conventions are data edges, never runtime filesystem reads. */
export function fileLoadedInputs(before: SourceTree, after: SourceTree, config: Config): Change[] {
  const read = (
    tree: SourceTree,
    input: NonNullable<Config['fileInputs']>[number]
  ): Definition[] => {
    if (!tree.entries.has(input.list) && !tree.entries.has(input.renderer)) return []
    const definitions: Definition[] = []
    const emit = (file: string, value: Data, unresolved: string[] = []) =>
      definitions.push({
        key: file,
        kind: unresolved.length ? 'review' : 'content',
        property: 'file-loaded-documentation',
        value,
        location: { file, line: 1, column: 1 },
        symbol: input.export,
        conditions: [{ renderer: input.renderer, list: input.list }],
        dependencies: [file, input.list, input.renderer],
        unresolved,
      })
    try {
      const resolver = new Resolver(tree)
      const exported = resolver.module(input.list).exports.get(input.export)
      if (!exported || !tree.entries.has(input.renderer))
        throw new Error('Configured renderer or export unavailable')
      const evidence = resolver.evaluate(exported, input.list)
      if (
        evidence.unresolved.length ||
        !Array.isArray(evidence.value) ||
        !evidence.value.every((file) => typeof file === 'string')
      )
        throw new Error('Configured input list is not a static string array')
      emit(input.list, evidence.value)
      for (const name of evidence.value as string[]) {
        const file = path.posix.normalize(path.posix.join(input.root, name))
        if (!file.startsWith(`${input.root}/`) || !file.endsWith('.json'))
          throw new Error('Unsupported configured input path')
        try {
          const value = JSON.parse(tree.texts.get(file) ?? '')
          emit(file, canonicalJson(value))
        } catch {
          emit(file, tree.entries.get(file)?.oid ?? 'missing', [
            'Configured documentation JSON is missing, malformed or exceeds the source budget',
          ])
        }
      }
    } catch {
      emit(input.list, tree.entries.get(input.list)?.oid ?? 'missing', [
        'Configured documentation list or renderer could not be resolved',
      ])
    }
    return definitions
  }
  const findings: Change[] = []
  for (const input of config.fileInputs ?? []) {
    const a = read(before, input)
    const b = read(after, input)
    findings.push(...compareDefinitions(a, b))
    /** An unchanged invalid configured input is a coverage failure, never a clean analysis. */
    for (const definition of b.filter((definition) => definition.unresolved.length))
      if (!findings.some((finding) => finding.after?.location.file === definition.location.file))
        findings.push(...compareDefinitions([], [definition]))
  }
  return findings
}
