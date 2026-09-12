import path from 'node:path'
import { finding } from '#design-diff/compare'
import { Resolver } from '#design-diff/resolve'
import type { SourceTree } from '#design-diff/source'
import type { Change, Config } from '#design-diff/types'

/** Content never qualifies; validate current file-loaded documentation only for coverage notes. */
export function fileLoadedInputDiagnostics(tree: SourceTree, config: Config): Change[] {
  const diagnostics = new Map<string, Change>()
  for (const input of config.fileInputs ?? []) {
    if (!tree.entries.has(input.list) && !tree.entries.has(input.renderer)) continue
    const emit = (file: string, reason: string) => {
      if (diagnostics.has(file)) return
      diagnostics.set(
        file,
        finding(undefined, {
          key: file,
          kind: 'review',
          property: 'file-loaded-documentation',
          value: tree.entries.get(file)?.oid ?? 'missing',
          location: { file, line: 1, column: 1 },
          symbol: input.export,
          conditions: [{ renderer: input.renderer, list: input.list }],
          dependencies: [file, input.list, input.renderer],
          unresolved: [reason],
        })
      )
    }
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
      for (const name of evidence.value as string[]) {
        const file = path.posix.normalize(path.posix.join(input.root, name))
        if (!file.startsWith(`${input.root}/`) || !file.endsWith('.json'))
          throw new Error('Unsupported configured input path')
        try {
          JSON.parse(tree.texts.get(file) ?? '')
        } catch {
          emit(
            file,
            'Configured documentation JSON is missing, malformed or exceeds the source budget'
          )
        }
      }
    } catch {
      emit(input.list, 'Configured documentation list or renderer could not be resolved')
    }
  }
  return [...diagnostics.values()]
}
