export const PASTE_LIMITS = {
  /** Crash-only fallback for controls without a more specific downstream contract. */
  DEFAULT_BYTES: 32 * 1024 * 1024,
  /** Matches the existing collaborative-document seed boundary. */
  RICH_MARKDOWN_BYTES: 5 * 1024 * 1024,
  /** Stays below the 50 MiB JSON request boundary while allowing genuinely large source files. */
  TEXT_EDITOR_BYTES: 32 * 1024 * 1024,
  /** Matches the deployed chat request contract. */
  CHAT_CHARACTERS: 1_000_000,
  /** A Unicode scalar can occupy at most four UTF-8 bytes. */
  CHAT_BYTES: 4_000_000,
  /** Crash-only bound; admitted input is streamed to the PTY in 64 KiB chunks. */
  TERMINAL_BYTES: 8 * 1024 * 1024,
  /** The server's row ceiling remains the primary table bound. */
  STRUCTURED_BYTES: 32 * 1024 * 1024,
} as const

export const PASTE_RENDER_THRESHOLDS = {
  /** Above this size, skip decorative parsing and render a native text surface. */
  ENHANCED_TEXT_CHARACTERS: 256 * 1024,
} as const

export interface TextPasteAdmissionInput {
  pastedText: string
  /** Maximum UTF-8 bytes allowed in the clipboard payload itself. */
  maxPastedBytes?: number
  /** Maximum UTF-16 code units allowed in the clipboard payload itself. */
  maxPastedCharacters?: number
  /** Existing value when the projected post-paste value must also be bounded. */
  currentText?: string
  /** Selection offsets within {@link currentText}. */
  selectionStart?: number
  selectionEnd?: number
  /** Maximum UTF-8 bytes allowed after replacing the selection. */
  maxResultBytes?: number
  /** Maximum UTF-16 code units allowed after replacing the selection. */
  maxResultCharacters?: number
}

export type TextPasteRejectionReason =
  | 'pasted-bytes'
  | 'pasted-characters'
  | 'result-bytes'
  | 'result-characters'

export type TextPasteAdmission =
  | {
      accepted: true
      pastedBytes?: number
      resultBytes?: number
      resultCharacters?: number
    }
  | {
      accepted: false
      reason: TextPasteRejectionReason
      actual: number
      limit: number
    }

/**
 * Measures UTF-8 without allocating the second full-size buffer that `TextEncoder.encode()` creates.
 * When `stopAfter` is supplied, the scan exits as soon as the caller already knows the value is too
 * large. Lone UTF-16 surrogates match `TextEncoder` and count as the three-byte replacement scalar.
 */
export function utf8ByteLengthRange(
  value: string,
  start = 0,
  end = value.length,
  stopAfter = Number.POSITIVE_INFINITY
): number {
  let bytes = 0
  const safeStart = Math.min(Math.max(start, 0), value.length)
  const safeEnd = Math.min(Math.max(end, safeStart), value.length)

  for (let index = safeStart; index < safeEnd; index++) {
    const code = value.charCodeAt(index)
    if (code <= 0x7f) {
      bytes += 1
    } else if (code <= 0x7ff) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (index + 1 < safeEnd && next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        bytes += 3
      }
    } else {
      bytes += 3
    }

    if (bytes > stopAfter) return bytes
  }

  return bytes
}

export function utf8ByteLength(value: string, stopAfter = Number.POSITIVE_INFINITY): number {
  return utf8ByteLengthRange(value, 0, value.length, stopAfter)
}

function normalizedSelection(input: TextPasteAdmissionInput): {
  currentText: string
  start: number
  end: number
} {
  const currentText = input.currentText ?? ''
  const rawStart = input.selectionStart ?? currentText.length
  const rawEnd = input.selectionEnd ?? rawStart
  const start = Math.min(Math.max(Math.min(rawStart, rawEnd), 0), currentText.length)
  const end = Math.min(Math.max(Math.max(rawStart, rawEnd), start), currentText.length)
  return { currentText, start, end }
}

