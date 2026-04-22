import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { useQueryClient } from '@tanstack/react-query'
import { usePathname, useRouter } from 'next/navigation'
import { toDisplayMessage } from '@/lib/copilot/chat/display-message'
import { getLiveAssistantMessageId } from '@/lib/copilot/chat/effective-transcript'
import type {
  PersistedFileAttachment,
  PersistedMessage,
} from '@/lib/copilot/chat/persisted-message'
import { normalizeMessage } from '@/lib/copilot/chat/persisted-message'
import { resolveStreamToolOutcome } from '@/lib/copilot/chat/stream-tool-outcome'
import { MOTHERSHIP_CHAT_API_PATH, STREAM_STORAGE_KEY } from '@/lib/copilot/constants'
import type {
  MothershipStreamV1ErrorPayload,
  MothershipStreamV1ToolUI,
} from '@/lib/copilot/generated/mothership-stream-v1'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
  MothershipStreamV1ResourceOp,
  MothershipStreamV1RunKind,
  MothershipStreamV1SessionKind,
  MothershipStreamV1SpanLifecycleEvent,
  MothershipStreamV1SpanPayloadKind,
  MothershipStreamV1ToolOutcome,
  MothershipStreamV1ToolPhase,
  MothershipStreamV1ToolStatus,
} from '@/lib/copilot/generated/mothership-stream-v1'
import {
  CrawlWebsite,
  CreateFolder,
  DeleteFolder,
  DeleteWorkflow,
  DeployApi,
  DeployChat,
  DeployMcp,
  GetPageContents,
  GetWorkflowLogs,
  Glob,
  Grep,
  ManageCredential,
  ManageCredentialOperation,
  ManageCustomTool,
  ManageCustomToolOperation,
  ManageJob,
  ManageJobOperation,
  ManageMcpTool,
  ManageMcpToolOperation,
  ManageSkill,
  ManageSkillOperation,
  MoveFolder,
  MoveWorkflow,
  Read as ReadTool,
  Redeploy,
  RenameWorkflow,
  RunFromBlock,
  RunWorkflow,
  RunWorkflowUntilBlock,
  ScrapePage,
  SearchOnline,
  ToolSearchToolRegex,
  WorkspaceFile,
  WorkspaceFileOperation,
} from '@/lib/copilot/generated/tool-catalog-v1'
import {
  type ParseStreamEventEnvelopeFailure,
  parsePersistedStreamEventEnvelope,
  parsePersistedStreamEventEnvelopeJson,
} from '@/lib/copilot/request/session/contract'
import {
  type FilePreviewSession,
  isFilePreviewSession,
} from '@/lib/copilot/request/session/file-preview-session-contract'
import type { StreamBatchEvent } from '@/lib/copilot/request/session/types'
import {
  extractResourcesFromToolResult,
  isResourceToolName,
} from '@/lib/copilot/resources/extraction'
import { VFS_DIR_TO_RESOURCE } from '@/lib/copilot/resources/types'
import { isToolHiddenInUi } from '@/lib/copilot/tools/client/hidden-tools'
import {
  bindRunToolToExecution,
  cancelRunToolExecution,
  executeRunToolOnClient,
  markRunToolManuallyStopped,
  reportManualRunToolStop,
} from '@/lib/copilot/tools/client/run-tool-execution'
import { setCurrentChatTraceparent } from '@/lib/copilot/tools/client/trace-context'
import { isWorkflowToolName } from '@/lib/copilot/tools/workflow-tools'
import { getNextWorkflowColor } from '@/lib/workflows/colors'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { invalidateResourceQueries } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import {
  buildCompletedPreviewSessions,
  type FilePreviewSessionsState,
  INITIAL_FILE_PREVIEW_SESSIONS_STATE,
  reduceFilePreviewSessions,
  useFilePreviewSessions,
} from '@/app/workspace/[workspaceId]/home/hooks/use-file-preview-sessions'
import { deploymentKeys } from '@/hooks/queries/deployments'
import {
  fetchChatHistory,
  type TaskChatHistory,
  taskKeys,
  useChatHistory,
} from '@/hooks/queries/tasks'
import { getFolderMap } from '@/hooks/queries/utils/folder-cache'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import { invalidateWorkflowSelectors } from '@/hooks/queries/utils/invalidate-workflow-lists'
import { getTopInsertionSortOrder } from '@/hooks/queries/utils/top-insertion-sort-order'
import { getWorkflowById, getWorkflows } from '@/hooks/queries/utils/workflow-cache'
import { workflowKeys } from '@/hooks/queries/workflows'
import { workspaceFilesKeys } from '@/hooks/queries/workspace-files'
import { useExecutionStream } from '@/hooks/use-execution-stream'
import { useExecutionStore } from '@/stores/execution/store'
import type { ChatContext } from '@/stores/panel'
import { useTerminalConsoleStore } from '@/stores/terminal'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type {
  ChatMessage,
  ContentBlock,
  FileAttachmentForApi,
  GenericResourceData,
  MothershipResource,
  MothershipResourceType,
  QueuedMessage,
} from '../types'
import { ToolCallStatus } from '../types'

const FILE_SUBAGENT_ID = 'file'

export interface UseChatReturn {
  messages: ChatMessage[]
  isSending: boolean
  isReconnecting: boolean
  error: string | null
  resolvedChatId: string | undefined
  sendMessage: (
    message: string,
    fileAttachments?: FileAttachmentForApi[],
    contexts?: ChatContext[]
  ) => Promise<void>
  stopGeneration: () => Promise<void>
  resources: MothershipResource[]
  activeResourceId: string | null
  setActiveResourceId: (id: string | null) => void
  addResource: (resource: MothershipResource) => boolean
  removeResource: (resourceType: MothershipResourceType, resourceId: string) => void
  reorderResources: (resources: MothershipResource[]) => void
  messageQueue: QueuedMessage[]
  removeFromQueue: (id: string) => void
  sendNow: (id: string) => Promise<void>
  editQueuedMessage: (id: string) => QueuedMessage | undefined
  previewSession: FilePreviewSession | null
  genericResourceData: GenericResourceData | null
}

const DEPLOY_TOOL_NAMES: Set<string> = new Set([
  DeployApi.id,
  DeployChat.id,
  DeployMcp.id,
  Redeploy.id,
])

const FOLDER_TOOL_NAMES: Set<string> = new Set([CreateFolder.id, DeleteFolder.id, MoveFolder.id])

const WORKFLOW_MUTATION_TOOL_NAMES: Set<string> = new Set([
  MoveWorkflow.id,
  RenameWorkflow.id,
  DeleteWorkflow.id,
])
const RECONNECT_TAIL_ERROR =
  'Live reconnect failed before the stream finished. The latest response may be incomplete.'
const MAX_RECONNECT_ATTEMPTS = 10
const RECONNECT_BASE_DELAY_MS = 1000
const RECONNECT_MAX_DELAY_MS = 30_000
const QUEUED_SEND_HANDOFF_STORAGE_KEY = `${STREAM_STORAGE_KEY}:queued-send-handoff`
const QUEUED_SEND_HANDOFF_CLAIM_STORAGE_KEY = `${STREAM_STORAGE_KEY}:queued-send-handoff-claim`

const logger = createLogger('useChat')

type StreamPayload = Record<string, unknown>

type QueueDispatchAction = { type: 'send_head'; epoch: number }

type QueueDispatchActionInput = { type: 'send_head' }

type ActiveTurn = {
  userMessageId: string
  assistantMessageId: string
  optimisticUserMessage: ChatMessage
  optimisticAssistantMessage: ChatMessage
}

interface QueuedSendHandoffState {
  id: string
  chatId: string
  workspaceId: string
  supersededStreamId: string | null
  userMessageId: string
  message: string
  fileAttachments?: FileAttachmentForApi[]
  contexts?: ChatContext[]
  requestedAt: number
}

interface QueuedSendHandoffSeed {
  id: string
  chatId: string
  supersededStreamId: string | null
  userMessageId?: string
}

function readQueuedSendHandoffState(): QueuedSendHandoffState | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.sessionStorage.getItem(QUEUED_SEND_HANDOFF_STORAGE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as Partial<QueuedSendHandoffState>
    if (
      typeof parsed?.id !== 'string' ||
      typeof parsed.chatId !== 'string' ||
      typeof parsed.workspaceId !== 'string' ||
      typeof parsed.userMessageId !== 'string' ||
      typeof parsed.message !== 'string' ||
      typeof parsed.requestedAt !== 'number'
    ) {
      return null
    }

    return {
      id: parsed.id,
      chatId: parsed.chatId,
      workspaceId: parsed.workspaceId,
      supersededStreamId:
        typeof parsed.supersededStreamId === 'string' ? parsed.supersededStreamId : null,
      userMessageId: parsed.userMessageId,
      message: parsed.message,
      ...(Array.isArray(parsed.fileAttachments)
        ? { fileAttachments: parsed.fileAttachments as FileAttachmentForApi[] }
        : {}),
      ...(Array.isArray(parsed.contexts) ? { contexts: parsed.contexts as ChatContext[] } : {}),
      requestedAt: parsed.requestedAt,
    }
  } catch {
    return null
  }
}

function writeQueuedSendHandoffState(state: QueuedSendHandoffState) {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(QUEUED_SEND_HANDOFF_STORAGE_KEY, JSON.stringify(state))
}

function clearQueuedSendHandoffState(expectedId?: string) {
  if (typeof window === 'undefined') return
  if (expectedId) {
    const current = readQueuedSendHandoffState()
    if (current && current.id !== expectedId) {
      return
    }
  }
  window.sessionStorage.removeItem(QUEUED_SEND_HANDOFF_STORAGE_KEY)
}

function readQueuedSendHandoffClaim(): string | null {
  if (typeof window === 'undefined') return null
  return window.sessionStorage.getItem(QUEUED_SEND_HANDOFF_CLAIM_STORAGE_KEY)
}

function writeQueuedSendHandoffClaim(id: string) {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(QUEUED_SEND_HANDOFF_CLAIM_STORAGE_KEY, id)
}

function clearQueuedSendHandoffClaim(expectedId?: string) {
  if (typeof window === 'undefined') return
  if (expectedId) {
    const current = readQueuedSendHandoffClaim()
    if (current && current !== expectedId) {
      return
    }
  }
  window.sessionStorage.removeItem(QUEUED_SEND_HANDOFF_CLAIM_STORAGE_KEY)
}

function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function stringArrayParam(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function resolveWorkflowNameForDisplay(workflowId: unknown): string | undefined {
  const id = stringParam(workflowId)
  if (!id) return undefined
  const workspaceId = useWorkflowRegistry.getState().hydration.workspaceId
  if (!workspaceId) return undefined
  return getWorkflowById(workspaceId, id)?.name
}

function resolveBlockNameForDisplay(blockId: unknown): string | undefined {
  const id = stringParam(blockId)
  if (!id) return undefined
  return useWorkflowStore.getState().blocks[id]?.name
}

function resolveWorkspaceFileDisplayTitle(
  operation: unknown,
  title: unknown,
  targetFileName?: unknown
): string | undefined {
  const chunkTitle = stringParam(title)
  const fileName = stringParam(targetFileName)
  let verb = 'Writing'

  switch (operation) {
    case WorkspaceFileOperation.append:
      verb = 'Adding'
      break
    case WorkspaceFileOperation.patch:
      verb = 'Editing'
      break
    case WorkspaceFileOperation.update:
      verb = 'Writing'
      break
  }

  if (chunkTitle) return `${verb} ${chunkTitle}`
  if (fileName) return `${verb} ${fileName}`
  return undefined
}

function resolveOperationDisplayTitle(
  operation: unknown,
  labels: Partial<Record<string, string>>,
  fallback: string
): string {
  const label = typeof operation === 'string' ? labels[operation] : undefined
  return label ?? fallback
}

function resolveToolDisplayTitle(name: string, args?: Record<string, unknown>): string | undefined {
  if (!args) return undefined

  if (name === WorkspaceFile.id) {
    const target = asPayloadRecord(args.target)
    return resolveWorkspaceFileDisplayTitle(args.operation, args.title, target?.fileName)
  }

  if (name === SearchOnline.id) {
    const toolTitle = stringParam(args.toolTitle)
    return toolTitle ? `Searching online for ${toolTitle}` : 'Searching online'
  }

  if (name === Grep.id) {
    const toolTitle = stringParam(args.toolTitle)
    return toolTitle ? `Searching for ${toolTitle}` : 'Searching'
  }

  if (name === Glob.id) {
    const toolTitle = stringParam(args.toolTitle)
    return toolTitle ? `Finding ${toolTitle}` : 'Finding files'
  }

  if (name === ScrapePage.id) {
    const url = stringParam(args.url)
    return url ? `Scraping ${url}` : 'Scraping page'
  }

  if (name === CrawlWebsite.id) {
    const url = stringParam(args.url)
    return url ? `Crawling ${url}` : 'Crawling website'
  }

  if (name === GetPageContents.id) {
    const urls = stringArrayParam(args.urls)
    if (urls.length === 1) return `Getting ${urls[0]}`
    if (urls.length > 1) return `Getting ${urls.length} pages`
    return 'Getting page contents'
  }

  if (name === ManageCustomTool.id) {
    return resolveOperationDisplayTitle(
      args.operation,
      {
        [ManageCustomToolOperation.add]: 'Creating custom tool',
        [ManageCustomToolOperation.edit]: 'Updating custom tool',
        [ManageCustomToolOperation.delete]: 'Deleting custom tool',
        [ManageCustomToolOperation.list]: 'Listing custom tools',
      },
      'Custom tool action'
    )
  }

  if (name === ManageMcpTool.id) {
    return resolveOperationDisplayTitle(
      args.operation,
      {
        [ManageMcpToolOperation.add]: 'Creating MCP server',
        [ManageMcpToolOperation.edit]: 'Updating MCP server',
        [ManageMcpToolOperation.delete]: 'Deleting MCP server',
        [ManageMcpToolOperation.list]: 'Listing MCP servers',
      },
      'MCP server action'
    )
  }

  if (name === ManageSkill.id) {
    return resolveOperationDisplayTitle(
      args.operation,
      {
        [ManageSkillOperation.add]: 'Creating skill',
        [ManageSkillOperation.edit]: 'Updating skill',
        [ManageSkillOperation.delete]: 'Deleting skill',
        [ManageSkillOperation.list]: 'Listing skills',
      },
      'Skill action'
    )
  }

  if (name === ManageJob.id) {
    return resolveOperationDisplayTitle(
      args.operation,
      {
        [ManageJobOperation.create]: 'Creating job',
        [ManageJobOperation.get]: 'Getting job',
        [ManageJobOperation.update]: 'Updating job',
        [ManageJobOperation.delete]: 'Deleting job',
        [ManageJobOperation.list]: 'Listing jobs',
      },
      'Job action'
    )
  }

  if (name === ManageCredential.id) {
    return resolveOperationDisplayTitle(
      args.operation,
      {
        [ManageCredentialOperation.rename]: 'Renaming credential',
        [ManageCredentialOperation.delete]: 'Deleting credential',
      },
      'Credential action'
    )
  }

  if (name === RunWorkflow.id) {
    const workflowName = resolveWorkflowNameForDisplay(args.workflowId)
    return workflowName ? `Running ${workflowName}` : 'Running workflow'
  }

  if (name === RunFromBlock.id) {
    const workflowName = resolveWorkflowNameForDisplay(args.workflowId)
    const blockName = resolveBlockNameForDisplay(args.startBlockId)
    if (workflowName && blockName) return `Running ${workflowName} from ${blockName}`
    if (workflowName) return `Running ${workflowName}`
    if (blockName) return `Running from ${blockName}`
    return 'Running workflow'
  }

  if (name === RunWorkflowUntilBlock.id) {
    const workflowName = resolveWorkflowNameForDisplay(args.workflowId)
    const blockName = resolveBlockNameForDisplay(args.stopAfterBlockId)
    if (workflowName && blockName) return `Running ${workflowName} until ${blockName}`
    if (workflowName) return `Running ${workflowName}`
    if (blockName) return `Running until ${blockName}`
    return 'Running workflow'
  }

  if (name === GetWorkflowLogs.id) {
    const workflowName = resolveWorkflowNameForDisplay(args.workflowId)
    return workflowName ? `Getting logs for ${workflowName}` : 'Getting logs'
  }

  return undefined
}

function decodeStreamingString(value: string): string {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_: string, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

function matchStreamingStringArg(streamingArgs: string, key: string): string | undefined {
  const match = streamingArgs.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, 'm'))
  return match?.[1] ? decodeStreamingString(match[1]) : undefined
}

