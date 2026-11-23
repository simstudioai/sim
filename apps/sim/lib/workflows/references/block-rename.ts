import { escapeRegExp } from '@sim/utils/string'

/**
 * `value` with every `<oldName.` reference token rewritten to `<newName.` for each entry of
 * `nameMap` (normalized block names), recursing through arrays and objects; the result has the
 * shape `value` had. The editor's rename, an operations-batch rename, and a workflow import all
 * rewrite block references through this.
 */
export function rewriteBlockNameReferences<T>(value: T, nameMap: ReadonlyMap<string, string>): T {
  return rewrite(value, nameMap) as T
}

function rewrite(value: unknown, nameMap: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') {
    let updatedValue = value
    nameMap.forEach((newName, oldName) => {
      /**
       * A rename to itself is a no-op, so skip the scan entirely. This is the
       * whole map on the import path (`regenerateWorkflowIds` seeds it with
       * `name -> name`), which turns an O(names x values) rescan of every
       * sub-block string into nothing.
       */
      if (oldName === newName) return

      /**
       * `oldName` is a block name, which reaches this function straight from
       * imported workflow JSON — `normalizeWorkflowBlockName` only lowercases
       * and strips whitespace/dots, so regex metacharacters survive. Without
       * escaping, a name like `a*a*a*a*b` compiles to a catastrophically
       * backtracking pattern that pins the event loop on a sub-kilobyte input.
       */
      const regex = new RegExp(`<${escapeRegExp(oldName)}\\.`, 'g')
      // A callback, so `$&` or `$'` in a new name is written literally, not as a pattern.
      updatedValue = updatedValue.replace(regex, () => `<${newName}.`)
    })
    return updatedValue
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewrite(item, nameMap))
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      result[key] = rewrite(val, nameMap)
    }
    return result
  }
  return value
}
