/**
 * Columns a write touched, ready for an audit row's `updatedFields` metadata.
 *
 * Pass the update object the write actually applied — never the caller's
 * params. A param is not a write: an unchanged value still arrives, and a
 * writer often sets columns nobody asked for (a status reset forced by some
 * other change). Deriving names from input is what makes audit rows name fields
 * that were never written and omit the ones that were.
 *
 * `updatedAt` is excluded because every write moves it, so it is noise in every
 * row. Keeping that rule here means it is one edit if the set ever grows.
 */
export function auditUpdatedFields(updateValues: object): string[] {
  return Object.keys(updateValues).filter((key) => key !== 'updatedAt')
}
