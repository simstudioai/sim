import type { ReactNode } from 'react'
import {
  FOLDER_CONFIGS,
  type MentionFolderId,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/constants'
import type { MentionDataReturn } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-mention-data'
import type { ChatContext } from '@/stores/panel'

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
      const prefix = c.kind === 'slash_command' ? '/' : '@'
      return `${prefix}${c.label}`
    })
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

  const pattern = new RegExp(`(${tokens.map(escapeRegex).join('|')})`, 'g')
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
 * Builds React nodes with highlighted mention tokens
 * @param text - Text to render
 * @param contexts - Chat contexts to highlight
 * @param createHighlightSpan - Function to create highlighted span element
 * @returns Array of React nodes with highlighted mentions
 */
export function buildMentionHighlightNodes(
  text: string,
  contexts: ChatContext[],
  createHighlightSpan: (token: string, key: string) => ReactNode
): ReactNode[] {
  const tokens = extractContextTokens(contexts)
  if (!tokens.length) return [text]

  const ranges = computeMentionHighlightRanges(text, tokens)
  if (!ranges.length) return [text]

  const nodes: ReactNode[] = []
  let lastIndex = 0

  for (const range of ranges) {
    if (range.start > lastIndex) {
      nodes.push(text.slice(lastIndex, range.start))
    }
    nodes.push(createHighlightSpan(range.token, `mention-${range.start}-${range.end}`))
    lastIndex = range.end
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return nodes
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
 * Gets the loading state for a folder ID from mentionData.
 * Uses FOLDER_CONFIGS as the source of truth for key mapping.
 */
export function getFolderLoading(
  mentionData: MentionDataReturn,
  folderId: MentionFolderId
): boolean {
  const config = FOLDER_CONFIGS[folderId]
  return mentionData[config.loadingKey as keyof MentionDataReturn] as boolean
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
type TemplatesContext = Extract<ChatContext, { kind: 'templates' }>
type LogsContext = Extract<ChatContext, { kind: 'logs' }>
type SlashCommandContext = Extract<ChatContext, { kind: 'slash_command' }>

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
    case 'templates': {
      const ctx = context as TemplatesContext
      return c.templateId === ctx.templateId
    }
    case 'logs': {
      const ctx = context as LogsContext
      return c.executionId === ctx.executionId
    }
    case 'docs':
      return true // Only one docs context allowed
    case 'slash_command': {
      const ctx = context as SlashCommandContext
      return c.command === ctx.command
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
