import {
  FOLDER_CONFIGS,
  type MentionFolderId,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/constants'
import type { MentionDataReturn } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-mention-data'
import type { ChatContext } from '@/stores/panel'

/**
 * Wide fixed-advance glyph used as the stored trigger for skill chips so the
 * centered icon fits its slot exactly like '@' does (a narrow '/' is too thin).
 * The user still TYPES '/'; this replaces it on confirm. EM SPACE has a ~1em
 * advance, closely matching the 12px chip icon.
 */
export const SKILL_CHIP_TRIGGER = '\u2003'

/**
 * Converts the stored EM SPACE skill trigger back to a literal '/' for any
 * plain-text surface that leaves the editor — the submitted message and the
 * clipboard — so skills read as `/skill-name` exactly as they did before the
 * sentinel existed. Skills themselves travel via contexts, so this is purely
 * cosmetic for the text.
 */
export function restoreSkillTriggerText(text: string): string {
  return text.replaceAll(SKILL_CHIP_TRIGGER, '/')
}

/**
 * Escapes special regex characters in a string
 * @param value - String to escape
 * @returns Escaped string safe for use in RegExp
 */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Extracts mention tokens from contexts for display/matching
 * Filters out current_workflow contexts and builds prefixed labels
 * @param contexts - Array of chat contexts
 * @returns Array of prefixed token strings (e.g., "@workflow", "/web")
 */
export function extractContextTokens(contexts: ChatContext[]): string[] {
  return contexts
    .filter((c) => c.kind !== 'current_workflow' && c.label)
    .map((c) => {
      const prefix =
        c.kind === 'skill' || c.kind === 'mcp'
          ? SKILL_CHIP_TRIGGER
          : c.kind === 'slash_command'
            ? '/'
            : '@'
      return `${prefix}${c.label}`
    })
}

/**
 * Returns only contexts whose exact inline token still exists in the current
 * message. This is shared by the reactive cleanup effect and the synchronous
 * submit path so deleting a chip immediately excludes its structured context.
 */
export function filterContextsPresentInMessage(
  contexts: ChatContext[],
  message: string
): ChatContext[] {
  if (contexts.length === 0) return contexts
  if (!message) return []

  const tokens = contexts.map((context) => extractContextTokens([context])[0] ?? '')
  const presentTokens = new Set(
    computeMentionHighlightRanges(message, tokens.filter(Boolean)).map((range) => range.token)
  )
  const filtered = contexts.filter((_context, index) => presentTokens.has(tokens[index]))

  return filtered.length === contexts.length ? contexts : filtered
}

/**
 * Inverse of {@link extractContextTokens}'s prefixing: strips a leading mention
 * trigger (`@`, `/`, or the skill EM-SPACE sentinel) from a token, yielding the
 * bare context label. Kept beside `extractContextTokens` so the set of trigger
 * glyphs lives in exactly one place.
 */
export function stripMentionTrigger(token: string): string {
  const first = token.charAt(0)
  return first === '@' || first === '/' || first === SKILL_CHIP_TRIGGER ? token.slice(1) : token
}

/**
 * Mention range for text highlighting
 */
export interface MentionHighlightRange {
  start: number
  end: number
  token: string
}

/**
 * Computes mention ranges in text for highlighting
 * @param text - Text to search
 * @param tokens - Prefixed tokens to find (e.g., "@workflow", "/web")
 * @returns Array of ranges with start, end, and matched token
 */
export function computeMentionHighlightRanges(
  text: string,
  tokens: string[]
): MentionHighlightRange[] {
  if (!tokens.length || !text) return []

  const longestFirstTokens = [...new Set(tokens)].sort((a, b) => b.length - a.length)
  const pattern = new RegExp(`(${longestFirstTokens.map(escapeRegex).join('|')})`, 'g')
  const ranges: MentionHighlightRange[] = []
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    ranges.push({
      start: match.index,
      end: match.index + match[0].length,
      token: match[0],
    })
  }

  return ranges
}

/**
 * Gets the data array for a folder ID from mentionData.
 * Uses FOLDER_CONFIGS as the source of truth for key mapping.
 * Returns any[] since item types vary by folder and are used with dynamic config.filterFn
 */
