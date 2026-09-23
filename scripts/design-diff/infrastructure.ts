import { type ParseError, parse } from 'jsonc-parser'
import { canonicalJson } from '#design-diff/ast'
import type { Data } from '#design-diff/types'

/** Compare the resolved rendering dependency closure, including nested installations. */
export function renderingLock(source: string | undefined, pattern: string): Data {
  if (source === undefined) return null
  const errors: ParseError[] = []
  const lock = parse(source, errors, { allowTrailingComma: true })
  if (errors.length || !lock || typeof lock.packages !== 'object')
    return { $unresolved: 'Malformed or unsupported Bun lockfile', source }
  const packages = lock.packages as Record<string, unknown>
  const relevant = new RegExp(pattern)
  const nameOf = (key: string) =>
    key
      .split('/')
      .slice(key.includes('/@') ? -2 : key.startsWith('@') && key.split('/').length === 2 ? 0 : -1)
      .join('/')
  const pending = Object.keys(packages).filter((key) => relevant.test(nameOf(key)))
  const result: Record<string, unknown> = {}
  while (pending.length) {
    const key = pending.pop()!
    if (Object.hasOwn(result, key)) continue
    const entry = packages[key]
    result[key] = entry
    if (!Array.isArray(entry)) continue
    const options = entry[2]
    if (!options || typeof options !== 'object') continue
    for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      const dependencies = (options as Record<string, Record<string, string>>)[section] ?? {}
      for (const name of Object.keys(dependencies)) {
        let parent = key
        let found: string | undefined
        while (parent) {
          const candidate = `${parent}/${name}`
          if (Object.hasOwn(packages, candidate)) {
            found = candidate
            break
          }
          parent = parent.includes('/') ? parent.slice(0, parent.lastIndexOf('/')) : ''
        }
        if (!found && Object.hasOwn(packages, name)) found = name
        if (found) pending.push(found)
        else if (section === 'dependencies')
          result[`unresolved:${key}:${name}`] = dependencies[name]
      }
    }
  }
  return canonicalJson(result as Data)
}
