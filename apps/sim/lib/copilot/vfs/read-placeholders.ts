/**
 * The stand-ins a VFS read returns in place of file content.
 *
 * A placeholder carries its own classification rather than being recognised by its
 * text later. Sniffing the string was wrong twice over: gates drifted from the
 * wording they were matching (one tested a prefix no producer emitted, so it never
 * fired), and a real file whose content merely opened like a placeholder was
 * misclassified as one. Neither is possible when the producer states what it built.
 */

import { formatFileSize } from '@/lib/uploads/utils/file-utils'

/**
 * `oversized` — the file is intact but reading it was refused on size, so the read
 * handler reports a tool error rather than a one-line "success".
 *
 * `unreadable` — the read produced an answer, just not text: undecodable, binary, or
 * unparseable. Callers get it as content. Both are equally unsearchable.
 */
export type PlaceholderKind = 'oversized' | 'unreadable'

export interface ReadPlaceholder {
  content: string
  totalLines: 1
  placeholder: PlaceholderKind
}

function placeholder(kind: PlaceholderKind, content: string): ReadPlaceholder {
  return { content, totalLines: 1, placeholder: kind }
}

export const readPlaceholder = {
  fileTooLarge: (name: string, bytes: number, limit: number) =>
    placeholder(
      'oversized',
      `[File too large to display inline: ${name} (${bytes} bytes, limit ${limit})]`
    ),
  imageTooLarge: (name: string, bytes: number, limit: number) =>
    placeholder(
      'oversized',
      `[Image too large to read inline: ${name} (${bytes} bytes, limit ${limit})]`
    ),
  documentTooLarge: (name: string, bytes: number, limit: number) =>
    placeholder(
      'oversized',
      `[Document too large to parse inline: ${name} (${bytes} bytes, limit ${limit})]`
    ),
  compiledArtifactTooLarge: (name: string, bytes: number, limit: number) =>
    placeholder(
      'oversized',
      `[Compiled artifact too large: ${name} (${bytes} bytes, limit ${limit})]`
    ),
  /**
   * Not `oversized` even when the reason is a size: it also covers an undecodable or
   * unsupported image, which is an answer rather than a refusal.
   *
   * Formats here rather than at the call site — without `includeBytes` every sub-1KB
   * file, which is every decompression bomb, prints as "0 Bytes".
   */
  imageUnavailable: (name: string, bytes: number, reason: string) =>
    placeholder(
      'unreadable',
      `[Image unavailable: ${name} (${formatFileSize(bytes, { includeBytes: true })}). ${reason}]`
    ),
  couldNotParse: (name: string, type: string, bytes: number) =>
    placeholder('unreadable', `[Could not parse ${name} (${type}, ${bytes} bytes)]`),
  binaryFile: (name: string, type: string, bytes: number) =>
    placeholder(
      'unreadable',
      `[Binary file: ${name} (${type}, ${bytes} bytes). Cannot display as text.]`
    ),
} as const

/** A read result, which may or may not have been produced by this module. */
interface MaybePlaceholder {
  placeholder?: PlaceholderKind
}

/** A size refusal, which the read handler surfaces as a tool error. */
export function isOversizedReadPlaceholder(result: MaybePlaceholder): boolean {
  return result.placeholder === 'oversized'
}

/** Any placeholder — none of them carry text worth searching. */
export function isNonGreppablePlaceholder(result: MaybePlaceholder): boolean {
  return result.placeholder !== undefined
}
