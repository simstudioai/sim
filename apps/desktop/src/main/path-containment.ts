import { isAbsolute, relative, sep } from 'node:path'

/**
 * Whether a resolved path is the granted root or sits beneath it.
 *
 * Uses `relative()` rather than prefix arithmetic. The `${root}${sep}` sentinel
 * that form needs to reject `/granted-evil` against `/granted` becomes `//` when
 * the root IS a separator — and the picker lets the user grant a volume root —
 * so every path under a granted `/` was denied while the bare root passed.
 * `relative()` has no such edge case: it returns `''` for the root itself and a
 * leading `..` segment for anything outside, on both separators. On Windows it
 * compares case-insensitively, as NTFS resolves names.
 */
export function isWithinRoot(rootPath: string, candidatePath: string): boolean {
  const rel = relative(rootPath, candidatePath)
  if (rel === '') return true
  // A leading `..` SEGMENT, not the two characters: `..config` is an ordinary
  // child name, and matching it as an escape would deny a real dotfile.
  if (rel === '..' || rel.startsWith(`..${sep}`)) return false
  // A different Windows volume relativizes to an absolute path rather than a
  // `..` walk, so it has to be rejected separately.
  return !isAbsolute(rel)
}
