import { isIdentifierName } from '../code-files/ref-path'
import type { BlockKey } from '../model'
import { SDK_RESERVED_IDENTIFIERS } from '../sdk'

/** `'Classify ticket'` → `classifyTicket`; non-ASCII and punctuation split words. */
function deriveIdentifier(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter((word) => word.length > 0)
  if (words.length === 0) return 'block'
  const [first = '', ...rest] = words
  const head =
    first === first.toUpperCase() ? first.toLowerCase() : first[0]?.toLowerCase() + first.slice(1)
  const tail = rest.map((word) => (word[0]?.toUpperCase() ?? '') + word.slice(1)).join('')
  const ident = head + tail
  return /^[0-9]/.test(ident) ? `_${ident}` : ident
}

function isReservedIdentifier(name: string, extraReserved: ReadonlySet<string>): boolean {
  return SDK_RESERVED_IDENTIFIERS.has(name) || extraReserved.has(name)
}

/**
 * Assigns one unique `const` identifier per block. Blocks are visited in declaration order: a
 * usable hinted ident (lock or source meta) is claimed first, so a canvas rename keeps the
 * identifier; the rest derive camelCase from the display name, with a
 * numeric suffix on collision with another block, `SDK_RESERVED_IDENTIFIERS` or a name in
 * `reserved` (the builder namespaces the printed file may import).
 */
export function assignIdentifiers(
  blocks: Array<{ key: BlockKey; name: string; hint: string | undefined }>,
  reserved: ReadonlySet<string>
): Map<BlockKey, string> {
  const taken = new Set<string>()
  const result = new Map<BlockKey, string>()
  for (const block of blocks) {
    const hint = block.hint
    if (
      hint !== undefined &&
      isIdentifierName(hint) &&
      !isReservedIdentifier(hint, reserved) &&
      !taken.has(hint)
    ) {
      taken.add(hint)
      result.set(block.key, hint)
    }
  }
  for (const block of blocks) {
    if (result.has(block.key)) continue
    const base = deriveIdentifier(block.name)
    let candidate = base
    let suffix = 2
    while (isReservedIdentifier(candidate, reserved) || taken.has(candidate)) {
      candidate = `${base}${suffix}`
      suffix += 1
    }
    taken.add(candidate)
    result.set(block.key, candidate)
  }
  return result
}
