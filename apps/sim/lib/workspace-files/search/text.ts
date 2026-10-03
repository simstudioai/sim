import { Buffer } from 'node:buffer'
import { FILE_SEARCH_MAX_PREVIEW_BYTES } from '@/lib/workspace-files/search/constants'
import type {
  CompiledFileSearchPattern,
  FileSearchMatchRange,
} from '@/lib/workspace-files/search/pattern'

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

/**
 * Renders one matching line preview as a bounded, match-centred excerpt.
 *
 * The excerpt is cut around the match rather than at the head of the line.
 * `matchRange` carries a match the caller already located — which is how a
 * regex match arrives, since only PostgreSQL may run one — and otherwise the
 * pattern locates its own. A match that neither can place still renders,
 * anchored at the start of the preview.
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
  /**
   * A regex match has no length limit — `abc.*` matches to the end of the line —
   * so the match alone can exceed the budget. Clipping it here, against a budget
   * that already reserves the closing marker, is what keeps the excerpt honest:
   * letting the final cap do it would drop that marker along with the text and
   * leave a truncated line looking complete.
   */
  const budgetBeforeMatch = Math.max(0, maxBytes - Buffer.byteLength(`${leadingEllipsis}…`, 'utf8'))
  const fullMatch = line.slice(matchStart, matchEnd)
  const match = utf8PrefixWithinBudget(fullMatch, budgetBeforeMatch)
  const matchClipped = match.length < fullMatch.length
  const trailingEllipsis =
    matchClipped || boundaries.suffixOmitted || matchEnd < line.length ? '…' : ''
  const ellipsisBytes = Buffer.byteLength(leadingEllipsis + trailingEllipsis, 'utf8')
  const matchBytes = Buffer.byteLength(match, 'utf8')
  const surroundingBudget = Math.max(0, maxBytes - ellipsisBytes - matchBytes)
  const beforeBudget = Math.floor(surroundingBudget / 2)
  const afterBudget = surroundingBudget - beforeBudget
  const before = utf8SuffixWithinBudget(line.slice(0, matchStart), beforeBudget)
  const after = utf8PrefixWithinBudget(line.slice(matchEnd), afterBudget)
  const preview = `${boundaries.prefixOmitted || before.length < matchStart ? '…' : ''}${
    before
  }${match}${after}${
    matchClipped || boundaries.suffixOmitted || matchEnd + after.length < line.length ? '…' : ''
  }`
  return utf8PrefixWithinBudget(preview, maxBytes)
}