export function getFolderData(mentionData: MentionDataReturn, folderId: MentionFolderId): any[] {
  const config = FOLDER_CONFIGS[folderId]
  return (mentionData[config.dataKey as keyof MentionDataReturn] as any[]) || []
}

/**
 * Gets the ensure loaded function for a folder ID from mentionData.
 * Uses FOLDER_CONFIGS as the source of truth for key mapping.
 */
export function getFolderEnsureLoaded(
  mentionData: MentionDataReturn,
  folderId: MentionFolderId
): (() => Promise<void>) | undefined {
  const config = FOLDER_CONFIGS[folderId]
  if (!config.ensureLoadedKey) return undefined
  return mentionData[config.ensureLoadedKey as keyof MentionDataReturn] as
    | (() => Promise<void>)
    | undefined
}

/**
 * Extract specific ChatContext types for type-safe narrowing
 */
type PastChatContext = Extract<ChatContext, { kind: 'past_chat' }>
type WorkflowContext = Extract<ChatContext, { kind: 'workflow' }>
type CurrentWorkflowContext = Extract<ChatContext, { kind: 'current_workflow' }>
type BlocksContext = Extract<ChatContext, { kind: 'blocks' }>
type WorkflowBlockContext = Extract<ChatContext, { kind: 'workflow_block' }>
type KnowledgeContext = Extract<ChatContext, { kind: 'knowledge' }>
type TableContext = Extract<ChatContext, { kind: 'table' }>
type FileContext = Extract<ChatContext, { kind: 'file' }>
type LogsContext = Extract<ChatContext, { kind: 'logs' }>
type IntegrationContext = Extract<ChatContext, { kind: 'integration' }>
type SlashCommandContext = Extract<ChatContext, { kind: 'slash_command' }>
type SkillContext = Extract<ChatContext, { kind: 'skill' }>
type McpContext = Extract<ChatContext, { kind: 'mcp' }>
type FileSelectionContext = Extract<ChatContext, { kind: 'file_selection' }>
type TableSelectionContext = Extract<ChatContext, { kind: 'table_selection' }>

/**
 * Set equality for two optional id lists.
 *
 * Deliberately order-insensitive: a table selection's row ids come from a Set
 * whose iteration order follows click order, and the same rows picked in a
 * different order — or via a cell range rather than the gutter — are the same
 * selection. Comparing by index would call those distinct and add a duplicate
 * ordinalized chip pointing at rows already referenced.
 */
function sameIds(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  const inA = new Set(a)
  return b.every((id) => inA.has(id))
}

/**
 * Checks if two contexts of the same kind are equal by their ID fields.
 * Assumes c.kind === context.kind (must be checked before calling).
 */
