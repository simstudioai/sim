import { z } from 'zod'
import {
  mothershipResourceSchema,
  mothershipTableViewContextSchema,
} from '@/lib/api/contracts/mothership-resources'
import { MAX_CHAT_CONTEXT_LABEL_LENGTH } from '@/lib/mothership/chat/context-limits'
import {
  CHAT_SELECTION_SOURCE_TITLE_MAX_LENGTH,
  MAX_FILE_SELECTION_TEXT_LENGTH,
  MAX_TABLE_SELECTION_COLUMNS,
  MAX_TABLE_SELECTION_ROWS,
  safeBrowserSelectionUrl,
} from '@/lib/mothership/chat/selection-context'
import { FileOperationOwner } from '@/lib/mothership/generated/file-owner'

const CHAT_SELECTION_TEXT_MAX_LENGTH = 100_000
const CHAT_SELECTION_SOURCE_URL_MAX_LENGTH = 8_192
const TERMINAL_SELECTION_LINE_MAX = 10_000_000

/** Non-strings pass through for the schema to reject; strings are sanitized. */
function sanitizeBrowserSelectionUrl(value: unknown): unknown {
  return typeof value === 'string' ? safeBrowserSelectionUrl(value) : value
}

const BrowserTextSelectionSchema = z
  .object({
    text: z.string().min(1).max(CHAT_SELECTION_TEXT_MAX_LENGTH),
    url: z.preprocess(
      sanitizeBrowserSelectionUrl,
      z.string().max(CHAT_SELECTION_SOURCE_URL_MAX_LENGTH).optional()
    ),
    title: z.string().max(CHAT_SELECTION_SOURCE_TITLE_MAX_LENGTH).optional(),
  })
  .strict()
  .transform(({ text, title, url }) => ({
    text,
    ...(url ? { url } : {}),
    ...(title ? { title } : {}),
  }))

const TerminalTextSelectionSchema = z
  .object({
    text: z.string().min(1).max(CHAT_SELECTION_TEXT_MAX_LENGTH),
    startLine: z.number().int().positive().max(TERMINAL_SELECTION_LINE_MAX),
    endLine: z.number().int().positive().max(TERMINAL_SELECTION_LINE_MAX),
  })
  .strict()
  .refine(({ startLine, endLine }) => endLine >= startLine, {
    message: 'endLine must be greater than or equal to startLine',
    path: ['endLine'],
  })

export const chatContextSchema = z
  .object({
    kind: z.enum([
      'past_chat',
      'workflow',
      'current_workflow',
      'blocks',
      'logs',
      'workflow_block',
      'knowledge',
      'docs',
      'table',
      'table_selection',
      'file',
      'file_selection',
      'dashboard',
      'folder',
      'filefolder',
      'integration',
      'skill',
      'mcp',
      'browser_tab',
      'terminal_tab',
      'workspace',
      'project',
    ]),
    label: z.string().max(MAX_CHAT_CONTEXT_LABEL_LENGTH),
    chatId: z.string().optional(),
    workflowId: z.string().optional(),
    knowledgeId: z.string().optional(),
    blockId: z.string().optional(),
    blockIds: z.array(z.string()).optional(),
    blockType: z.string().min(1).max(200).optional(),
    executionId: z.string().optional(),
    tableId: z.string().optional(),
    viewId: mothershipResourceSchema.shape.viewId,
    currentView: mothershipTableViewContextSchema.optional(),
    fileId: z.string().optional(),
    owner: FileOperationOwner.optional(),
    dashboardId: z.string().optional(),
    folderId: z.string().optional(),
    fileFolderId: z.string().optional(),
    skillId: z.string().optional(),
    workspaceId: z.string().min(1).max(200).optional(),
    projectId: z.string().min(1).max(200).optional(),
    serverId: z.string().optional(),
    scheduleId: z.string().optional(),
    tabId: z.string().optional(),
    terminalId: z.string().optional(),
    text: z.string().max(MAX_FILE_SELECTION_TEXT_LENGTH).optional(),
    fileName: z.string().optional(),
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
    tableName: z.string().optional(),
    rowIds: z.array(z.string()).max(MAX_TABLE_SELECTION_ROWS).optional(),
    columnIds: z.array(z.string()).max(MAX_TABLE_SELECTION_COLUMNS).optional(),
    selection: z.union([BrowserTextSelectionSchema, TerminalTextSelectionSchema]).optional(),
  })
  .superRefine(({ kind, selection, workspaceId, projectId, owner }, refinementContext) => {
    if (
      (kind === 'project' && (!projectId || workspaceId !== undefined)) ||
      (kind !== 'project' && projectId !== undefined)
    ) {
      refinementContext.addIssue({
        code: 'custom',
        path: ['projectId'],
        message: 'A Project context requires only a Project target',
      })
    }
    if (
      owner &&
      ((kind !== 'file' && kind !== 'file_selection') ||
        (owner.entityType !== 'workspace' && workspaceId) ||
        (owner.entityType === 'workspace' && workspaceId && owner.entityId !== workspaceId))
    )
      refinementContext.addIssue({
        code: 'custom',
        path: ['owner'],
        message: 'File owner conflicts with the context target',
      })
    if (kind === 'workspace' && !workspaceId) {
      refinementContext.addIssue({
        code: 'custom',
        message: 'workspaceId is required for a workspace context',
        path: ['workspaceId'],
      })
    }
    if (!selection) return
    const isTerminalSelection = 'startLine' in selection
    const selectionMatchesKind =
      (kind === 'browser_tab' && !isTerminalSelection) ||
      (kind === 'terminal_tab' && isTerminalSelection)
    if (!selectionMatchesKind) {
      refinementContext.addIssue({
        code: 'custom',
        message: 'selection must match its browser_tab or terminal_tab context kind',
        path: ['selection'],
      })
    }
  })
