import {
  FOLDER_CONFIGS,
  type MentionFolderId,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/constants'
import type { MentionDataReturn } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-mention-data'
import type { ChatContext } from '@/stores/panel'

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