export function areContextsEqual(c: ChatContext, context: ChatContext): boolean {
  switch (c.kind) {
    case 'past_chat': {
      const ctx = context as PastChatContext
      return c.chatId === ctx.chatId
    }
    case 'workflow': {
      const ctx = context as WorkflowContext
      return c.workflowId === ctx.workflowId
    }
    case 'current_workflow': {
      const ctx = context as CurrentWorkflowContext
      return c.workflowId === ctx.workflowId
    }
    case 'blocks': {
      const ctx = context as BlocksContext
      const existingIds = c.blockIds || []
      const newIds = ctx.blockIds || []
      return existingIds.some((id) => newIds.includes(id))
    }
    case 'workflow_block': {
      const ctx = context as WorkflowBlockContext
      return c.workflowId === ctx.workflowId && c.blockId === ctx.blockId
    }
    case 'knowledge': {
      const ctx = context as KnowledgeContext
      return c.knowledgeId === ctx.knowledgeId
    }
    case 'table': {
      const ctx = context as TableContext
      return c.tableId === ctx.tableId
    }
    case 'file': {
      const ctx = context as FileContext
      return c.fileId === ctx.fileId
    }
    case 'folder':
      return context.kind === 'folder' && c.folderId === context.folderId
    case 'filefolder':
      return context.kind === 'filefolder' && c.fileFolderId === context.fileFolderId
    // Selection kinds scope to part of a resource, so equality is the selected
    // range — not the file/table — or re-selecting a different passage of an
    // already-referenced file would be swallowed as a duplicate.
    case 'file_selection': {
      const ctx = context as FileSelectionContext
      // Location too, not just the text: the same line can occur twice in a file
      // (a repeated import, a closing brace), and comparing text alone would
      // treat the second highlight as a duplicate and drop its chip. Where the
      // source has no line numbers — the rich-markdown editor — both are
      // undefined and identical text is genuinely indistinguishable, so it
      // correctly still dedupes.
      return (
        c.fileId === ctx.fileId &&
        c.text === ctx.text &&
        c.startLine === ctx.startLine &&
        c.endLine === ctx.endLine
      )
    }
    case 'table_selection': {
      const ctx = context as TableSelectionContext
      return (
        c.tableId === ctx.tableId &&
        sameIds(c.rowIds, ctx.rowIds) &&
        sameIds(c.columnIds, ctx.columnIds)
      )
    }
    case 'logs': {
      const ctx = context as LogsContext
      return c.executionId === ctx.executionId
    }
    case 'integration': {
      const ctx = context as IntegrationContext
      return c.blockType === ctx.blockType
    }
    case 'docs':
      return true // Only one docs context allowed
    case 'slash_command': {
      const ctx = context as SlashCommandContext
      return c.command === ctx.command
    }
    case 'skill': {
      const ctx = context as SkillContext
      return c.skillId === ctx.skillId
    }
    case 'mcp': {
      const ctx = context as McpContext
      return c.serverId === ctx.serverId
    }
    default:
      return false
  }
}

/**
 * Removes a context from a list, returning a new filtered list.
 */
export function filterOutContext(
  contexts: ChatContext[],
  contextToRemove: ChatContext
): ChatContext[] {
  return contexts.filter((c) => {
    if (c.kind !== contextToRemove.kind) return true
    return !areContextsEqual(c, contextToRemove)
  })
}

/**
 * Checks if a context already exists in selected contexts.
 *
 * The token system uses @label format, so we cannot have duplicate labels
 * regardless of kind or ID differences.
 *
 * @param context - Context to check
 * @param selectedContexts - Currently selected contexts
 * @returns True if context already exists or label is already used
 */
export function isContextAlreadySelected(
  context: ChatContext,
  selectedContexts: ChatContext[]
): boolean {
  return selectedContexts.some((c) => {
    // CRITICAL: Check label collision FIRST
    // The token system uses @label format, so we cannot have duplicate labels
    // regardless of kind or ID differences
    if (c.label && context.label && c.label === context.label) {
      return true
    }

    // Secondary check: exact duplicate by ID fields
    if (c.kind !== context.kind) return false

    return areContextsEqual(c, context)
  })
}

/**
 * Returns `label`, or the first free `label (n)` variant when it is already
 * taken. Two genuinely different selections can legitimately describe
 * themselves the same way — two 3-row picks from one table both read
 * `Sales (3 rows)` — but the token system keys chips by their `@label`, so a
 * collision would silently drop the second context. The ordinal keeps both
 * chips alive and stays readable in the input, unlike an opaque hash.
 *
 * Also used by folder menu picks, where separate resource families or parent
 * folders may contain folders with the same name.
 */
export function uniqueContextLabel(label: string, selectedContexts: ChatContext[]): string {
  const taken = new Set(selectedContexts.map((c) => c.label))
  if (!taken.has(label)) return label
  for (let n = 2; ; n++) {
    const candidate = `${label} (${n})`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * Insert policy for a context pushed into the input programmatically — the
 * highlight-to-chat action and the selection paste, neither of which goes
 * through a typed `@`/`/` trigger.
 *
 * @returns `null` when the exact context is already attached (re-adding the same
 * selection is a no-op), otherwise the context carrying a collision-free label.
 */
export function prepareContextForInsert(
  context: ChatContext,
  selectedContexts: ChatContext[]
): ChatContext | null {
  const isDuplicate = selectedContexts.some(
    (c) => c.kind === context.kind && areContextsEqual(c, context)
  )
  if (isDuplicate) return null
  return { ...context, label: uniqueContextLabel(context.label, selectedContexts) }
}
