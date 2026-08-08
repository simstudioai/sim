/**
 * The bracketed placeholders a VFS read returns in place of file content, and the
 * predicates that classify them. Producers and matchers live in different modules;
 * hand-written copies of the same prefix are how an oversized image once slipped past
 * the read-size gate, which tested for a prefix no producer emitted.
 *
 * Keep free of heavy imports — the tool handlers pull it in without wanting the VFS.
 */

import { formatFileSize } from '@/lib/uploads/utils/file-utils'

const PREFIX = {
  fileTooLarge: '[File too large to display inline:',
  imageTooLarge: '[Image too large to read inline:',
  imageUnavailable: '[Image unavailable:',
  documentTooLarge: '[Document too large to parse inline:',
  compiledArtifactTooLarge: '[Compiled artifact too large:',
  couldNotParse: '[Could not parse',
  binaryFile: '[Binary file:',
} as const

export const readPlaceholder = {
  fileTooLarge: (name: string, bytes: number, limit: number) =>
    `${PREFIX.fileTooLarge} ${name} (${bytes} bytes, limit ${limit})]`,
  imageTooLarge: (name: string, bytes: number, limit: number) =>
    `${PREFIX.imageTooLarge} ${name} (${bytes} bytes, limit ${limit})]`,
  // Formats here rather than at the call site: without `includeBytes` every
  // sub-1KB file — which is every decompression bomb — prints as "0 Bytes".
  imageUnavailable: (name: string, bytes: number, reason: string) =>
    `${PREFIX.imageUnavailable} ${name} (${formatFileSize(bytes, { includeBytes: true })}). ${reason}]`,
  documentTooLarge: (name: string, bytes: number, limit: number) =>
    `${PREFIX.documentTooLarge} ${name} (${bytes} bytes, limit ${limit})]`,
  compiledArtifactTooLarge: (name: string, bytes: number, limit: number) =>
    `${PREFIX.compiledArtifactTooLarge} ${name} (${bytes} bytes, limit ${limit})]`,
  couldNotParse: (name: string, type: string, bytes: number) =>
    `${PREFIX.couldNotParse} ${name} (${type}, ${bytes} bytes)]`,
  binaryFile: (name: string, type: string, bytes: number) =>
    `${PREFIX.binaryFile} ${name} (${type}, ${bytes} bytes). Cannot display as text.]`,
} as const

/**
 * Placeholders standing in for content that exists but exceeded a read cap; the read
 * handler turns these into a tool error.
 *
 * Every size refusal belongs here — a document that breaches its cap is the same
 * kind of answer as a file or an image that does, and reporting one of the three as
 * a successful read was an inconsistency, not a distinction.
 *
 * Deliberately narrower than {@link isNonGreppablePlaceholder}: a parse failure or
 * a binary file is not a size problem, and `[Image unavailable:` covers undecodable
 * images as well as oversized ones, so neither belongs on the size path.
 */
const OVERSIZED_PREFIXES = [
  PREFIX.fileTooLarge,
  PREFIX.imageTooLarge,
  PREFIX.documentTooLarge,
  PREFIX.compiledArtifactTooLarge,
] as const

/** Every placeholder — none of them carry text worth searching. */
const NON_GREPPABLE_PREFIXES = Object.values(PREFIX)

export function isOversizedReadPlaceholder(content: string): boolean {
  return OVERSIZED_PREFIXES.some((prefix) => content.startsWith(prefix))
}

/**
 * True when a read result is a placeholder rather than file content. Only ever a
 * single line, which is what keeps a real file that merely opens with `[Binary file:`
 * greppable.
 */
export function isNonGreppablePlaceholder(content: string, totalLines: number): boolean {
  if (totalLines !== 1) return false
  const trimmed = content.trim()
  return NON_GREPPABLE_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
}
