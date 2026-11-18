/**
 * The `folderId` body value for a generation. Gamma places a gamma in one folder (its older
 * `folderIds` array is deprecated and capped at one ID), so a comma-separated list with more
 * than one ID is rejected here with a clear message.
 */
export function gammaFolderId(value: string | undefined): string | undefined {
  const ids = (value ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
  if (ids.length > 1) {
    throw new Error('Gamma accepts one folder ID; remove the extra folder IDs')
  }
  return ids[0]
}