function resolveStreamingToolDisplayTitle(name: string, streamingArgs: string): string | undefined {
  if (name === WorkspaceFile.id) {
    return resolveWorkspaceFileDisplayTitle(
      matchStreamingStringArg(streamingArgs, 'operation'),
      matchStreamingStringArg(streamingArgs, 'title'),
      matchStreamingStringArg(streamingArgs, 'fileName')
    )
  }

  if (name === SearchOnline.id) {
    const toolTitle = matchStreamingStringArg(streamingArgs, 'toolTitle')
    return toolTitle ? `Searching online for ${toolTitle}` : undefined
  }

  if (name === Grep.id) {
    const toolTitle = matchStreamingStringArg(streamingArgs, 'toolTitle')
    return toolTitle ? `Searching for ${toolTitle}` : undefined
  }

  if (name === Glob.id) {
    const toolTitle = matchStreamingStringArg(streamingArgs, 'toolTitle')
    return toolTitle ? `Finding ${toolTitle}` : undefined
  }

  if (name === ScrapePage.id) {
    const url = matchStreamingStringArg(streamingArgs, 'url')
    return url ? `Scraping ${url}` : undefined
  }

  if (name === CrawlWebsite.id) {
    const url = matchStreamingStringArg(streamingArgs, 'url')
    return url ? `Crawling ${url}` : undefined
  }

  if (name === ManageCustomTool.id) {
    return resolveOperationDisplayTitle(
      matchStreamingStringArg(streamingArgs, 'operation'),
      {
        [ManageCustomToolOperation.add]: 'Creating custom tool',
        [ManageCustomToolOperation.edit]: 'Updating custom tool',
        [ManageCustomToolOperation.delete]: 'Deleting custom tool',
        [ManageCustomToolOperation.list]: 'Listing custom tools',
      },
      'Custom tool action'
    )
  }

  if (name === ManageMcpTool.id) {
    return resolveOperationDisplayTitle(
      matchStreamingStringArg(streamingArgs, 'operation'),
      {
        [ManageMcpToolOperation.add]: 'Creating MCP server',
        [ManageMcpToolOperation.edit]: 'Updating MCP server',
        [ManageMcpToolOperation.delete]: 'Deleting MCP server',
        [ManageMcpToolOperation.list]: 'Listing MCP servers',
      },
      'MCP server action'
    )
  }

  if (name === ManageSkill.id) {
    return resolveOperationDisplayTitle(
      matchStreamingStringArg(streamingArgs, 'operation'),
      {
        [ManageSkillOperation.add]: 'Creating skill',
        [ManageSkillOperation.edit]: 'Updating skill',
        [ManageSkillOperation.delete]: 'Deleting skill',
        [ManageSkillOperation.list]: 'Listing skills',
      },
      'Skill action'
    )
  }

  if (name === ManageJob.id) {
    return resolveOperationDisplayTitle(
      matchStreamingStringArg(streamingArgs, 'operation'),
      {
        [ManageJobOperation.create]: 'Creating job',
        [ManageJobOperation.get]: 'Getting job',
        [ManageJobOperation.update]: 'Updating job',
        [ManageJobOperation.delete]: 'Deleting job',
        [ManageJobOperation.list]: 'Listing jobs',
      },
      'Job action'
    )
  }

  if (name === ManageCredential.id) {
    return resolveOperationDisplayTitle(
      matchStreamingStringArg(streamingArgs, 'operation'),
      {
        [ManageCredentialOperation.rename]: 'Renaming credential',
        [ManageCredentialOperation.delete]: 'Deleting credential',
      },
      'Credential action'
    )
  }

  return undefined
}

type StreamToolUI = {
  hidden?: boolean
  title?: string
  clientExecutable?: boolean
}

type StreamBatchResponse = {
  success: boolean
  events: StreamBatchEvent[]
  previewSessions?: FilePreviewSession[]
  status: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const STREAM_SCHEMA_ENFORCEMENT_PREFIX = 'Client stream schema enforcement failed.'

class StreamSchemaValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StreamSchemaValidationError'
  }
}

function createStreamSchemaValidationError(
  failure: ParseStreamEventEnvelopeFailure,
  context?: string
): StreamSchemaValidationError {
  const details = failure.errors?.filter(Boolean).join('; ')
  return new StreamSchemaValidationError(
    [STREAM_SCHEMA_ENFORCEMENT_PREFIX, context, failure.message, details].filter(Boolean).join(' ')
  )
}

function createBatchSchemaValidationError(message: string): StreamSchemaValidationError {
  return new StreamSchemaValidationError([STREAM_SCHEMA_ENFORCEMENT_PREFIX, message].join(' '))
}

function isStreamSchemaValidationError(error: unknown): error is StreamSchemaValidationError {
  return error instanceof StreamSchemaValidationError
}

function parseStreamBatchResponse(value: unknown): StreamBatchResponse {
  if (!isRecord(value)) {
    throw new Error('Invalid stream batch response')
  }

  const rawEvents = Array.isArray(value.events) ? value.events : []
  const events: StreamBatchEvent[] = []
  for (const [index, entry] of rawEvents.entries()) {
    if (!isRecord(entry)) {
      throw createBatchSchemaValidationError(`Reconnect batch event ${index + 1} is not an object.`)
    }
    if (
      typeof entry.eventId !== 'number' ||
      !Number.isFinite(entry.eventId) ||
      typeof entry.streamId !== 'string'
    ) {
      throw createBatchSchemaValidationError(
        `Reconnect batch event ${index + 1} is missing required metadata.`
      )
    }

    const parsedEvent = parsePersistedStreamEventEnvelope(entry.event)
    if (!parsedEvent.ok) {
      throw createStreamSchemaValidationError(parsedEvent, `Reconnect batch event ${index + 1}.`)
    }

    events.push({
      eventId: entry.eventId,
      streamId: entry.streamId,
      event: parsedEvent.event,
    })
  }

  const rawPreviewSessions = Array.isArray(value.previewSessions)
    ? value.previewSessions
    : undefined
  const previewSessions =
    rawPreviewSessions?.map((session, index) => {
      if (!isFilePreviewSession(session)) {
        throw createBatchSchemaValidationError(
          `Reconnect preview session ${index + 1} failed validation.`
        )
      }
      return session
    }) ?? undefined

  return {
    success: value.success === true,
    events,
    ...(previewSessions ? { previewSessions } : {}),
    status: typeof value.status === 'string' ? value.status : 'unknown',
  }
}

function toRawPersistedContentBlock(block: ContentBlock): Record<string, unknown> | null {
  switch (block.type) {
    case 'text':
      return {
        type: MothershipStreamV1EventType.text,
        ...(block.subagent ? { lane: 'subagent' } : {}),
        content: block.content ?? '',
      }
    case 'tool_call':
      if (!block.toolCall) {
        return null
      }
      return {
        type: MothershipStreamV1EventType.tool,
        phase: MothershipStreamV1ToolPhase.call,
        toolCall: {
          id: block.toolCall.id,
          name: block.toolCall.name,
          state: block.toolCall.status,
          ...(block.toolCall.params ? { params: block.toolCall.params } : {}),
          ...(block.toolCall.result ? { result: block.toolCall.result } : {}),
          ...(block.toolCall.calledBy ? { calledBy: block.toolCall.calledBy } : {}),
          ...(block.toolCall.displayTitle
            ? {
                display: {
                  title: block.toolCall.displayTitle,
                },
              }
            : {}),
        },
      }
    case 'subagent':
      return {
        type: MothershipStreamV1EventType.span,
        kind: MothershipStreamV1SpanPayloadKind.subagent,
        lifecycle: MothershipStreamV1SpanLifecycleEvent.start,
        content: block.content ?? '',
      }
    case 'subagent_end':
      return {
        type: MothershipStreamV1EventType.span,
        kind: MothershipStreamV1SpanPayloadKind.subagent,
        lifecycle: MothershipStreamV1SpanLifecycleEvent.end,
      }
    case 'stopped':
      return {
        type: MothershipStreamV1EventType.complete,
        status: MothershipStreamV1CompletionStatus.cancelled,
      }
    default:
      return null
  }
}

function buildAssistantSnapshotMessage(params: {
  id: string
  content: string
  contentBlocks: ContentBlock[]
  requestId?: string
}): PersistedMessage {
  const rawContentBlocks = params.contentBlocks
    .map(toRawPersistedContentBlock)
    .filter((block): block is Record<string, unknown> => block !== null)

  return normalizeMessage({
    id: params.id,
    role: 'assistant',
    content: params.content,
    timestamp: new Date().toISOString(),
    ...(params.requestId ? { requestId: params.requestId } : {}),
    ...(rawContentBlocks.length > 0 ? { contentBlocks: rawContentBlocks } : {}),
  })
}

function markMessageStopped(message: PersistedMessage): PersistedMessage {
  if (!message.contentBlocks?.some((block) => block.toolCall?.state === 'executing')) {
    return message
  }

  const nextBlocks = message.contentBlocks.map((block) => {
    if (block.toolCall?.state !== 'executing') {
      return block
    }

    return {
      ...block,
      toolCall: {
        ...block.toolCall,
        state: 'cancelled' as const,
        display: {
          ...(block.toolCall.display ?? {}),
          title: 'Stopped by user',
        },
      },
    }
  })

  if (
    !nextBlocks.some(
      (block) =>
        block.type === MothershipStreamV1EventType.complete &&
        block.status === MothershipStreamV1CompletionStatus.cancelled
    )
  ) {
    nextBlocks.push({
      type: MothershipStreamV1EventType.complete,
      status: MothershipStreamV1CompletionStatus.cancelled,
    })
  }

  return normalizeMessage({
    ...message,
    contentBlocks: nextBlocks,
  })
}

function buildChatHistoryHydrationKey(chatHistory: TaskChatHistory): string {
  const resourceKey = chatHistory.resources
    .map((resource) => `${resource.type}:${resource.id}:${resource.title}`)
    .join('|')
  const messageKey = chatHistory.messages.map((message) => message.id).join('|')
  const streamSnapshot = chatHistory.streamSnapshot
  const snapshotKey = streamSnapshot
    ? [
        streamSnapshot.status,
        streamSnapshot.events.length,
        streamSnapshot.events[streamSnapshot.events.length - 1]?.eventId ?? '',
        streamSnapshot.previewSessions
          .map(
            (session) =>
              `${session.id}:${session.previewVersion}:${session.status}:${session.updatedAt}`
          )
          .join('|'),
      ].join('~')
    : 'none'

  return [
    chatHistory.id,
    chatHistory.activeStreamId ?? '',
    messageKey,
    resourceKey,
    snapshotKey,
  ].join('::')
}

const TERMINAL_STREAM_STATUSES = new Set(['complete', 'error', 'cancelled'])

function isTerminalStreamStatus(status: string | null | undefined): boolean {
  return TERMINAL_STREAM_STATUSES.has(status ?? '')
}

const sseEncoder = new TextEncoder()
function buildReplayStream(events: StreamBatchEvent[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      const payload = events.map((entry) => `data: ${JSON.stringify(entry.event)}\n\n`).join('')
      controller.enqueue(sseEncoder.encode(payload))
      controller.close()
    },
  })
}

function asPayloadRecord(value: unknown): StreamPayload | undefined {
  return isRecord(value) ? value : undefined
}

function getToolUI(ui?: MothershipStreamV1ToolUI): StreamToolUI | undefined {
  if (!ui) {
    return undefined
  }

  const title =
    typeof ui.title === 'string'
      ? ui.title
      : typeof ui.phaseLabel === 'string'
        ? ui.phaseLabel
        : undefined

  return {
    ...(typeof ui.hidden === 'boolean' ? { hidden: ui.hidden } : {}),
    ...(title ? { title } : {}),
    ...(typeof ui.clientExecutable === 'boolean' ? { clientExecutable: ui.clientExecutable } : {}),
  }
}

function resolveLiveToolStatus(
  payload: Partial<{
    status: string
    success: boolean
    output: unknown
  }>
): ToolCallStatus {
  return resolveStreamToolOutcome(payload) as ToolCallStatus
}

/** Adds a workflow to the React Query cache with a top-insertion sort order if it doesn't already exist. */
function ensureWorkflowInRegistry(resourceId: string, title: string, workspaceId: string): boolean {
  const workflows = getWorkflows(workspaceId)
  if (workflows.some((w) => w.id === resourceId)) return false
  const sortOrder = getTopInsertionSortOrder(
    Object.fromEntries(workflows.map((w) => [w.id, w])),
    getFolderMap(workspaceId),
    workspaceId,
    null
  )
  const newMetadata: WorkflowMetadata = {
    id: resourceId,
    name: title,
    lastModified: new Date(),
    createdAt: new Date(),
    color: getNextWorkflowColor(),
    workspaceId,
    folderId: null,
    sortOrder,
  }
  const queryClient = getQueryClient()
  const key = workflowKeys.list(workspaceId, 'active')
  queryClient.setQueryData<WorkflowMetadata[]>(key, (current) => {
    const next = current ?? workflows
    if (next.some((workflow) => workflow.id === resourceId)) {
      return next
    }

    return [...next, newMetadata]
  })
  void invalidateWorkflowSelectors(queryClient, workspaceId)
  return true
}

function extractResourceFromReadResult(
  path: string | undefined,
  output: unknown
): MothershipResource | null {
  if (!path) return null

  const segments = path
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
  const resourceType = VFS_DIR_TO_RESOURCE[segments[0]]
  if (!resourceType || !segments[1]) return null

  const obj = output && typeof output === 'object' ? (output as Record<string, unknown>) : undefined
  if (!obj) return null

  let id = obj.id as string | undefined
  let name = obj.name as string | undefined

  if (!id && typeof obj.content === 'string') {
    try {
      const parsed = JSON.parse(obj.content)
      id = parsed?.id as string | undefined
      name = parsed?.name as string | undefined
    } catch {
      // content is not JSON
    }
  }

  const fallbackTitle =
    resourceType === 'workflow'
      ? resolveLeafWorkflowPathSegment(segments)
      : segments[1] || segments[segments.length - 1]

  if (!id) return null
  return { type: resourceType, id, title: name || fallbackTitle || id }
}

