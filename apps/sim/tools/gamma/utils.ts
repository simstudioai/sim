/**
 * The `folderIds` body value for a generation. Gamma accepts at most one folder there, so a
 * comma-separated list with more than one ID is rejected here with a clear message.
 */
export function gammaFolderIds(value: string | undefined): string[] | undefined {
  const ids = (value ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
  if (ids.length === 0) return undefined
  if (ids.length > 1) {
    throw new Error('Gamma accepts one folder ID; remove the extra folder IDs')
  }
  return ids
}
