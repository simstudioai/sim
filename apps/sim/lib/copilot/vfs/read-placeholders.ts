/**
 * The bracketed placeholders a VFS read returns in place of file content, and the
 * predicates that classify them. Producers and matchers live in different modules;
 * hand-written copies of the same prefix are how an oversized image once slipped past
 * the read-size gate, which tested for a prefix no producer emitted.
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
 * Placeholders meaning "the file is there, but reading it was refused on size"; the
 * read handler turns these into a tool error rather than a one-line success.
 *
 * File, image, document and compiled artifact all belong here — reporting one of
 * the four as a successful read was an inconsistency, not a distinction.
 *
 * `[Image unavailable:` is excluded even though one of its reasons is a size, because
 * its other reasons are not: it also covers an undecodable or unsupported image, and
 * those are answers rather than refusals. Callers get it as content.
 */
const OVERSIZED_PREFIXES = [
  PREFIX.fileTooLarge,
  PREFIX.imageTooLarge,
  PREFIX.documentTooLarge,
  PREFIX.compiledArtifactTooLarge,
] as const

/** Every placeholder — none of them carry text worth searching. */
const NON_GREPPABLE_PREFIXES = Object.values(PREFIX)

function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Matches a size refusal in full rather than by prefix. Every builder above emits the
 * same `… (N bytes, limit M)]` tail, so requiring it costs nothing and stops a real
 * one-line file that merely opens with this text from being turned into a tool error
 * instead of being returned. Built from {@link OVERSIZED_PREFIXES} so it cannot drift
 * from the producers. One unnested `.+` against a fixed suffix — no backtracking.
 */
const OVERSIZED_PATTERN = new RegExp(
  `^(?:${OVERSIZED_PREFIXES.map(escapeRegex).join('|')}) .+ \\(\\d+ bytes, limit \\d+\\)\\]$`
)

export function isOversizedReadPlaceholder(content: string): boolean {
  return OVERSIZED_PATTERN.test(content)
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