function resolveLeafWorkflowPathSegment(segments: string[]): string | undefined {
  const lastSegment = segments[segments.length - 1]
  if (!lastSegment) return undefined
  if (/\.[^/.]+$/.test(lastSegment) && segments.length > 1) {
    return segments[segments.length - 2]
  }
  return lastSegment
}

export interface UseChatOptions {
  onResourceEvent?: () => void
  apiPath?: string
  stopPath?: string
  workflowId?: string
  onToolResult?: (toolName: string, success: boolean, result: unknown) => void
  onTitleUpdate?: () => void
  onStreamEnd?: (chatId: string, messages: ChatMessage[]) => void
  initialActiveResourceId?: string | null
}

export function getMothershipUseChatOptions(
  options: Pick<UseChatOptions, 'onResourceEvent' | 'onStreamEnd' | 'initialActiveResourceId'> = {}
): UseChatOptions {
  return {
    apiPath: MOTHERSHIP_CHAT_API_PATH,
    stopPath: '/api/mothership/chat/stop',
    ...options,
  }
}

export function getWorkflowCopilotUseChatOptions(
  options: Pick<
    UseChatOptions,
    'workflowId' | 'onToolResult' | 'onTitleUpdate' | 'onStreamEnd'
  > = {}
): UseChatOptions {
  return {
    apiPath: MOTHERSHIP_CHAT_API_PATH,
    stopPath: '/api/mothership/chat/stop',
    ...options,
  }
}

