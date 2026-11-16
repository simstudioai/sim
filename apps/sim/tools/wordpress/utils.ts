/**
 * Splits a list of WordPress term IDs into trimmed, non-empty entries. Accepts the block's
 * comma-separated string as well as the number or array a model may send on a tool call.
 */
export function splitIdList(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : String(value).split(',')
  return entries.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0)
}

/**
 * {@link splitIdList}, parsed to integers. Throws on an unparseable entry rather than dropping
 * it, since an emptied list would clear the post's existing terms on update.
 */
export function parseIdList(value: unknown): number[] {
  return splitIdList(value).map((entry) => {
    const id = Number.parseInt(entry, 10)
    if (Number.isNaN(id)) throw new Error(`Invalid WordPress term ID: "${entry}"`)
    return id
  })
}
