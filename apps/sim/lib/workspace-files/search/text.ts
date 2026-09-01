import { Buffer, isUtf8 } from 'node:buffer'
import {
  FILE_SEARCH_MAX_PREVIEW_BYTES,
  FILE_SEARCH_SEGMENT_CHARS,
  FILE_SEARCH_SEGMENT_OVERLAP_CHARS,
} from '@/lib/workspace-files/search/constants'
import type {
  CompiledFileSearchPattern,
  FileSearchMatchRange,
} from '@/lib/workspace-files/search/pattern'

export interface LogicalLine {
  lineNumber: number
  text: string
}

export interface SearchSegment {
  lineNumber: number
  segmentNumber: number
  segmentStart: number
  lineLength: number
  content: string
}

export function* iterateLogicalLines(text: string): Generator<LogicalLine> {
  let lineStart = 0
  let lineNumber = 1
  for (let index = 0; index <= text.length; index += 1) {
    if (index !== text.length && text.charCodeAt(index) !== 10) continue
    const hasCarriageReturn = index > lineStart && text.charCodeAt(index - 1) === 13
    yield {
      lineNumber,
      text: text.slice(lineStart, hasCarriageReturn ? index - 1 : index),
    }
    lineStart = index + 1
    lineNumber += 1
  }
}

function safeSegmentEnd(text: string, requestedEnd: number): number {
  if (requestedEnd >= text.length) return text.length
  const previousCodeUnit = text.charCodeAt(requestedEnd - 1)
  const nextCodeUnit = text.charCodeAt(requestedEnd)
  return previousCodeUnit >= 0xd800 && previousCodeUnit <= 0xdbff && nextCodeUnit >= 0xdc00
    ? requestedEnd - 1
    : requestedEnd
}

export function* segmentLogicalLine(
  line: LogicalLine,
  segmentChars = FILE_SEARCH_SEGMENT_CHARS,
  overlapChars = FILE_SEARCH_SEGMENT_OVERLAP_CHARS
): Generator<SearchSegment> {
  if (line.text.length === 0) return
  const step = Math.max(1, segmentChars - overlapChars)
  let segmentNumber = 0
  for (let start = 0; start < line.text.length; start += step) {
    const end = safeSegmentEnd(line.text, Math.min(line.text.length, start + segmentChars))
    yield {
      lineNumber: line.lineNumber,
      segmentNumber,
      segmentStart: start,
      lineLength: line.text.length,
      content: line.text.slice(start, end),
    }
    segmentNumber += 1
    if (end === line.text.length) break
  }
}

function utf8PrefixWithinBudget(text: string, maxBytes: number): string {
  let low = 0
  let high = text.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(text.slice(0, middle), 'utf8') <= maxBytes) low = middle
    else high = middle - 1
  }
  let end = low
  if (end > 0 && end < text.length) {
    const previousCodeUnit = text.charCodeAt(end - 1)
    const nextCodeUnit = text.charCodeAt(end)
    if (
      previousCodeUnit >= 0xd800 &&
      previousCodeUnit <= 0xdbff &&
      nextCodeUnit >= 0xdc00 &&
      nextCodeUnit <= 0xdfff
    ) {
      end -= 1
    }
  }
  return text.slice(0, end)
}

function utf8SuffixWithinBudget(text: string, maxBytes: number): string {
  const reversedCodePoints = [...text].reverse().join('')
  return [...utf8PrefixWithinBudget(reversedCodePoints, maxBytes)].reverse().join('')
}

export function truncateUtf8ToBytes(text: string, maxBytes: number): string {
  const candidate = text.length > maxBytes ? text.slice(0, maxBytes) : text
  const encoded = Buffer.from(candidate, 'utf8')
  if (encoded.length <= maxBytes) return candidate
  let end = maxBytes
  while (end > 0 && !isUtf8(encoded.subarray(0, end))) end -= 1
  return encoded.subarray(0, end).toString('utf8')
}

/**
 * Renders one matching segment as a bounded, match-centred excerpt.
 *
 * The excerpt is cut around the match rather than at the head of the line.
 * `matchRange` carries a match the caller already located — which is how a
 * regex match arrives, since only PostgreSQL may run one — and otherwise the
 * pattern locates its own. A match that neither can place still renders,
 * anchored at the start of the segment.
 */
export function createFileSearchPreview(
  line: string,
  pattern: CompiledFileSearchPattern,
  maxBytes = FILE_SEARCH_MAX_PREVIEW_BYTES,
  boundaries: {
    prefixOmitted?: boolean
    suffixOmitted?: boolean
    matchRange?: FileSearchMatchRange | null
  } = {}
): string {
  const boundaryBytes =
    (boundaries.prefixOmitted ? Buffer.byteLength('…', 'utf8') : 0) +
    (boundaries.suffixOmitted ? Buffer.byteLength('…', 'utf8') : 0)
  if (Buffer.byteLength(line, 'utf8') + boundaryBytes <= maxBytes) {
    return `${boundaries.prefixOmitted ? '…' : ''}${line}${boundaries.suffixOmitted ? '…' : ''}`
  }

  const { start: matchStart, end: matchEnd } = boundaries.matchRange ??
    pattern.findMatchRange(line) ?? { start: 0, end: 0 }
  const leadingEllipsis = boundaries.prefixOmitted || matchStart > 0 ? '…' : ''
  const trailingEllipsis = boundaries.suffixOmitted || matchEnd < line.length ? '…' : ''
  const ellipsisBytes = Buffer.byteLength(leadingEllipsis + trailingEllipsis, 'utf8')
  const match = line.slice(matchStart, matchEnd)
  const matchBytes = Buffer.byteLength(match, 'utf8')
  const surroundingBudget = Math.max(0, maxBytes - ellipsisBytes - matchBytes)
  const beforeBudget = Math.floor(surroundingBudget / 2)
  const afterBudget = surroundingBudget - beforeBudget
  const before = utf8SuffixWithinBudget(line.slice(0, matchStart), beforeBudget)
  const after = utf8PrefixWithinBudget(line.slice(matchEnd), afterBudget)
  const preview = `${boundaries.prefixOmitted || before.length < matchStart ? '…' : ''}${
    before
  }${match}${after}${boundaries.suffixOmitted || matchEnd + after.length < line.length ? '…' : ''}`
  return utf8PrefixWithinBudget(preview, maxBytes)
}