/**
 * Applies the common text-paste policy before an editor parses, tokenizes, renders, or persists the
 * payload. Character checks are constant-time. Byte scans short-circuit at the configured ceiling and
 * never allocate a full encoded copy of the clipboard string.
 */
export function assessTextPaste(input: TextPasteAdmissionInput): TextPasteAdmission {
  const { pastedText } = input

  if (input.maxPastedCharacters !== undefined && pastedText.length > input.maxPastedCharacters) {
    return {
      accepted: false,
      reason: 'pasted-characters',
      actual: pastedText.length,
      limit: input.maxPastedCharacters,
    }
  }

  if (input.maxPastedBytes !== undefined && pastedText.length > input.maxPastedBytes) {
    return {
      accepted: false,
      reason: 'pasted-bytes',
      actual: pastedText.length,
      limit: input.maxPastedBytes,
    }
  }

  const pastedByteLimit = Math.max(input.maxPastedBytes ?? 0, input.maxResultBytes ?? 0)
  const pastedBytes = pastedByteLimit > 0 ? utf8ByteLength(pastedText, pastedByteLimit) : undefined

  if (
    input.maxPastedBytes !== undefined &&
    pastedBytes !== undefined &&
    pastedBytes > input.maxPastedBytes
  ) {
    return {
      accepted: false,
      reason: 'pasted-bytes',
      actual: pastedBytes,
      limit: input.maxPastedBytes,
    }
  }

  if (input.maxResultBytes === undefined && input.maxResultCharacters === undefined) {
    return { accepted: true, pastedBytes }
  }

  const { currentText, start, end } = normalizedSelection(input)
  const resultCharacters = currentText.length - (end - start) + pastedText.length
  if (input.maxResultCharacters !== undefined && resultCharacters > input.maxResultCharacters) {
    return {
      accepted: false,
      reason: 'result-characters',
      actual: resultCharacters,
      limit: input.maxResultCharacters,
    }
  }

  if (input.maxResultBytes === undefined) {
    return { accepted: true, pastedBytes, resultCharacters }
  }

  const prefixBytes = utf8ByteLengthRange(currentText, 0, start, input.maxResultBytes)
  if (prefixBytes > input.maxResultBytes) {
    return {
      accepted: false,
      reason: 'result-bytes',
      actual: prefixBytes,
      limit: input.maxResultBytes,
    }
  }
  const suffixBudget = input.maxResultBytes - prefixBytes
  const suffixBytes = utf8ByteLengthRange(currentText, end, currentText.length, suffixBudget)
  const resultBytes = prefixBytes + suffixBytes + (pastedBytes ?? utf8ByteLength(pastedText))
  if (resultBytes > input.maxResultBytes) {
    return {
      accepted: false,
      reason: 'result-bytes',
      actual: resultBytes,
      limit: input.maxResultBytes,
    }
  }

  return { accepted: true, pastedBytes, resultBytes, resultCharacters }
}

/** Counts logical rows without allocating the array produced by `split()`. */
export function countPasteRows(text: string, stopAfter = Number.POSITIVE_INFINITY): number {
  if (!text) return 0
  let rows = 1
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code === 10) {
      rows += 1
    } else if (code === 13) {
      rows += 1
      if (text.charCodeAt(index + 1) === 10) index += 1
    }
    if (rows > stopAfter) return rows
  }
  return rows
}

export function formatPasteLimit(bytes: number): string {
  if (bytes >= 1_000_000 && bytes % 1_000_000 === 0) return `${bytes / 1_000_000} MB`
  if (bytes >= 1024 * 1024) {
    const mebibytes = bytes / (1024 * 1024)
    return `${Number.isInteger(mebibytes) ? mebibytes : mebibytes.toFixed(1)} MiB`
  }
  return `${Math.round(bytes / 1024)} KiB`
}