export function useChat(
  workspaceId: string,
  initialChatId?: string,
  options?: UseChatOptions
): UseChatReturn {
  const pathname = usePathname()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [pendingMessages, setPendingMessages] = useState<ChatMessage[]>([])
  const [isSending, setIsSending] = useState(false)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resolvedChatId, setResolvedChatId] = useState<string | undefined>(initialChatId)
  const [resources, setResources] = useState<MothershipResource[]>([])
  const [activeResourceId, setActiveResourceId] = useState<string | null>(
    options?.initialActiveResourceId ?? null
  )
  const [genericResourceData, setGenericResourceData] = useState<GenericResourceData | null>(null)
  const onResourceEventRef = useRef(options?.onResourceEvent)
  onResourceEventRef.current = options?.onResourceEvent
  const apiPathRef = useRef(options?.apiPath ?? MOTHERSHIP_CHAT_API_PATH)
  apiPathRef.current = options?.apiPath ?? MOTHERSHIP_CHAT_API_PATH
  const stopPathRef = useRef(options?.stopPath ?? '/api/mothership/chat/stop')
  stopPathRef.current = options?.stopPath ?? '/api/mothership/chat/stop'
  const pendingStopPromiseRef = useRef<Promise<void> | null>(null)
  const workflowIdRef = useRef(options?.workflowId)
  workflowIdRef.current = options?.workflowId
  const onToolResultRef = useRef(options?.onToolResult)
  onToolResultRef.current = options?.onToolResult
  const onTitleUpdateRef = useRef(options?.onTitleUpdate)
  onTitleUpdateRef.current = options?.onTitleUpdate
  const onStreamEndRef = useRef(options?.onStreamEnd)
  onStreamEndRef.current = options?.onStreamEnd

  const clearQueueDispatchState = useCallback(() => {
    queueDispatchEpochRef.current++
    queueDispatchActionsRef.current = []
    queuedMessageDispatchIdsRef.current.clear()
    queueDispatchTaskRef.current = null
  }, [])
  const resourcesRef = useRef(resources)
  resourcesRef.current = resources

  // Derive the effective active resource ID — auto-selects the last resource when the stored ID is
  // absent or no longer in the list, avoiding a separate Effect-based state correction loop.
  const effectiveActiveResourceId = useMemo(() => {
    if (resources.length === 0) return null
    if (activeResourceId && resources.some((r) => r.id === activeResourceId))
      return activeResourceId
    return resources[resources.length - 1].id
  }, [resources, activeResourceId])

  const activeResourceIdRef = useRef(effectiveActiveResourceId)
  activeResourceIdRef.current = effectiveActiveResourceId

  const upsertTaskChatHistory = useCallback(
    (chatId: string, updater: (current: TaskChatHistory) => TaskChatHistory) => {
      queryClient.setQueryData<TaskChatHistory>(taskKeys.detail(chatId), (current) => {
        const base: TaskChatHistory = current ?? {
          id: chatId,
          title: null,
          messages: [],
          activeStreamId: null,
          resources: resourcesRef.current,
        }
        return updater(base)
      })
    },
    [queryClient]
  )

  const {
    previewSession,
    previewSessionsById,
    activePreviewSessionId,
    hydratePreviewSessions,
    upsertPreviewSession,
    completePreviewSession,
    removePreviewSession,
    resetPreviewSessions,
  } = useFilePreviewSessions()
  const previewSessionRef = useRef(previewSession)
  previewSessionRef.current = previewSession
  const previewSessionsRef = useRef(previewSessionsById)
  previewSessionsRef.current = previewSessionsById
  const activePreviewSessionIdRef = useRef(activePreviewSessionId)
  activePreviewSessionIdRef.current = activePreviewSessionId
  const previewSessionsStateRef = useRef<FilePreviewSessionsState>({
    activeSessionId: activePreviewSessionId,
    sessions: previewSessionsById,
  })
  previewSessionsStateRef.current = {
    activeSessionId: activePreviewSessionId,
    sessions: previewSessionsById,
  }

  const syncPreviewSessionRefs = useCallback((nextState: FilePreviewSessionsState) => {
    previewSessionsStateRef.current = nextState
    previewSessionsRef.current = nextState.sessions
    activePreviewSessionIdRef.current = nextState.activeSessionId
    previewSessionRef.current =
      nextState.activeSessionId !== null
        ? (nextState.sessions[nextState.activeSessionId] ?? null)
        : null
  }, [])

  const applyPreviewSessionUpdate = useCallback(
    (session: FilePreviewSession, options?: { activate?: boolean }) => {
      const nextState = reduceFilePreviewSessions(previewSessionsStateRef.current, {
        type: 'upsert',
        session,
        ...(options?.activate === false ? { activate: false } : {}),
      })
      syncPreviewSessionRefs(nextState)
      upsertPreviewSession(session, options)
      return nextState
    },
    [syncPreviewSessionRefs, upsertPreviewSession]
  )

  const applyCompletedPreviewSession = useCallback(
    (session: FilePreviewSession) => {
      const nextState = reduceFilePreviewSessions(previewSessionsStateRef.current, {
        type: 'complete',
        session,
      })
      syncPreviewSessionRefs(nextState)
      completePreviewSession(session)
      return nextState
    },
    [completePreviewSession, syncPreviewSessionRefs]
  )

  const reconcileTerminalPreviewSessions = useCallback(() => {
    const completedAt = new Date().toISOString()
    const completedSessions = buildCompletedPreviewSessions(
      previewSessionsStateRef.current.sessions,
      completedAt
    )

    for (const session of completedSessions) {
      applyCompletedPreviewSession(session)
    }
  }, [applyCompletedPreviewSession])

  const removePreviewSessionImmediate = useCallback(
    (sessionId: string) => {
      const nextState = reduceFilePreviewSessions(previewSessionsStateRef.current, {
        type: 'remove',
        sessionId,
      })
      syncPreviewSessionRefs(nextState)
      removePreviewSession(sessionId)
      return nextState
    },
    [removePreviewSession, syncPreviewSessionRefs]
  )

  const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([])
  const messageQueueRef = useRef<QueuedMessage[]>([])
  messageQueueRef.current = messageQueue
  const queuedMessageDispatchIdsRef = useRef<Set<string>>(new Set())
  const queueDispatchActionsRef = useRef<QueueDispatchAction[]>([])
  const queueDispatchTaskRef = useRef<Promise<void> | null>(null)
  const queueDispatchEpochRef = useRef(0)
  const queueDispatchLoopRef = useRef<() => Promise<void>>(async () => {})
  const enqueueQueueDispatchRef = useRef<(action: QueueDispatchActionInput) => Promise<void>>(
    async () => {}
  )

  const processSSEStreamRef = useRef<
    (
      reader: ReadableStreamDefaultReader<Uint8Array>,
      assistantId: string,
      expectedGen?: number,
      options?: { preserveExistingState?: boolean }
    ) => Promise<{ sawStreamError: boolean; sawComplete: boolean }>
  >(async () => ({ sawStreamError: false, sawComplete: false }))
  const attachToExistingStreamRef = useRef<
    (opts: {
      streamId: string
      assistantId: string
      expectedGen: number
      initialBatch?: StreamBatchResponse | null
      afterCursor?: string
    }) => Promise<{ error: boolean; aborted: boolean }>
  >(async () => ({ error: false, aborted: true }))
  const retryReconnectRef = useRef<
    (opts: { streamId: string; assistantId: string; gen: number }) => Promise<boolean>
  >(async () => false)
  const finalizeRef = useRef<(options?: { error?: boolean }) => void>(() => {})
  const recoveringQueuedSendHandoffIdRef = useRef<string | null>(null)

  const resetEphemeralPreviewState = useCallback(
    (options?: { removeStreamingResource?: boolean }) => {
      syncPreviewSessionRefs(INITIAL_FILE_PREVIEW_SESSIONS_STATE)
      resetPreviewSessions()
      if (options?.removeStreamingResource) {
        setResources((current) => current.filter((resource) => resource.id !== 'streaming-file'))
      }
    },
    [resetPreviewSessions, syncPreviewSessionRefs]
  )

  const syncPreviewResourceChrome = useCallback((session: FilePreviewSession) => {
    if (session.targetKind === 'new_file') {
      setResources((current) => {
        const existing = current.find((resource) => resource.id === 'streaming-file')
        if (existing) {
          return current.map((resource) =>
            resource.id === 'streaming-file'
              ? { ...resource, title: session.fileName || 'Writing file...' }
              : resource
          )
        }
        return [
          ...current,
          {
            type: 'file',
            id: 'streaming-file',
            title: session.fileName || 'Writing file...',
          },
        ]
      })
      setActiveResourceId('streaming-file')
      return
    }

    if (session.fileId) {
      setResources((current) => current.filter((resource) => resource.id !== 'streaming-file'))
      setActiveResourceId(session.fileId)
    }
  }, [])

  const seedPreviewSessions = useCallback(
    (sessions: FilePreviewSession[]) => {
      if (sessions.length === 0) {
        return
      }

      const nextState = reduceFilePreviewSessions(previewSessionsStateRef.current, {
        type: 'hydrate',
        sessions,
      })
      syncPreviewSessionRefs(nextState)
      hydratePreviewSessions(sessions)
      const active =
        nextState.activeSessionId !== null
          ? (nextState.sessions[nextState.activeSessionId] ?? null)
          : null
      if (active) {
        syncPreviewResourceChrome(active)
      }
    },
    [hydratePreviewSessions, syncPreviewResourceChrome, syncPreviewSessionRefs]
  )

  const abortControllerRef = useRef<AbortController | null>(null)
  const streamReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  const chatIdRef = useRef<string | undefined>(initialChatId)
  /** Panel/task selection — drives createNewChat + request chatId; may differ from chatIdRef while a stream is still finishing. */
  const selectedChatIdRef = useRef<string | undefined>(initialChatId)
  selectedChatIdRef.current = initialChatId
  const appliedChatHistoryKeyRef = useRef<string | undefined>(undefined)
  const activeTurnRef = useRef<ActiveTurn | null>(null)
  const pendingUserMsgRef = useRef<PersistedMessage | null>(null)
  const streamIdRef = useRef<string | undefined>(undefined)
  // W3C traceparent from the chat POST response; echoed on
  // abort/stop/confirm/replay so side-channel calls join the same
  // trace instead of becoming disconnected roots.
  const streamTraceparentRef = useRef<string | undefined>(undefined)
  // The `request.id` from the active stream's trace events. Forwarded
  // to /chat/stop so the persisted aborted message carries it (keeps
  // the copy-request-ID button functional after refetch).
  const streamRequestIdRef = useRef<string | undefined>(undefined)
  const locallyTerminalStreamIdRef = useRef<string | undefined>(undefined)
  const lastCursorRef = useRef('0')
  const sendingRef = useRef(false)
  const streamGenRef = useRef(0)
  const streamingContentRef = useRef('')
  const streamingBlocksRef = useRef<ContentBlock[]>([])
  const handledClientWorkflowToolIdsRef = useRef<Set<string>>(new Set())
  const recoveringClientWorkflowToolIdsRef = useRef<Set<string>>(new Set())
  const executionStream = useExecutionStream()
  const isHomePage = pathname.endsWith('/home')

  const setTransportIdle = useCallback(() => {
    sendingRef.current = false
    setIsSending(false)
    setIsReconnecting(false)
  }, [])

  const setTransportStreaming = useCallback(() => {
    sendingRef.current = true
    setIsSending(true)
    setIsReconnecting(false)
  }, [])

  const setTransportReconnecting = useCallback(() => {
    sendingRef.current = true
    setIsSending(true)
    setIsReconnecting(true)
  }, [])

  const resetStreamingBuffers = useCallback(() => {
    streamingContentRef.current = ''
    streamingBlocksRef.current = []
  }, [])

  const clearActiveTurn = useCallback(() => {
    activeTurnRef.current = null
    pendingUserMsgRef.current = null
    streamIdRef.current = undefined
    streamRequestIdRef.current = undefined
    streamTraceparentRef.current = undefined
    setCurrentChatTraceparent(undefined)
    lastCursorRef.current = '0'
    resetStreamingBuffers()
  }, [resetStreamingBuffers])

  const resetHomeChatState = useCallback(() => {
    streamGenRef.current++
    chatIdRef.current = undefined
    lastCursorRef.current = '0'
    locallyTerminalStreamIdRef.current = undefined
    clearActiveTurn()
    setResolvedChatId(undefined)
    appliedChatHistoryKeyRef.current = undefined
    abortControllerRef.current = null
    setPendingMessages([])
    setError(null)
    setTransportIdle()
    setResources([])
    setActiveResourceId(null)
    resetEphemeralPreviewState()
    setMessageQueue([])
    clearQueueDispatchState()
  }, [clearActiveTurn, clearQueueDispatchState, resetEphemeralPreviewState, setTransportIdle])

  const { data: chatHistory } = useChatHistory(resolvedChatId)
  const messages = useMemo(
    () => chatHistory?.messages.map(toDisplayMessage) ?? pendingMessages,
    [chatHistory, pendingMessages]
  )
  const addResource = useCallback((resource: MothershipResource): boolean => {
    if (resourcesRef.current.some((r) => r.type === resource.type && r.id === resource.id)) {
      return false
    }

    setResources((prev) => {
      const exists = prev.some((r) => r.type === resource.type && r.id === resource.id)
      if (exists) return prev
      return [...prev, resource]
    })
    setActiveResourceId(resource.id)

    if (resource.id === 'streaming-file') {
      return true
    }

    const persistChatId = chatIdRef.current ?? selectedChatIdRef.current
    if (persistChatId) {
      fetch('/api/mothership/chat/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: persistChatId, resource }),
      }).catch((err) => {
        logger.warn('Failed to persist resource', err)
      })
    }
    return true
  }, [])

  const removeResource = useCallback((resourceType: MothershipResourceType, resourceId: string) => {
    setResources((prev) => prev.filter((r) => !(r.type === resourceType && r.id === resourceId)))
    setActiveResourceId((prev) => (prev === resourceId ? null : prev))
  }, [])

  const reorderResources = useCallback((newOrder: MothershipResource[]) => {
    setResources(newOrder)
  }, [])

  const ensureWorkflowToolResource = useCallback(
    (toolArgs: Record<string, unknown>): string | undefined => {
      const targetWorkflowId =
        typeof toolArgs.workflowId === 'string'
          ? toolArgs.workflowId
          : useWorkflowRegistry.getState().activeWorkflowId

      if (!targetWorkflowId) {
        return undefined
      }

      const meta = getWorkflowById(workspaceId, targetWorkflowId)
      const wasAdded = addResource({
        type: 'workflow',
        id: targetWorkflowId,
        title: meta?.name ?? 'Workflow',
      })
      if (!wasAdded && activeResourceIdRef.current !== targetWorkflowId) {
        setActiveResourceId(targetWorkflowId)
      }
      onResourceEventRef.current?.()

      return targetWorkflowId
    },
    [addResource, workspaceId]
  )

  const startClientWorkflowTool = useCallback(
    (toolCallId: string, toolName: string, toolArgs: Record<string, unknown>) => {
      if (!isWorkflowToolName(toolName)) {
        return
      }
      if (handledClientWorkflowToolIdsRef.current.has(toolCallId)) {
        return
      }
      handledClientWorkflowToolIdsRef.current.add(toolCallId)

      ensureWorkflowToolResource(toolArgs)
      executeRunToolOnClient(toolCallId, toolName, toolArgs)
    },
    [ensureWorkflowToolResource]
  )

  const recoverPendingClientWorkflowTools = useCallback(
    async (nextMessages: ChatMessage[]) => {
      for (const message of nextMessages) {
        for (const block of message.contentBlocks ?? []) {
          const toolCall = block.toolCall
          if (!toolCall || !isWorkflowToolName(toolCall.name)) {
            continue
          }
          if (toolCall.status !== 'executing') {
            continue
          }

          if (
            handledClientWorkflowToolIdsRef.current.has(toolCall.id) ||
            recoveringClientWorkflowToolIdsRef.current.has(toolCall.id)
          ) {
            continue
          }

          recoveringClientWorkflowToolIdsRef.current.add(toolCall.id)

          try {
            const toolArgs = toolCall.params ?? {}
            const targetWorkflowId = ensureWorkflowToolResource(toolArgs)

            if (targetWorkflowId) {
              const rebound = await bindRunToolToExecution(toolCall.id, targetWorkflowId)
              if (rebound) {
                handledClientWorkflowToolIdsRef.current.add(toolCall.id)
                continue
              }
            }

            startClientWorkflowTool(toolCall.id, toolCall.name, toolArgs)
          } finally {
            recoveringClientWorkflowToolIdsRef.current.delete(toolCall.id)
          }
        }
      }
    },
    [ensureWorkflowToolResource, startClientWorkflowTool]
  )

  useEffect(() => {
    const streamOwnerId = chatIdRef.current
    const navigatedToDifferentChat =
      sendingRef.current &&
      initialChatId !== streamOwnerId &&
      (initialChatId !== undefined || streamOwnerId !== undefined)
    if (sendingRef.current) {
      if (navigatedToDifferentChat) {
        const abandonedChatId = streamOwnerId
        // Detach the current UI from the old stream without cancelling it on the server.
        // Reopening that chat later will reconnect through the existing chatHistory flow.
        streamGenRef.current++
        abortControllerRef.current = null
        clearActiveTurn()
        setTransportIdle()
        if (abandonedChatId) {
          queryClient.invalidateQueries({ queryKey: taskKeys.detail(abandonedChatId) })
        }
      } else {
        setResolvedChatId(initialChatId)
        return
      }
    }
    chatIdRef.current = initialChatId
    lastCursorRef.current = '0'
    locallyTerminalStreamIdRef.current = undefined
    clearActiveTurn()
    setResolvedChatId(initialChatId)
    appliedChatHistoryKeyRef.current = undefined
    setPendingMessages([])
    setError(null)
    setTransportIdle()
    setResources([])
    setActiveResourceId(null)
    resetEphemeralPreviewState()
    setMessageQueue([])
    clearQueueDispatchState()
  }, [
    initialChatId,
    queryClient,
    resetEphemeralPreviewState,
    clearQueueDispatchState,
    clearActiveTurn,
    setTransportIdle,
  ])

  useEffect(() => {
    if (workflowIdRef.current) return
    if (!isHomePage || !chatIdRef.current) return
    resetHomeChatState()
  }, [isHomePage, resetHomeChatState])

  useEffect(() => {
    if (!chatHistory) return

    const hydrationKey = buildChatHistoryHydrationKey(chatHistory)
    if (appliedChatHistoryKeyRef.current === hydrationKey) return

    const activeStreamId = chatHistory.activeStreamId
    appliedChatHistoryKeyRef.current = hydrationKey
    const mappedMessages = chatHistory.messages.map(toDisplayMessage)
    const snapshotEvents = Array.isArray(chatHistory.streamSnapshot?.events)
      ? chatHistory.streamSnapshot.events
      : []
    const snapshotHasCompleteEvent = snapshotEvents.some(
      (entry) => entry?.event?.type === MothershipStreamV1EventType.complete
    )
    const shouldReconnectActiveStream =
      Boolean(activeStreamId) &&
      !sendingRef.current &&
      activeStreamId !== locallyTerminalStreamIdRef.current &&
      !isTerminalStreamStatus(chatHistory.streamSnapshot?.status) &&
      !snapshotHasCompleteEvent

    if (!activeStreamId && locallyTerminalStreamIdRef.current) {
      locallyTerminalStreamIdRef.current = undefined
    }

    void recoverPendingClientWorkflowTools(mappedMessages)

    if (chatHistory.resources.some((r) => r.id === 'streaming-file')) {
      fetch('/api/mothership/chat/resources', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: chatHistory.id,
          resourceType: 'file',
          resourceId: 'streaming-file',
        }),
      }).catch(() => {})
    }

    const persistedResources = chatHistory.resources.filter((r) => r.id !== 'streaming-file')
    if (persistedResources.length > 0) {
      setResources(persistedResources)
      setActiveResourceId((prev) =>
        prev && persistedResources.some((r) => r.id === prev)
          ? prev
          : persistedResources[persistedResources.length - 1].id
      )

      for (const resource of persistedResources) {
        if (resource.type !== 'workflow') continue
        ensureWorkflowInRegistry(resource.id, resource.title, workspaceId)
      }
    } else if (chatHistory.resources.some((r) => r.id === 'streaming-file')) {
      setResources([])
      setActiveResourceId(null)
    }

    const snapshotPreviewSessions = Array.isArray(chatHistory.streamSnapshot?.previewSessions)
      ? (chatHistory.streamSnapshot.previewSessions as FilePreviewSession[])
      : []
    if (snapshotPreviewSessions.length > 0) {
      seedPreviewSessions(snapshotPreviewSessions)
    }

    if (shouldReconnectActiveStream && activeStreamId) {
      const gen = ++streamGenRef.current
      const abortController = new AbortController()
      abortControllerRef.current = abortController
      streamIdRef.current = activeStreamId
      lastCursorRef.current = '0'
      setTransportReconnecting()

      const assistantId = getLiveAssistantMessageId(activeStreamId)

      const reconnect = async () => {
        const initialSnapshot = chatHistory.streamSnapshot
        const snapshotEvents = Array.isArray(initialSnapshot?.events)
          ? (initialSnapshot.events as StreamBatchEvent[])
          : []

        const reconnectResult =
          snapshotEvents.length > 0
            ? await attachToExistingStreamRef.current({
                streamId: activeStreamId,
                assistantId,
                expectedGen: gen,
                initialBatch: {
                  success: true,
                  events: snapshotEvents,
                  previewSessions: snapshotPreviewSessions,
                  status: initialSnapshot?.status ?? 'unknown',
                },
                afterCursor: String(snapshotEvents[snapshotEvents.length - 1]?.eventId ?? '0'),
              })
            : null

        const succeeded =
          reconnectResult !== null
            ? !reconnectResult.error || reconnectResult.aborted
            : await retryReconnectRef.current({
                streamId: activeStreamId,
                assistantId,
                gen,
              })
        if (succeeded && streamGenRef.current === gen && sendingRef.current) {
          finalizeRef.current()
          return
        }
        if (succeeded && streamGenRef.current === gen) {
          setTransportIdle()
          abortControllerRef.current = null
          return
        }
        if (!succeeded && streamGenRef.current === gen) {
          try {
            finalizeRef.current({ error: true })
          } catch {
            setTransportIdle()
            abortControllerRef.current = null
            setError('Failed to reconnect to the active stream')
          }
        }
      }
      reconnect()
    }
  }, [
    chatHistory,
    workspaceId,
    queryClient,
    recoverPendingClientWorkflowTools,
    seedPreviewSessions,
    setTransportIdle,
    setTransportReconnecting,
  ])

  const processSSEStream = useCallback(
    async (
      reader: ReadableStreamDefaultReader<Uint8Array>,
      assistantId: string,
      expectedGen?: number,
      options?: { preserveExistingState?: boolean }
    ) => {
      const decoder = new TextDecoder()
      streamReaderRef.current = reader
      let buffer = ''

      const preserveState = options?.preserveExistingState === true
      const blocks: ContentBlock[] = preserveState ? [...streamingBlocksRef.current] : []
      const toolMap = new Map<string, number>()
      const toolArgsMap = new Map<string, Record<string, unknown>>()

      if (preserveState) {
        for (let i = 0; i < blocks.length; i++) {
          const tc = blocks[i].toolCall
          if (tc) {
            toolMap.set(tc.id, i)
            if (tc.params) toolArgsMap.set(tc.id, tc.params)
          }
        }
      }

      let activeSubagent: string | undefined
      let activeSubagentParentToolCallId: string | undefined
      let activeCompactionId: string | undefined
      const subagentByParentToolCallId = new Map<string, string>()

      if (preserveState) {
        for (let i = blocks.length - 1; i >= 0; i--) {
          if (blocks[i].type === 'subagent' && blocks[i].content) {
            activeSubagent = blocks[i].content
            break
          }
          if (blocks[i].type === 'subagent_end') {
            break
          }
        }
      }

      let runningText = preserveState ? streamingContentRef.current || '' : ''
      let lastContentSource: 'main' | 'subagent' | null = null
      let streamRequestId: string | undefined

      if (!preserveState) {
        streamingContentRef.current = ''
        streamingBlocksRef.current = []
      }

      const ensureTextBlock = (subagentName?: string): ContentBlock => {
        const last = blocks[blocks.length - 1]
        if (last?.type === 'text' && last.subagent === subagentName) return last
        const b: ContentBlock = { type: 'text', content: '' }
        if (subagentName) b.subagent = subagentName
        blocks.push(b)
        return b
      }

      const resolveScopedSubagent = (
        agentId: string | undefined,
        parentToolCallId: string | undefined
      ): string | undefined => {
        if (agentId) return agentId
        if (parentToolCallId) {
          const scoped = subagentByParentToolCallId.get(parentToolCallId)
          if (scoped) return scoped
        }
        return activeSubagent
      }

      const appendInlineErrorTag = (tag: string, subagentName?: string) => {
        if (runningText.includes(tag)) return
        const tb = ensureTextBlock(subagentName)
        const prefix = runningText.length > 0 && !runningText.endsWith('\n') ? '\n' : ''
        tb.content = `${tb.content ?? ''}${prefix}${tag}`
        runningText += `${prefix}${tag}`
        streamingContentRef.current = runningText
        flush()
      }

      const buildInlineErrorTag = (payload: MothershipStreamV1ErrorPayload) => {
        const message =
          (typeof payload.displayMessage === 'string' ? payload.displayMessage : undefined) ||
          (typeof payload.message === 'string' ? payload.message : undefined) ||
          (typeof payload.error === 'string' ? payload.error : undefined) ||
          'An unexpected error occurred'
        const provider = typeof payload.provider === 'string' ? payload.provider : undefined
        const code = typeof payload.code === 'string' ? payload.code : undefined
        return `<mothership-error>${JSON.stringify({
          message,
          ...(code ? { code } : {}),
          ...(provider ? { provider } : {}),
        })}</mothership-error>`
      }

      const isStale = () => expectedGen !== undefined && streamGenRef.current !== expectedGen
      let sawStreamError = false
      let sawCompleteEvent = false
      let scheduledTextFlushFrame: number | null = null

      const flush = () => {
        if (isStale()) return
        streamingBlocksRef.current = [...blocks]
        const activeChatId = chatIdRef.current
        if (!activeChatId) {
          const snapshot: Partial<ChatMessage> = {
            content: runningText,
            contentBlocks: [...blocks],
          }
          if (streamRequestId) snapshot.requestId = streamRequestId
          setPendingMessages((prev) => {
            if (expectedGen !== undefined && streamGenRef.current !== expectedGen) return prev
            const idx = prev.findIndex((m) => m.id === assistantId)
            if (idx >= 0) {
              return prev.map((m) => (m.id === assistantId ? { ...m, ...snapshot } : m))
            }
            return [
              ...prev,
              { id: assistantId, role: 'assistant' as const, content: '', ...snapshot },
            ]
          })
          return
        }

        const assistantMessage = buildAssistantSnapshotMessage({
          id: assistantId,
          content: runningText,
          contentBlocks: blocks,
          ...(streamRequestId ? { requestId: streamRequestId } : {}),
        })
        upsertTaskChatHistory(activeChatId, (current) => ({
          ...current,
          messages: [
            ...current.messages.filter((message) => message.id !== assistantId),
            assistantMessage,
          ],
          activeStreamId: streamIdRef.current ?? current.activeStreamId,
        }))
      }

      const flushText = () => {
        if (isStale()) return
        if (scheduledTextFlushFrame !== null) return
        if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
          flush()
          return
        }
        scheduledTextFlushFrame = window.requestAnimationFrame(() => {
          scheduledTextFlushFrame = null
          flush()
        })
      }

      try {
        const pendingLines: string[] = []

        while (true) {
          if (pendingLines.length === 0) {
            // Don't read another chunk after `complete` has drained.
            if (sawCompleteEvent) break
            const { done, value } = await reader.read()
            if (done) break
            if (isStale()) continue

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''
            pendingLines.push(...lines)
            if (pendingLines.length === 0) {
              continue
            }
          }

          const line = pendingLines.shift()
          if (line === undefined) {
            continue
          }
          if (isStale()) {
            pendingLines.length = 0
            continue
          }
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6)

          const parsedResult = parsePersistedStreamEventEnvelopeJson(raw)
          if (!parsedResult.ok) {
            const error = createStreamSchemaValidationError(parsedResult, 'Live SSE event.')
            logger.error('Rejected chat SSE event due to client-side schema enforcement', {
              reason: parsedResult.reason,
              message: parsedResult.message,
              errors: parsedResult.errors,
              error: error.message,
            })
            throw error
          }
          const parsed = parsedResult.event

          if (parsed.trace?.requestId && parsed.trace.requestId !== streamRequestId) {
            streamRequestId = parsed.trace.requestId
            streamRequestIdRef.current = streamRequestId
            flush()
          }
          if (parsed.stream?.streamId) {
            streamIdRef.current = parsed.stream.streamId
          }
          if (parsed.stream?.cursor) {
            lastCursorRef.current = parsed.stream.cursor
          } else if (typeof parsed.seq === 'number') {
            lastCursorRef.current = String(parsed.seq)
          }

          logger.debug('SSE event received', parsed)
          const scopedParentToolCallId =
            typeof parsed.scope?.parentToolCallId === 'string'
              ? parsed.scope.parentToolCallId
              : undefined
          const scopedAgentId =
            typeof parsed.scope?.agentId === 'string' ? parsed.scope.agentId : undefined
          const scopedSubagent = resolveScopedSubagent(scopedAgentId, scopedParentToolCallId)
          switch (parsed.type) {
            case MothershipStreamV1EventType.session: {
              const payload = parsed.payload
              const payloadChatId =
                payload.kind === MothershipStreamV1SessionKind.chat
                  ? payload.chatId
                  : typeof parsed.stream?.chatId === 'string'
                    ? parsed.stream.chatId
                    : undefined
              if (payload.kind === MothershipStreamV1SessionKind.chat && payloadChatId) {
                const isNewChat = !chatIdRef.current
                chatIdRef.current = payloadChatId
                const selected = selectedChatIdRef.current
                if (selected == null) {
                  if (isNewChat) {
                    setResolvedChatId(payloadChatId)
                  }
                } else if (payloadChatId === selected) {
                  setResolvedChatId(payloadChatId)
                }
                queryClient.invalidateQueries({
                  queryKey: taskKeys.list(workspaceId),
                })
                if (isNewChat) {
                  const userMsg = pendingUserMsgRef.current
                  const activeStreamId = streamIdRef.current
                  if (userMsg && activeStreamId) {
                    const assistantMessage = buildAssistantSnapshotMessage({
                      id:
                        activeTurnRef.current?.assistantMessageId ??
                        getLiveAssistantMessageId(activeStreamId),
                      content: streamingContentRef.current,
                      contentBlocks: streamingBlocksRef.current,
                    })
                    const seededMessages = [userMsg, assistantMessage]
                    queryClient.setQueryData<TaskChatHistory>(taskKeys.detail(payloadChatId), {
                      id: payloadChatId,
                      title: null,
                      messages: seededMessages,
                      activeStreamId,
                      resources: resourcesRef.current,
                    })
                  }
                  setPendingMessages([])
                  if (!workflowIdRef.current) {
                    window.history.replaceState(
                      null,
                      '',
                      `/workspace/${workspaceId}/task/${payloadChatId}`
                    )
                  }
                }
              }
              if (payload.kind === MothershipStreamV1SessionKind.title) {
                queryClient.invalidateQueries({
                  queryKey: taskKeys.list(workspaceId),
                })
                onTitleUpdateRef.current?.()
              }
              break
            }
            case MothershipStreamV1EventType.text: {
              const chunk = parsed.payload.text
              if (chunk) {
                const contentSource: 'main' | 'subagent' = scopedSubagent ? 'subagent' : 'main'
                const needsBoundaryNewline =
                  lastContentSource !== null &&
                  lastContentSource !== contentSource &&
                  runningText.length > 0 &&
                  !runningText.endsWith('\n')
                const tb = ensureTextBlock(scopedSubagent)
                const normalizedChunk = needsBoundaryNewline ? `\n${chunk}` : chunk
                tb.content = (tb.content ?? '') + normalizedChunk
                runningText += normalizedChunk
                lastContentSource = contentSource
                streamingContentRef.current = runningText
                flushText()
              }
              break
            }
            case MothershipStreamV1EventType.tool: {
              const payload = parsed.payload
              const id = payload.toolCallId

              if ('previewPhase' in payload) {
                const prevSession = previewSessionsRef.current[id]
                const target =
                  payload.previewPhase === 'file_preview_target' ? payload.target : undefined
                const targetKind =
                  'targetKind' in payload &&
                  (payload.targetKind === 'new_file' || payload.targetKind === 'file_id')
                    ? payload.targetKind
                    : target?.kind === 'new_file' || target?.kind === 'file_id'
                      ? target.kind
                      : prevSession?.targetKind
                const fileId =
                  'fileId' in payload && typeof payload.fileId === 'string'
                    ? payload.fileId
                    : typeof target?.fileId === 'string'
                      ? target.fileId
                      : prevSession?.fileId
                const fileName =
                  'fileName' in payload && typeof payload.fileName === 'string'
                    ? payload.fileName
                    : typeof target?.fileName === 'string'
                      ? target.fileName
                      : (prevSession?.fileName ?? '')
                const operation =
                  'operation' in payload && typeof payload.operation === 'string'
                    ? payload.operation
                    : prevSession?.operation
                const edit =
                  ('edit' in payload ? asPayloadRecord(payload.edit) : undefined) ??
                  prevSession?.edit
                const streamId = parsed.stream?.streamId ?? prevSession?.streamId ?? ''
                const nextPreviewVersion =
                  'previewVersion' in payload &&
                  typeof payload.previewVersion === 'number' &&
                  Number.isFinite(payload.previewVersion)
                    ? payload.previewVersion
                    : (prevSession?.previewVersion ?? 0) + 1
                const baseSession: FilePreviewSession = {
                  schemaVersion: 1,
                  id,
                  streamId,
                  toolCallId: id,
                  status: prevSession?.status ?? 'pending',
                  fileName,
                  ...(fileId ? { fileId } : {}),
                  ...(targetKind ? { targetKind } : {}),
                  ...(operation ? { operation } : {}),
                  ...(edit ? { edit } : {}),
                  previewText: prevSession?.previewText ?? '',
                  previewVersion: prevSession?.previewVersion ?? 0,
                  updatedAt: prevSession?.updatedAt ?? new Date().toISOString(),
                  ...(prevSession?.completedAt ? { completedAt: prevSession.completedAt } : {}),
                }

                if (payload.previewPhase === 'file_preview_start') {
                  const nextSession: FilePreviewSession = {
                    ...baseSession,
                    status: 'pending',
                    updatedAt: new Date().toISOString(),
                  }
                  if (nextSession.fileId) {
                    setActiveResourceId(nextSession.fileId)
                  }
                  applyPreviewSessionUpdate(nextSession)
                  break
                }

                if (payload.previewPhase === 'file_preview_target') {
                  const nextSession: FilePreviewSession = {
                    ...baseSession,
                    updatedAt: new Date().toISOString(),
                  }
                  const nextState = applyPreviewSessionUpdate(nextSession)
                  const activePreview =
                    nextState.activeSessionId !== null
                      ? (nextState.sessions[nextState.activeSessionId] ?? null)
                      : null
                  if (activePreview?.id === nextSession.id) {
                    syncPreviewResourceChrome(activePreview)
                  }
                  break
                }

                if (payload.previewPhase === 'file_preview_edit_meta') {
                  const nextSession: FilePreviewSession = {
                    ...baseSession,
                    status: prevSession?.status ?? 'pending',
                    updatedAt: new Date().toISOString(),
                  }
                  applyPreviewSessionUpdate(nextSession)
                  break
                }

                if (payload.previewPhase === 'file_preview_content') {
                  const content = payload.content
                  const contentMode = payload.contentMode
                  const nextPreviewText =
                    contentMode === 'delta' ? (prevSession?.previewText ?? '') + content : content
                  const nextSession: FilePreviewSession = {
                    ...baseSession,
                    status: 'streaming',
                    previewText: nextPreviewText,
                    previewVersion: nextPreviewVersion,
                    updatedAt: new Date().toISOString(),
                  }
                  applyPreviewSessionUpdate(nextSession)
                  const previewToolIdx = toolMap.get(id)
                  if (previewToolIdx !== undefined && blocks[previewToolIdx].toolCall) {
                    blocks[previewToolIdx].toolCall!.status = 'executing'
                  }
                  break
                }

                if (payload.previewPhase === 'file_preview_complete') {
                  const resultData = asPayloadRecord(payload.output)
                  const completedAt = new Date().toISOString()
                  const nextSession: FilePreviewSession = {
                    ...baseSession,
                    status: 'complete',
                    previewVersion: payload.previewVersion ?? prevSession?.previewVersion ?? 0,
                    updatedAt: completedAt,
                    completedAt,
                  }
                  const nextState = applyCompletedPreviewSession(nextSession)

                  if (fileId && resultData?.id) {
                    const fileName = (resultData.name as string) ?? nextSession.fileName ?? 'File'
                    const fileResource = { type: 'file' as const, id: fileId, title: fileName }
                    setResources((rs) => {
                      const without = rs.filter((r) => r.id !== 'streaming-file')
                      if (without.some((r) => r.type === 'file' && r.id === fileResource.id)) {
                        return without
                      }
                      return [...without, fileResource]
                    })
                    setActiveResourceId(fileId)
                    if (nextSession.previewText) {
                      queryClient.setQueryData(
                        workspaceFilesKeys.content(workspaceId, fileId, 'text'),
                        nextSession.previewText
                      )
                    }
                    invalidateResourceQueries(queryClient, workspaceId, 'file', fileId)
                  } else {
                    const activePreview =
                      nextState.activeSessionId !== null
                        ? (nextState.sessions[nextState.activeSessionId] ?? null)
                        : null
                    if (activePreview) {
                      syncPreviewResourceChrome(activePreview)
                    }
                  }
                  break
                }
              }

              if (payload.phase === MothershipStreamV1ToolPhase.args_delta) {
                const delta = payload.argumentsDelta
                if (!delta) break

                const idx = toolMap.get(id)
                if (idx !== undefined && blocks[idx].toolCall) {
                  const tc = blocks[idx].toolCall!
                  tc.streamingArgs = (tc.streamingArgs ?? '') + delta
                  const displayTitle = resolveStreamingToolDisplayTitle(tc.name, tc.streamingArgs)
                  if (displayTitle) tc.displayTitle = displayTitle

                  flush()
                }
                break
              }

              if (payload.phase === MothershipStreamV1ToolPhase.result) {
                const idx = toolMap.get(id)
                if (idx === undefined || !blocks[idx].toolCall) {
                  break
                }
                const tc = blocks[idx].toolCall!
                const outputObj = asPayloadRecord(payload.output)
                const isCancelled =
                  outputObj?.reason === 'user_cancelled' ||
                  outputObj?.cancelledByUser === true ||
                  payload.status === MothershipStreamV1ToolOutcome.cancelled
                const status = isCancelled
                  ? ToolCallStatus.cancelled
                  : resolveLiveToolStatus(payload)
                const isSuccess = status === ToolCallStatus.success

                if (status === ToolCallStatus.cancelled) {
                  tc.status = ToolCallStatus.cancelled
                  tc.displayTitle = 'Stopped by user'
                } else {
                  tc.status = status
                }
                tc.streamingArgs = undefined
                tc.result = {
                  success: isSuccess,
                  output: payload.output,
                  error: typeof payload.error === 'string' ? payload.error : undefined,
                }
                flush()

                if (tc.name === ReadTool.id && tc.status === 'success') {
                  const readArgs = toolArgsMap.get(id)
                  const resource = extractResourceFromReadResult(
                    typeof readArgs?.path === 'string' ? readArgs.path : undefined,
                    tc.result.output
                  )
                  if (resource && addResource(resource)) {
                    onResourceEventRef.current?.()
                  }
                }

                if (DEPLOY_TOOL_NAMES.has(tc.name) && tc.status === 'success') {
                  const output = tc.result?.output as Record<string, unknown> | undefined
                  const deployedWorkflowId = (output?.workflowId as string) ?? undefined
                  if (deployedWorkflowId && typeof output?.isDeployed === 'boolean') {
                    queryClient.invalidateQueries({
                      queryKey: deploymentKeys.info(deployedWorkflowId),
                    })
                    queryClient.invalidateQueries({
                      queryKey: deploymentKeys.versions(deployedWorkflowId),
                    })
                    queryClient.invalidateQueries({
                      queryKey: workflowKeys.list(workspaceId),
                    })
                  }
                }

                if (FOLDER_TOOL_NAMES.has(tc.name) && tc.status === 'success') {
                  queryClient.invalidateQueries({
                    queryKey: folderKeys.list(workspaceId),
                  })
                }
                if (WORKFLOW_MUTATION_TOOL_NAMES.has(tc.name) && tc.status === 'success') {
                  queryClient.invalidateQueries({
                    queryKey: workflowKeys.list(workspaceId),
                  })
                }

                const extractedResources =
                  tc.status === 'success' && isResourceToolName(tc.name)
                    ? extractResourcesFromToolResult(
                        tc.name,
                        toolArgsMap.get(id) as Record<string, unknown> | undefined,
                        tc.result?.output
                      )
                    : []

                for (const resource of extractedResources) {
                  invalidateResourceQueries(queryClient, workspaceId, resource.type, resource.id)
                }

                onToolResultRef.current?.(tc.name, tc.status === 'success', tc.result?.output)

                const workspaceFileOperation =
                  tc.name === WorkspaceFile.id && typeof tc.params?.operation === 'string'
                    ? tc.params.operation
                    : undefined
                const shouldKeepWorkspacePreviewOpen =
                  tc.name === WorkspaceFile.id &&
                  (workspaceFileOperation === 'append' ||
                    workspaceFileOperation === 'update' ||
                    workspaceFileOperation === 'patch')

                if (
                  (tc.name === WorkspaceFile.id || tc.name === 'edit_content') &&
                  !shouldKeepWorkspacePreviewOpen
                ) {
                  if (tc.name === WorkspaceFile.id) {
                    removePreviewSessionImmediate(id)
                  }
                  const fileResource = extractedResources.find((r) => r.type === 'file')
                  if (fileResource) {
                    setResources((rs) => {
                      const without = rs.filter((r) => r.id !== 'streaming-file')
                      if (without.some((r) => r.type === 'file' && r.id === fileResource.id)) {
                        return without
                      }
                      return [...without, fileResource]
                    })
                    setActiveResourceId(fileResource.id)
                    invalidateResourceQueries(queryClient, workspaceId, 'file', fileResource.id)
                  } else if (tc.calledBy !== FILE_SUBAGENT_ID) {
                    setResources((rs) => rs.filter((r) => r.id !== 'streaming-file'))
                  }
                }
                break
              }

              const name = payload.toolName
              const isPartial =
                payload.partial === true ||
                payload.status === MothershipStreamV1ToolStatus.generating
              if (name === ToolSearchToolRegex.id || isToolHiddenInUi(name)) {
                break
              }
              const ui = getToolUI(payload.ui)
              if (ui?.hidden) break
              let displayTitle = ui?.title
              const args = payload.arguments as Record<string, unknown> | undefined

              displayTitle = resolveToolDisplayTitle(name, args) ?? displayTitle

              if (name === 'edit_content') {
                const parentToolCallId =
                  activePreviewSessionIdRef.current ?? previewSessionRef.current?.toolCallId
                const parentIdx =
                  parentToolCallId !== null && parentToolCallId !== undefined
                    ? toolMap.get(parentToolCallId)
                    : undefined
                if (parentIdx !== undefined && blocks[parentIdx].toolCall) {
                  toolMap.set(id, parentIdx)
                  const tc = blocks[parentIdx].toolCall!
                  tc.status = 'executing'
                  tc.result = undefined
                  flush()
                  break
                }
              }

              if (!toolMap.has(id)) {
                toolMap.set(id, blocks.length)
                blocks.push({
                  type: 'tool_call',
                  toolCall: {
                    id,
                    name,
                    status: 'executing',
                    displayTitle,
                    params: args,
                    calledBy: scopedSubagent,
                  },
                })
                if (name === ReadTool.id || isResourceToolName(name)) {
                  if (args) toolArgsMap.set(id, args)
                }
              } else {
                const idx = toolMap.get(id)!
                const tc = blocks[idx].toolCall
                if (tc) {
                  tc.name = name
                  if (displayTitle) tc.displayTitle = displayTitle
                  if (args) tc.params = args
                }
              }
              flush()

              if (isWorkflowToolName(name) && !isPartial) {
                startClientWorkflowTool(id, name, args ?? {})
              }
              break
            }
            case MothershipStreamV1EventType.resource: {
              const payload = parsed.payload
              const resource = payload.resource

              if (payload.op === MothershipStreamV1ResourceOp.remove) {
                removeResource(resource.type as MothershipResourceType, resource.id)
                invalidateResourceQueries(
                  queryClient,
                  workspaceId,
                  resource.type as MothershipResourceType,
                  resource.id
                )
                onResourceEventRef.current?.()
                break
              }

              const nextResource = {
                type: resource.type as MothershipResourceType,
                id: resource.id,
                title: typeof resource.title === 'string' ? resource.title : resource.id,
              }
              const wasAdded = addResource(nextResource)
              invalidateResourceQueries(
                queryClient,
                workspaceId,
                nextResource.type,
                nextResource.id
              )

              if (!wasAdded && activeResourceIdRef.current !== nextResource.id) {
                setActiveResourceId(nextResource.id)
              }
              onResourceEventRef.current?.()

              if (nextResource.type === 'workflow') {
                const wasRegistered = ensureWorkflowInRegistry(
                  nextResource.id,
                  nextResource.title,
                  workspaceId
                )
                if (wasAdded && wasRegistered) {
                  useWorkflowRegistry.getState().setActiveWorkflow(nextResource.id)
                } else {
                  useWorkflowRegistry.getState().loadWorkflowState(nextResource.id)
                }
              }
              break
            }
            case MothershipStreamV1EventType.run: {
              const payload = parsed.payload
              if (payload.kind === MothershipStreamV1RunKind.compaction_start) {
                const compactionId = `compaction_${Date.now()}`
                activeCompactionId = compactionId
                toolMap.set(compactionId, blocks.length)
                blocks.push({
                  type: 'tool_call',
                  toolCall: {
                    id: compactionId,
                    name: 'context_compaction',
                    status: 'executing',
                    displayTitle: 'Compacting context...',
                  },
                })
                flush()
              } else if (payload.kind === MothershipStreamV1RunKind.compaction_done) {
                const compactionId = activeCompactionId || `compaction_${Date.now()}`
                activeCompactionId = undefined
                const idx = toolMap.get(compactionId)
                if (idx !== undefined && blocks[idx]?.toolCall) {
                  blocks[idx].toolCall!.status = 'success'
                  blocks[idx].toolCall!.displayTitle = 'Compacted context'
                } else {
                  toolMap.set(compactionId, blocks.length)
                  blocks.push({
                    type: 'tool_call',
                    toolCall: {
                      id: compactionId,
                      name: 'context_compaction',
                      status: 'success',
                      displayTitle: 'Compacted context',
                    },
                  })
                }
                flush()
              }
              break
            }
            case MothershipStreamV1EventType.span: {
              const payload = parsed.payload
              if (payload.kind !== MothershipStreamV1SpanPayloadKind.subagent) {
                break
              }
              const spanData = asPayloadRecord(payload.data)
              const parentToolCallId =
                scopedParentToolCallId ??
                (typeof spanData?.tool_call_id === 'string' ? spanData.tool_call_id : undefined)
              const isPendingPause = spanData?.pending === true
              const name = typeof payload.agent === 'string' ? payload.agent : scopedAgentId
              if (payload.event === MothershipStreamV1SpanLifecycleEvent.start && name) {
                const isSameActiveSubagent =
                  activeSubagent === name &&
                  activeSubagentParentToolCallId &&
                  parentToolCallId === activeSubagentParentToolCallId
                if (parentToolCallId) {
                  subagentByParentToolCallId.set(parentToolCallId, name)
                }
                activeSubagent = name
                activeSubagentParentToolCallId = parentToolCallId
                if (!isSameActiveSubagent) {
                  blocks.push({ type: 'subagent', content: name })
                }
                if (name === FILE_SUBAGENT_ID && !isSameActiveSubagent) {
                  applyPreviewSessionUpdate({
                    schemaVersion: 1,
                    id: parentToolCallId || 'file-preview',
                    streamId: streamIdRef.current ?? '',
                    toolCallId: parentToolCallId || 'file-preview',
                    status: 'pending',
                    fileName: '',
                    previewText: '',
                    previewVersion: 0,
                    updatedAt: new Date().toISOString(),
                  })
                }
                flush()
              } else if (payload.event === MothershipStreamV1SpanLifecycleEvent.end) {
                if (isPendingPause) {
                  break
                }
                if (parentToolCallId) {
                  subagentByParentToolCallId.delete(parentToolCallId)
                }
                if (previewSessionRef.current && !activePreviewSessionIdRef.current) {
                  const lastFileResource = resourcesRef.current.find(
                    (r) => r.type === 'file' && r.id !== 'streaming-file'
                  )
                  setResources((rs) => rs.filter((r) => r.id !== 'streaming-file'))
                  if (lastFileResource) {
                    setActiveResourceId(lastFileResource.id)
                  }
                }
                if (
                  !parentToolCallId ||
                  parentToolCallId === activeSubagentParentToolCallId ||
                  name === activeSubagent
                ) {
                  activeSubagent = undefined
                  activeSubagentParentToolCallId = undefined
                }
                blocks.push({ type: 'subagent_end' })
                flush()
              }
              break
            }
            case MothershipStreamV1EventType.error: {
              sawStreamError = true
              setError(parsed.payload.message || parsed.payload.error || 'An error occurred')
              appendInlineErrorTag(buildInlineErrorTag(parsed.payload), scopedSubagent)
              break
            }
            case MothershipStreamV1EventType.complete: {
              sawCompleteEvent = true
              // `complete` is the end-of-turn marker; drain whatever
              // else arrived in the same TCP chunk (trailing text,
              // followups, run metadata) before stopping. Do NOT
              // await another read — events after `complete` would
              // be a server bug.
              continue
            }
          }
        }
      } finally {
        if (scheduledTextFlushFrame !== null) {
          cancelAnimationFrame(scheduledTextFlushFrame)
          scheduledTextFlushFrame = null
          flush()
        }
        if (streamReaderRef.current === reader) {
          streamReaderRef.current = null
        }
      }
      return { sawStreamError, sawComplete: sawCompleteEvent }
    },
    [
      workspaceId,
      router,
      queryClient,
      upsertTaskChatHistory,
      addResource,
      removeResource,
      applyPreviewSessionUpdate,
      applyCompletedPreviewSession,
      removePreviewSessionImmediate,
      syncPreviewResourceChrome,
    ]
  )
  processSSEStreamRef.current = processSSEStream

  const getActiveStreamIdForChat = useCallback(
    async (chatId: string): Promise<string | null> => {
      const cached = queryClient.getQueryData<TaskChatHistory>(taskKeys.detail(chatId))
      if (cached?.activeStreamId) {
        return cached.activeStreamId
      }

      try {
        const history = await fetchChatHistory(chatId)
        queryClient.setQueryData(taskKeys.detail(chatId), history)
        return history.activeStreamId ?? null
      } catch (error) {
        logger.warn('Failed to load chat history while recovering stream', {
          chatId,
          error: toError(error).message,
        })
        return null
      }
    },
    [queryClient]
  )

  const fetchStreamBatch = useCallback(
    async (
      streamId: string,
      afterCursor: string,
      signal?: AbortSignal
    ): Promise<StreamBatchResponse> => {
      const response = await fetch(
        `/api/mothership/chat/stream?streamId=${encodeURIComponent(streamId)}&after=${encodeURIComponent(afterCursor)}&batch=true`,
        {
          signal,
          ...(streamTraceparentRef.current
            ? { headers: { traceparent: streamTraceparentRef.current } }
            : {}),
        }
      )
      if (!response.ok) {
        throw new Error(`Stream resume batch failed: ${response.status}`)
      }
      const batch = parseStreamBatchResponse(await response.json())
      if (Array.isArray(batch.previewSessions) && batch.previewSessions.length > 0) {
        seedPreviewSessions(batch.previewSessions)
      }
      return batch
    },
    [seedPreviewSessions]
  )

  const attachToExistingStream = useCallback(
    async (opts: {
      streamId: string
      assistantId: string
      expectedGen: number
      initialBatch?: StreamBatchResponse | null
      afterCursor?: string
    }): Promise<{ error: boolean; aborted: boolean }> => {
      const { streamId, assistantId, expectedGen, afterCursor = '0' } = opts
      let latestCursor = afterCursor
      let seedEvents = opts.initialBatch?.events ?? []
      let streamStatus = opts.initialBatch?.status ?? 'unknown'

      const isStaleReconnect = () =>
        streamGenRef.current !== expectedGen || abortControllerRef.current?.signal.aborted === true

      if (isStaleReconnect()) {
        return { error: false, aborted: true }
      }

      setTransportReconnecting()
      setError(null)

      try {
        while (streamGenRef.current === expectedGen) {
          if (seedEvents.length > 0) {
            const replayResult = await processSSEStreamRef.current(
              buildReplayStream(seedEvents).getReader(),
              assistantId,
              expectedGen,
              { preserveExistingState: true }
            )
            latestCursor = String(seedEvents[seedEvents.length - 1]?.eventId ?? latestCursor)
            lastCursorRef.current = latestCursor
            seedEvents = []

            if (replayResult.sawStreamError) {
              return { error: true, aborted: false }
            }
          }

          if (isTerminalStreamStatus(streamStatus)) {
            if (streamStatus === 'error') {
              setError(RECONNECT_TAIL_ERROR)
            }
            return { error: streamStatus === 'error', aborted: false }
          }

          const activeAbort = abortControllerRef.current
          if (!activeAbort || activeAbort.signal.aborted) {
            return { error: false, aborted: true }
          }

          logger.info('Opening live stream tail', { streamId, afterCursor: latestCursor })

          const sseRes = await fetch(
            `/api/mothership/chat/stream?streamId=${encodeURIComponent(streamId)}&after=${encodeURIComponent(latestCursor)}`,
            {
              signal: activeAbort.signal,
              ...(streamTraceparentRef.current
                ? { headers: { traceparent: streamTraceparentRef.current } }
                : {}),
            }
          )
          if (!sseRes.ok || !sseRes.body) {
            throw new Error(RECONNECT_TAIL_ERROR)
          }

          if (isStaleReconnect()) {
            return { error: false, aborted: true }
          }

          setTransportStreaming()

          const liveResult = await processSSEStreamRef.current(
            sseRes.body.getReader(),
            assistantId,
            expectedGen,
            { preserveExistingState: true }
          )

          if (liveResult.sawStreamError) {
            return { error: true, aborted: false }
          }

          if (liveResult.sawComplete) {
            return { error: false, aborted: false }
          }

          if (isStaleReconnect()) {
            return { error: false, aborted: true }
          }

          setTransportReconnecting()

          latestCursor = lastCursorRef.current || latestCursor

          logger.warn('Live stream ended without terminal event, fetching batch', {
            streamId,
            latestCursor,
          })

          const batch = await fetchStreamBatch(streamId, latestCursor, activeAbort.signal)
          seedEvents = batch.events
          streamStatus = batch.status

          if (batch.events.length > 0) {
            latestCursor = String(batch.events[batch.events.length - 1].eventId)
            lastCursorRef.current = latestCursor
          }

          if (batch.events.length === 0 && !isTerminalStreamStatus(batch.status)) {
            if (activeAbort.signal.aborted || streamGenRef.current !== expectedGen) {
              return { error: false, aborted: true }
            }
          }
        }

        return { error: false, aborted: true }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return { error: false, aborted: true }
        }
        throw err
      } finally {
        if (streamGenRef.current === expectedGen) {
          if (sendingRef.current) {
            setIsReconnecting(false)
          } else {
            setTransportIdle()
          }
        }
      }
    },
    [fetchStreamBatch, setTransportIdle, setTransportReconnecting, setTransportStreaming]
  )
  attachToExistingStreamRef.current = attachToExistingStream

  const resumeOrFinalize = useCallback(
    async (opts: {
      streamId: string
      assistantId: string
      gen: number
      afterCursor: string
      signal?: AbortSignal
    }): Promise<void> => {
      const { streamId, assistantId, gen, afterCursor, signal } = opts

      const batch = await fetchStreamBatch(streamId, afterCursor, signal)
      if (streamGenRef.current !== gen) return

      if (isTerminalStreamStatus(batch.status)) {
        if (batch.events.length > 0) {
          await processSSEStreamRef.current(
            buildReplayStream(batch.events).getReader(),
            assistantId,
            gen,
            { preserveExistingState: true }
          )
        }
        finalizeRef.current(batch.status === 'error' ? { error: true } : undefined)
        return
      }

      const reconnectResult = await attachToExistingStream({
        streamId,
        assistantId,
        expectedGen: gen,
        initialBatch: batch,
        afterCursor:
          batch.events.length > 0
            ? String(batch.events[batch.events.length - 1].eventId)
            : afterCursor,
      })

      if (streamGenRef.current === gen && !reconnectResult.aborted) {
        finalizeRef.current(reconnectResult.error ? { error: true } : undefined)
      } else if (streamGenRef.current === gen && reconnectResult.aborted && !sendingRef.current) {
        setTransportIdle()
      }
    },
    [fetchStreamBatch, attachToExistingStream, setTransportIdle]
  )

  const retryReconnect = useCallback(
    async (opts: { streamId: string; assistantId: string; gen: number }): Promise<boolean> => {
      const { streamId, assistantId, gen } = opts

      const isStaleReconnect = () =>
        streamGenRef.current !== gen || abortControllerRef.current?.signal.aborted === true

      for (let attempt = 0; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
        if (isStaleReconnect()) return true

        if (attempt > 0) {
          const delayMs = Math.min(
            RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1),
            RECONNECT_MAX_DELAY_MS
          )
          logger.warn('Reconnect attempt', {
            streamId,
            attempt,
            maxAttempts: MAX_RECONNECT_ATTEMPTS,
            delayMs,
          })

          if (isStaleReconnect()) return true

          setTransportReconnecting()
          await sleep(delayMs)
          if (streamGenRef.current !== gen) {
            if (!sendingRef.current) {
              setTransportIdle()
            } else {
              setIsReconnecting(false)
            }
            return true
          }
          if (abortControllerRef.current?.signal.aborted) {
            if (!sendingRef.current) {
              setTransportIdle()
            } else {
              setIsReconnecting(false)
            }
            return true
          }
        }

        try {
          await resumeOrFinalize({
            streamId,
            assistantId,
            gen,
            afterCursor: lastCursorRef.current || '0',
            signal: abortControllerRef.current?.signal,
          })
          if (streamGenRef.current !== gen) {
            if (!sendingRef.current) {
              setTransportIdle()
            } else {
              setIsReconnecting(false)
            }
            return true
          }
          if (abortControllerRef.current?.signal.aborted) {
            if (!sendingRef.current) {
              setTransportIdle()
            } else {
              setIsReconnecting(false)
            }
            return true
          }
          if (!sendingRef.current) {
            setTransportIdle()
            return true
          }
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') {
            if (!sendingRef.current) {
              setTransportIdle()
            } else {
              setIsReconnecting(false)
            }
            return true
          }
          if (isStreamSchemaValidationError(err)) {
            logger.error('Reconnect halted by client-side stream schema enforcement', {
              streamId,
              attempt: attempt + 1,
              error: err.message,
            })
            if (streamGenRef.current === gen) {
              setError(err.message)
            }
            return false
          }
          logger.warn('Reconnect attempt failed', {
            streamId,
            attempt: attempt + 1,
            error: toError(err).message,
          })
        }
      }

      logger.error('All reconnect attempts exhausted', {
        streamId,
        maxAttempts: MAX_RECONNECT_ATTEMPTS,
      })
      if (streamGenRef.current === gen) {
        setIsReconnecting(false)
      }
      return false
    },
    [resumeOrFinalize, setTransportIdle, setTransportReconnecting]
  )
  retryReconnectRef.current = retryReconnect

  const persistPartialResponse = useCallback(
    async (overrides?: {
      chatId?: string
      streamId?: string
      content?: string
      blocks?: ContentBlock[]
      // `stopGeneration` must snapshot these BEFORE clearActiveTurn()
      // nulls the refs, or the fetch sees undefined.
      requestId?: string
      traceparent?: string
    }) => {
      const chatId = overrides?.chatId ?? chatIdRef.current
      const streamId = overrides?.streamId ?? streamIdRef.current
      if (!chatId || !streamId) return

      const content = overrides?.content ?? streamingContentRef.current
      const requestId = overrides?.requestId ?? streamRequestIdRef.current
      const traceparent = overrides?.traceparent ?? streamTraceparentRef.current

      const sourceBlocks = overrides?.blocks ?? streamingBlocksRef.current
      const storedBlocks = sourceBlocks.map((block) => {
        if (block.type === 'tool_call' && block.toolCall) {
          const isCancelled =
            block.toolCall.status === 'executing' || block.toolCall.status === 'cancelled'
          const displayTitle = isCancelled ? 'Stopped by user' : block.toolCall.displayTitle
          const display = displayTitle ? { title: displayTitle } : undefined
          return {
            type: block.type,
            content: block.content,
            toolCall: {
              id: block.toolCall.id,
              name: block.toolCall.name,
              state: isCancelled ? MothershipStreamV1ToolOutcome.cancelled : block.toolCall.status,
              params: block.toolCall.params,
              result: block.toolCall.result,
              ...(display ? { display } : {}),
              calledBy: block.toolCall.calledBy,
            },
          }
        }
        return { type: block.type, content: block.content }
      })

      if (storedBlocks.length > 0) {
        storedBlocks.push({ type: 'stopped', content: undefined })
      }

      try {
        const res = await fetch(stopPathRef.current, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(traceparent ? { traceparent } : {}),
          },
          body: JSON.stringify({
            chatId,
            streamId,
            content,
            ...(storedBlocks.length > 0 && { contentBlocks: storedBlocks }),
            ...(requestId ? { requestId } : {}),
          }),
        })
        if (!res.ok) {
          const payload = await res.json().catch(() => null)
          throw new Error(
            typeof payload?.error === 'string'
              ? payload.error
              : 'Failed to persist partial response'
          )
        }
        if (!overrides || streamIdRef.current === streamId) {
          streamingContentRef.current = ''
          streamingBlocksRef.current = []
        }
      } catch (err) {
        logger.warn('Failed to persist partial response', err)
        throw err instanceof Error ? err : new Error('Failed to persist partial response')
      }
    },
    []
  )

  const invalidateChatQueries = useCallback(
    (options?: { includeDetail?: boolean }) => {
      const activeChatId = chatIdRef.current
      if (options?.includeDetail !== false && activeChatId) {
        queryClient.invalidateQueries({
          queryKey: taskKeys.detail(activeChatId),
        })
      }
      queryClient.invalidateQueries({ queryKey: taskKeys.list(workspaceId) })
    },
    [workspaceId, queryClient]
  )

  const messagesRef = useRef(messages)
  messagesRef.current = messages

  /**
   * Notify downstream consumers that a turn has ended and, if a
   * follow-up message is queued, kick the dispatcher. Safe to call
   * from both the normal-completion path (`finalize`) and the
   * abort/stop path (`stopGeneration`), which previously short-
   * circuited without notifying — queued messages then sat until the
   * user manually re-sent. Idempotent w.r.t. `onStreamEnd` (one call
   * per terminal transition); the dispatcher itself de-dupes.
   */
  const notifyTurnEnded = useCallback(
    (options: { error: boolean; skipQueueDispatch?: boolean }) => {
      const hasQueuedFollowUp = !options.error && messageQueueRef.current.length > 0
      if (!options.error) {
        const cid = chatIdRef.current
        if (cid && onStreamEndRef.current) {
          onStreamEndRef.current(cid, messagesRef.current)
        }
      }
      if (!options.error && !options.skipQueueDispatch && hasQueuedFollowUp) {
        void enqueueQueueDispatchRef.current({ type: 'send_head' })
      }
      return hasQueuedFollowUp
    },
    []
  )

  const finalize = useCallback(
    (options?: { error?: boolean }) => {
      const isError = !!options?.error
      const hasQueuedFollowUp = !isError && messageQueueRef.current.length > 0
      reconcileTerminalPreviewSessions()
      locallyTerminalStreamIdRef.current =
        streamIdRef.current ?? activeTurnRef.current?.userMessageId ?? undefined
      clearActiveTurn()
      setTransportIdle()
      abortControllerRef.current = null
      invalidateChatQueries({ includeDetail: !hasQueuedFollowUp })
      notifyTurnEnded({ error: isError })
    },
    [
      clearActiveTurn,
      invalidateChatQueries,
      notifyTurnEnded,
      reconcileTerminalPreviewSessions,
      setTransportIdle,
    ]
  )
  finalizeRef.current = finalize

  const startSendMessage = useCallback(
    async (
      message: string,
      fileAttachments?: FileAttachmentForApi[],
      contexts?: ChatContext[],
      pendingStopOverride?: Promise<void> | null,
      onOptimisticSendApplied?: () => void,
      queuedSendHandoff?: QueuedSendHandoffSeed
    ) => {
      if (!message.trim() || !workspaceId) return false
      const pendingStop = pendingStopOverride ?? pendingStopPromiseRef.current

      const gen = ++streamGenRef.current
      let consumedByTranscript = false

      setError(null)
      setTransportStreaming()
      locallyTerminalStreamIdRef.current = undefined

      const userMessageId = queuedSendHandoff?.userMessageId ?? generateId()
      const assistantId = getLiveAssistantMessageId(userMessageId)

      streamIdRef.current = userMessageId
      lastCursorRef.current = '0'
      resetStreamingBuffers()

      const storedAttachments: PersistedFileAttachment[] | undefined =
        fileAttachments && fileAttachments.length > 0
          ? fileAttachments.map((f) => ({
              id: f.id,
              key: f.key,
              filename: f.filename,
              media_type: f.media_type,
              size: f.size,
            }))
          : undefined

      const requestChatId = selectedChatIdRef.current ?? chatIdRef.current
      if (queuedSendHandoff) {
        writeQueuedSendHandoffState({
          id: queuedSendHandoff.id,
          chatId: queuedSendHandoff.chatId,
          workspaceId,
          supersededStreamId: queuedSendHandoff.supersededStreamId,
          userMessageId,
          message,
          ...(fileAttachments ? { fileAttachments } : {}),
          ...(contexts ? { contexts } : {}),
          requestedAt: Date.now(),
        })
      }
      const messageContexts = contexts?.map((c) => ({
        kind: c.kind,
        label: c.label,
        ...('workflowId' in c && c.workflowId ? { workflowId: c.workflowId } : {}),
        ...('knowledgeId' in c && c.knowledgeId ? { knowledgeId: c.knowledgeId } : {}),
        ...('tableId' in c && c.tableId ? { tableId: c.tableId } : {}),
        ...('fileId' in c && c.fileId ? { fileId: c.fileId } : {}),
        ...('folderId' in c && c.folderId ? { folderId: c.folderId } : {}),
      }))
      const cachedUserMsg: PersistedMessage = {
        id: userMessageId,
        role: 'user' as const,
        content: message,
        timestamp: new Date().toISOString(),
        ...(storedAttachments && { fileAttachments: storedAttachments }),
        ...(messageContexts && messageContexts.length > 0 ? { contexts: messageContexts } : {}),
      }
      pendingUserMsgRef.current = cachedUserMsg

      const userAttachments = storedAttachments?.map((f) => ({
        id: f.id,
        filename: f.filename,
        media_type: f.media_type,
        size: f.size,
        previewUrl: f.media_type.startsWith('image/')
          ? `/api/files/serve/${encodeURIComponent(f.key)}?context=mothership`
          : undefined,
      }))

      const optimisticUserMessage: ChatMessage = {
        id: userMessageId,
        role: 'user',
        content: message,
        attachments: userAttachments,
        ...(messageContexts && messageContexts.length > 0 ? { contexts: messageContexts } : {}),
      }
      const optimisticAssistantMessage: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        contentBlocks: [],
      }
      activeTurnRef.current = {
        userMessageId,
        assistantMessageId: assistantId,
        optimisticUserMessage,
        optimisticAssistantMessage,
      }

      if (requestChatId) {
        await queryClient.cancelQueries({ queryKey: taskKeys.detail(requestChatId) })
      }

      const applyOptimisticSend = () => {
        const assistantSnapshot = buildAssistantSnapshotMessage({
          id: assistantId,
          content: '',
          contentBlocks: [],
        })
        if (requestChatId) {
          upsertTaskChatHistory(requestChatId, (current) => ({
            ...current,
            resources: current.resources.filter((resource) => resource.id !== 'streaming-file'),
            messages: [
              ...current.messages.filter(
                (persistedMessage) =>
                  persistedMessage.id !== userMessageId && persistedMessage.id !== assistantId
              ),
              cachedUserMsg,
              assistantSnapshot,
            ],
            activeStreamId: userMessageId,
          }))
        }

        setPendingMessages((prev) => {
          const nextMessages = prev.filter((m) => m.id !== userMessageId && m.id !== assistantId)
          return [...nextMessages, optimisticUserMessage, optimisticAssistantMessage]
        })
      }

      const rollbackOptimisticSend = () => {
        if (requestChatId) {
          upsertTaskChatHistory(requestChatId, (current) => ({
            ...current,
            messages: current.messages.filter(
              (persistedMessage) =>
                persistedMessage.id !== userMessageId && persistedMessage.id !== assistantId
            ),
            activeStreamId:
              current.activeStreamId === userMessageId ? null : current.activeStreamId,
          }))
        }

        setPendingMessages((prev) =>
          prev.filter(
            (pendingMessage) =>
              pendingMessage.id !== userMessageId && pendingMessage.id !== assistantId
          )
        )
      }

      applyOptimisticSend()
      onOptimisticSendApplied?.()
      consumedByTranscript = true

      const abortController = new AbortController()
      abortControllerRef.current = abortController

      try {
        if (pendingStop) {
          try {
            await pendingStop
            if (requestChatId) {
              await queryClient.cancelQueries({ queryKey: taskKeys.detail(requestChatId) })
            }
            applyOptimisticSend()
          } catch (err) {
            rollbackOptimisticSend()
            abortControllerRef.current = null
            clearActiveTurn()
            setTransportIdle()
            setError(err instanceof Error ? err.message : 'Failed to stop the previous response')
            return false
          }
        }

        const currentActiveId = activeResourceIdRef.current
        const currentResources = resourcesRef.current
        const resourceAttachments =
          currentResources.length > 0
            ? currentResources.map((r) => ({
                type: r.type,
                id: r.id,
                title: r.title,
                active: r.id === currentActiveId,
              }))
            : undefined

        const response = await fetch(apiPathRef.current, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            workspaceId,
            userMessageId,
            createNewChat: !requestChatId,
            ...(requestChatId ? { chatId: requestChatId } : {}),
            ...(fileAttachments && fileAttachments.length > 0 ? { fileAttachments } : {}),
            ...(resourceAttachments ? { resourceAttachments } : {}),
            ...(contexts && contexts.length > 0 ? { contexts } : {}),
            ...(workflowIdRef.current ? { workflowId: workflowIdRef.current } : {}),
            userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
          signal: abortController.signal,
        })

        // Capture for propagation on side-channel calls + non-React
        // tool-completion callbacks (via trace-context singleton).
        const traceparent = response.headers.get('traceparent')
        if (traceparent) {
          streamTraceparentRef.current = traceparent
          setCurrentChatTraceparent(traceparent)
        }

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          if (response.status === 409) {
            const conflictStreamId =
              typeof errorData.activeStreamId === 'string'
                ? errorData.activeStreamId
                : userMessageId
            streamIdRef.current = conflictStreamId
            const succeeded = await retryReconnect({
              streamId: conflictStreamId,
              assistantId,
              gen,
            })
            if (succeeded) return consumedByTranscript
            if (streamGenRef.current === gen) {
              finalize({ error: true })
            }
            return consumedByTranscript
          }
          throw new Error(errorData.error || `Request failed: ${response.status}`)
        }

        if (queuedSendHandoff) {
          clearQueuedSendHandoffState(queuedSendHandoff.id)
        }

        if (!response.body) throw new Error('No response body')

        const streamResult = await processSSEStream(response.body.getReader(), assistantId, gen)
        if (streamGenRef.current === gen) {
          if (streamResult.sawStreamError) {
            finalize({ error: true })
            return consumedByTranscript
          }

          // A live SSE `complete` event is already terminal. Finalize immediately so follow-up
          // sends do not get spuriously queued behind an already-finished response.
          if (streamResult.sawComplete) {
            finalize()
            return consumedByTranscript
          }

          await resumeOrFinalize({
            streamId: streamIdRef.current || userMessageId,
            assistantId,
            gen,
            afterCursor: lastCursorRef.current || '0',
            signal: abortController.signal,
          })
          if (streamGenRef.current === gen && sendingRef.current) {
            finalize()
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return consumedByTranscript
        if (isStreamSchemaValidationError(err)) {
          setError(err.message)
          if (streamGenRef.current === gen) {
            finalize({ error: true })
          }
          return consumedByTranscript
        }

        const activeStreamId = streamIdRef.current
        if (activeStreamId && streamGenRef.current === gen) {
          const succeeded = await retryReconnect({
            streamId: activeStreamId,
            assistantId,
            gen,
          })
          if (succeeded) return consumedByTranscript
        }

        setError(err instanceof Error ? err.message : 'Failed to send message')
        if (streamGenRef.current === gen) {
          finalize({ error: true })
        }
        return consumedByTranscript
      }
      return consumedByTranscript
    },
    [
      workspaceId,
      queryClient,
      upsertTaskChatHistory,
      processSSEStream,
      finalize,
      resumeOrFinalize,
      retryReconnect,
      clearActiveTurn,
      resetStreamingBuffers,
      setTransportIdle,
      setTransportStreaming,
    ]
  )
  const sendMessage = useCallback(
    async (message: string, fileAttachments?: FileAttachmentForApi[], contexts?: ChatContext[]) => {
      if (!message.trim() || !workspaceId) return

      if (sendingRef.current) {
        const queued: QueuedMessage = {
          id: generateId(),
          content: message,
          fileAttachments,
          contexts,
        }
        setMessageQueue((prev) => [...prev, queued])
        return
      }

      await startSendMessage(message, fileAttachments, contexts)
    },
    [workspaceId, startSendMessage]
  )
  useEffect(() => {
    if (typeof window === 'undefined') return

    const clearClaim = () => {
      clearQueuedSendHandoffClaim()
    }

    window.addEventListener('pagehide', clearClaim)
    window.addEventListener('beforeunload', clearClaim)
    return () => {
      window.removeEventListener('pagehide', clearClaim)
      window.removeEventListener('beforeunload', clearClaim)
    }
  }, [])
  useEffect(() => {
    if (!workspaceId || !chatHistory || sendingRef.current || pendingStopPromiseRef.current) return

    const handoff = readQueuedSendHandoffState()
    if (!handoff) return
    if (handoff.workspaceId !== workspaceId || handoff.chatId !== chatHistory.id) return
    if (recoveringQueuedSendHandoffIdRef.current === handoff.id) return
    if (readQueuedSendHandoffClaim() === handoff.id) return

    if (
      chatHistory.activeStreamId === handoff.userMessageId ||
      chatHistory.messages.some((message) => message.id === handoff.userMessageId)
    ) {
      clearQueuedSendHandoffState(handoff.id)
      clearQueuedSendHandoffClaim(handoff.id)
      return
    }

    if (chatHistory.activeStreamId === handoff.supersededStreamId) {
      return
    }

    if (chatHistory.activeStreamId && chatHistory.activeStreamId !== handoff.supersededStreamId) {
      clearQueuedSendHandoffState(handoff.id)
      clearQueuedSendHandoffClaim(handoff.id)
      return
    }

    recoveringQueuedSendHandoffIdRef.current = handoff.id
    writeQueuedSendHandoffClaim(handoff.id)
    void startSendMessage(
      handoff.message,
      handoff.fileAttachments,
      handoff.contexts,
      null,
      undefined,
      {
        id: handoff.id,
        chatId: handoff.chatId,
        supersededStreamId: handoff.supersededStreamId,
        userMessageId: handoff.userMessageId,
      }
    ).finally(() => {
      if (recoveringQueuedSendHandoffIdRef.current === handoff.id) {
        recoveringQueuedSendHandoffIdRef.current = null
      }
      clearQueuedSendHandoffClaim(handoff.id)
    })
  }, [workspaceId, chatHistory, startSendMessage])
  const cancelActiveWorkflowExecutions = useCallback(() => {
    const execState = useExecutionStore.getState()
    const consoleStore = useTerminalConsoleStore.getState()

    for (const [workflowId, wfExec] of execState.workflowExecutions) {
      if (!wfExec.isExecuting) continue

      const toolCallId = markRunToolManuallyStopped(workflowId)
      cancelRunToolExecution(workflowId)

      const executionId = execState.getCurrentExecutionId(workflowId)
      if (executionId) {
        execState.setCurrentExecutionId(workflowId, null)
        fetch(`/api/workflows/${workflowId}/executions/${executionId}/cancel`, {
          method: 'POST',
        }).catch(() => {})
      }

      consoleStore.cancelRunningEntries(workflowId)
      const now = new Date()
      consoleStore.addConsole({
        input: {},
        output: {},
        success: false,
        error: 'Run was cancelled',
        durationMs: 0,
        startedAt: now.toISOString(),
        executionOrder: Number.MAX_SAFE_INTEGER,
        endedAt: now.toISOString(),
        workflowId,
        blockId: 'cancelled',
        executionId: executionId ?? undefined,
        blockName: 'Run Cancelled',
        blockType: 'cancelled',
      })

      executionStream.cancel(workflowId)
      execState.setIsExecuting(workflowId, false)
      execState.setIsDebugging(workflowId, false)
      execState.setActiveBlocks(workflowId, new Set())

      reportManualRunToolStop(workflowId, toolCallId).catch(() => {})
    }
  }, [executionStream])

  const stopGeneration = useCallback(async () => {
    if (pendingStopPromiseRef.current) {
      return pendingStopPromiseRef.current
    }

    const wasSending = sendingRef.current
    const activeChatId = chatIdRef.current
    const sid =
      streamIdRef.current ||
      activeTurnRef.current?.userMessageId ||
      queryClient.getQueryData<TaskChatHistory>(taskKeys.detail(chatIdRef.current))
        ?.activeStreamId ||
      undefined
    const stopContentSnapshot = streamingContentRef.current
    const stopBlocksSnapshot = streamingBlocksRef.current.map((block) => ({
      ...block,
      ...(block.options ? { options: [...block.options] } : {}),
      ...(block.toolCall ? { toolCall: { ...block.toolCall } } : {}),
    }))
    // Snapshot BEFORE clearActiveTurn() nulls the refs. Both
    // persistPartialResponse and the abort/stop fetches run inside
    // stopBarrier below, after several awaits — the refs are long
    // gone by the time the fetches serialize their headers.
    const stopRequestIdSnapshot = streamRequestIdRef.current
    const stopTraceparentSnapshot = streamTraceparentRef.current

    locallyTerminalStreamIdRef.current = sid
    streamGenRef.current++
    clearActiveTurn()
    streamReaderRef.current?.cancel().catch(() => {})
    streamReaderRef.current = null
    abortControllerRef.current?.abort('user_stop:client_stopGeneration')
    abortControllerRef.current = null
    setTransportIdle()

    if (activeChatId) {
      await queryClient.cancelQueries({ queryKey: taskKeys.detail(activeChatId) })
      upsertTaskChatHistory(activeChatId, (current) => ({
        ...current,
        messages: current.messages.map(markMessageStopped),
      }))
    } else {
      setPendingMessages((prev) =>
        prev.map((msg) => {
          if (!msg.contentBlocks?.some((block) => block.toolCall?.status === 'executing')) {
            return msg
          }
          const updatedBlocks = msg.contentBlocks.map((block) => {
            if (block.toolCall?.status !== 'executing') {
              return block
            }
            return {
              ...block,
              toolCall: {
                ...block.toolCall,
                status: 'cancelled' as const,
                displayTitle: 'Stopped by user',
              },
            }
          })
          updatedBlocks.push({ type: 'stopped' as const })
          return { ...msg, contentBlocks: updatedBlocks }
        })
      )
    }

    // Cancel active run-tool executions before waiting for the server-side stream
    // shutdown barrier; otherwise the abort settle can sit behind tool execution teardown.
    cancelActiveWorkflowExecutions()

    const stopBarrier = (async () => {
      try {
        if (wasSending && !chatIdRef.current) {
          const start = Date.now()
          while (!chatIdRef.current && Date.now() - start < 3000) {
            await new Promise((r) => setTimeout(r, 50))
          }
        }

        const resolvedChatId = chatIdRef.current
        const abortPromise = sid
          ? (async () => {
              const res = await fetch('/api/mothership/chat/abort', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(stopTraceparentSnapshot ? { traceparent: stopTraceparentSnapshot } : {}),
                },
                body: JSON.stringify({
                  streamId: sid,
                  ...(resolvedChatId ? { chatId: resolvedChatId } : {}),
                }),
              })
              if (!res.ok) {
                const payload = await res.json().catch(() => null)
                throw new Error(
                  typeof payload?.error === 'string'
                    ? payload.error
                    : 'Failed to abort previous response'
                )
              }
            })()
          : Promise.resolve()

        if (wasSending && resolvedChatId) {
          await persistPartialResponse({
            chatId: resolvedChatId,
            streamId: sid,
            content: stopContentSnapshot,
            blocks: stopBlocksSnapshot,
            requestId: stopRequestIdSnapshot,
            traceparent: stopTraceparentSnapshot,
          })
        }

        await abortPromise
      } finally {
        invalidateChatQueries()
        resetEphemeralPreviewState({ removeStreamingResource: true })
      }
    })()

    pendingStopPromiseRef.current = stopBarrier
    try {
      await stopBarrier
      // Dispatch queued follow-ups after Stop resolves.
      notifyTurnEnded({ error: false })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop the previous response')
      throw err
    } finally {
      if (pendingStopPromiseRef.current === stopBarrier) {
        pendingStopPromiseRef.current = null
      }
    }
  }, [
    cancelActiveWorkflowExecutions,
    invalidateChatQueries,
    notifyTurnEnded,
    persistPartialResponse,
    queryClient,
    resetEphemeralPreviewState,
    upsertTaskChatHistory,
    clearActiveTurn,
    setTransportIdle,
  ])

  const runQueueDispatchLoop = useCallback(async () => {
    if (queueDispatchTaskRef.current) {
      return queueDispatchTaskRef.current
    }

    const task = (async () => {
      while (true) {
        const action = queueDispatchActionsRef.current.shift()
        if (!action) return

        if (action.epoch !== queueDispatchEpochRef.current) {
          continue
        }

        const msg = messageQueueRef.current[0]
        if (!msg) continue

        let originalIndex = 0
        let removedFromQueue = false
        const removeQueuedMessage = () => {
          if (removedFromQueue || action.epoch !== queueDispatchEpochRef.current) {
            return
          }
          removedFromQueue = true
          setMessageQueue((prev) => prev.filter((queued) => queued.id !== msg.id))
        }

        try {
          const currentIndex = messageQueueRef.current.findIndex((queued) => queued.id === msg.id)
          if (currentIndex !== -1) {
            originalIndex = currentIndex
          }

          const consumed = await startSendMessage(
            msg.content,
            msg.fileAttachments,
            msg.contexts,
            undefined,
            removeQueuedMessage
          )
          if (!consumed && removedFromQueue && action.epoch === queueDispatchEpochRef.current) {
            setMessageQueue((prev) => {
              if (prev.some((queued) => queued.id === msg.id)) return prev
              const next = [...prev]
              next.splice(Math.min(originalIndex, next.length), 0, msg)
              return next
            })
          }
        } catch {
          if (removedFromQueue && action.epoch === queueDispatchEpochRef.current) {
            setMessageQueue((prev) => {
              if (prev.some((queued) => queued.id === msg.id)) return prev
              const next = [...prev]
              next.splice(Math.min(originalIndex, next.length), 0, msg)
              return next
            })
          }
        }
      }
    })()

    queueDispatchTaskRef.current = task

    return task.finally(() => {
      if (queueDispatchTaskRef.current === task) {
        queueDispatchTaskRef.current = null
      }
      if (queueDispatchActionsRef.current.length > 0) {
        void queueDispatchLoopRef.current()
      }
    })
  }, [startSendMessage])
  queueDispatchLoopRef.current = runQueueDispatchLoop

  const enqueueQueueDispatch = useCallback((action: QueueDispatchActionInput) => {
    const epoch = queueDispatchEpochRef.current
    queueDispatchActionsRef.current.push({ ...action, epoch } as QueueDispatchAction)
    return queueDispatchLoopRef.current()
  }, [])
  enqueueQueueDispatchRef.current = enqueueQueueDispatch

  const removeFromQueue = useCallback((id: string) => {
    clearQueuedSendHandoffState(id)
    clearQueuedSendHandoffClaim(id)
    setMessageQueue((prev) => prev.filter((m) => m.id !== id))
  }, [])

  const sendQueuedMessageImmediately = useCallback(
    async (id: string) => {
      const epoch = queueDispatchEpochRef.current
      const initialIndex = messageQueueRef.current.findIndex((m) => m.id === id)
      if (initialIndex === -1) return
      const msg = messageQueueRef.current[initialIndex]

      if (queuedMessageDispatchIdsRef.current.has(msg.id)) {
        return
      }
      queuedMessageDispatchIdsRef.current.add(msg.id)

      // Explicit queue sends should supersede any older auto-drain work scheduled by finalize().
      queueDispatchActionsRef.current = queueDispatchActionsRef.current.filter(
        (queuedAction) => queuedAction.type !== 'send_head'
      )

      let originalIndex = initialIndex
      let removedFromQueue = false
      const removeQueuedMessage = () => {
        if (removedFromQueue || epoch !== queueDispatchEpochRef.current) {
          return
        }
        removedFromQueue = true
        setMessageQueue((prev) => prev.filter((queued) => queued.id !== msg.id))
      }
      const restoreQueuedMessage = () => {
        if (!removedFromQueue || epoch !== queueDispatchEpochRef.current) {
          return
        }
        setMessageQueue((prev) => {
          if (prev.some((queued) => queued.id === msg.id)) return prev
          const next = [...prev]
          next.splice(Math.min(originalIndex, next.length), 0, msg)
          return next
        })
      }

      try {
        const currentIndex = messageQueueRef.current.findIndex((queued) => queued.id === msg.id)
        if (currentIndex === -1) {
          return
        }

        originalIndex = currentIndex

        const queuedSendHandoff =
          sendingRef.current && workspaceId
            ? {
                id: msg.id,
                chatId: selectedChatIdRef.current ?? chatIdRef.current ?? '',
                supersededStreamId:
                  streamIdRef.current ||
                  activeTurnRef.current?.userMessageId ||
                  queryClient.getQueryData<TaskChatHistory>(
                    taskKeys.detail(selectedChatIdRef.current ?? chatIdRef.current)
                  )?.activeStreamId ||
                  null,
              }
            : undefined
        const pendingStop = sendingRef.current ? stopGeneration() : pendingStopPromiseRef.current
        const consumed = await startSendMessage(
          msg.content,
          msg.fileAttachments,
          msg.contexts,
          pendingStop,
          removeQueuedMessage,
          queuedSendHandoff?.chatId ? queuedSendHandoff : undefined
        )

        if (!consumed) {
          restoreQueuedMessage()
        }
      } catch {
        restoreQueuedMessage()
      } finally {
        queuedMessageDispatchIdsRef.current.delete(msg.id)
      }
    },
    [startSendMessage, stopGeneration]
  )

  const sendNow = useCallback(
    async (id: string) => {
      await sendQueuedMessageImmediately(id)
    },
    [sendQueuedMessageImmediately]
  )

  const editQueuedMessage = useCallback((id: string): QueuedMessage | undefined => {
    const msg = messageQueueRef.current.find((m) => m.id === id)
    if (!msg) return undefined
    clearQueuedSendHandoffState(id)
    clearQueuedSendHandoffClaim(id)
    setMessageQueue((prev) => prev.filter((m) => m.id !== id))
    return msg
  }, [])

  useEffect(() => {
    return () => {
      clearQueueDispatchState()
      streamReaderRef.current = null
      abortControllerRef.current = null
      streamGenRef.current++
      clearActiveTurn()
      sendingRef.current = false
    }
  }, [clearQueueDispatchState, clearActiveTurn])

  return {
    messages,
    isSending,
    isReconnecting,
    error,
    resolvedChatId,
    sendMessage,
    stopGeneration,
    resources,
    activeResourceId: effectiveActiveResourceId,
    setActiveResourceId,
    addResource,
    removeResource,
    reorderResources,
    messageQueue,
    removeFromQueue,
    sendNow,
    editQueuedMessage,
    previewSession,
    genericResourceData,
  }
}
