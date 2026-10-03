import { escapeRegExp } from '@sim/utils/string'
import type { ChatMessageContext } from '@/app/workspace/[workspaceId]/home/types'
import { getIntegrationMatcher } from '@/blocks/integration-matcher'

interface MentionRange {
  start: number
  end: number
  context: ChatMessageContext
}

/**
 * Backfills a renderable `blockType` onto integration contexts that are
 * missing one (or carry one the registry no longer knows) by resolving the
 * label through the integration matcher. Messages persisted before
 * `blockType` was included in the save mapping would otherwise render a
 * mention pill with no icon.
 */
function withResolvedBlockType(ctx: ChatMessageContext): ChatMessageContext {
  if (ctx.kind !== 'integration' || !ctx.label) return ctx
  const info = getIntegrationMatcher().byName.get(ctx.label.toLowerCase())
  if (!info) return ctx
  return { ...ctx, blockType: info.blockType }
}

export function computeMentionRanges(text: string, contexts: ChatMessageContext[]): MentionRange[] {
  const ranges: MentionRange[] = []

  for (const rawCtx of contexts) {
    if (!rawCtx.label) continue
    const ctx = withResolvedBlockType(rawCtx)
    const prefix =
      ctx.kind === 'skill' || ctx.kind === 'mcp' || ctx.kind === 'slash_command' ? '/' : '@'
    const token = `${prefix}${ctx.label}`
    const pattern = new RegExp(
      `(^|\\s)(${escapeRegExp(token)})(?=[\\s,;:!?)\\]]|\\.(?![\\w-])|$)`,
      'g'
    )
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      const leadingSpace = match[1]
      const tokenStart = match.index + leadingSpace.length
      const tokenEnd = tokenStart + token.length
      ranges.push({ start: tokenStart, end: tokenEnd, context: ctx })
    }
  }

  for (const range of computeIntegrationRanges(text, ranges)) {
    ranges.push(range)
  }

  ranges.sort((a, b) => a.start - b.start || b.end - a.end)
  const merged: MentionRange[] = []
  for (const range of ranges) {
    if (range.start >= (merged[merged.length - 1]?.end ?? 0)) merged.push(range)
  }
  return merged
}

/**
 * Scans the raw text for explicit, token-starting `@IntegrationName` mentions
 * (any casing) and decorates them even when no matching context was stored —
 * e.g. a message submitted before the input's auto-mention pass ran, or one
 * authored outside the chat input. Ranges already claimed by stored contexts
 * are skipped so the two sources never double-decorate.
 */
function computeIntegrationRanges(text: string, taken: MentionRange[]): MentionRange[] {
  const { regex, byName } = getIntegrationMatcher()
  if (!regex || !text) return []

  regex.lastIndex = 0
  const ranges: MentionRange[] = []
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    const atIndex = match.index - 1
    if (atIndex < 0 || text[atIndex] !== '@') continue
    if (atIndex > 0 && !/\s/.test(text[atIndex - 1])) continue
    const info = byName.get(match[0].toLowerCase())
    if (!info) continue
    const start = atIndex
    const end = match.index + match[0].length
    if (taken.some((r) => start < r.end && end > r.start)) continue
    ranges.push({
      start,
      end,
      context: { kind: 'integration', blockType: info.blockType, label: info.name },
    })
  }

  return ranges
}

/** Returns the labels and prose rendered by a user message, without mention prefixes. */
export function getUserMessageText(content: string, contexts: ChatMessageContext[] = []): string {
  const ranges = computeMentionRanges(content, contexts)
  if (!ranges.length) return content.trim()
  let text = ''
  let end = 0
  for (const range of ranges) {
    text += content.slice(end, range.start) + (range.context.label ?? '')
    end = range.end
  }
  return text + content.slice(end)
}
