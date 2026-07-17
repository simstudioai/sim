import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { getBlockVisibilityForCopilot } from '@/lib/copilot/block-visibility'
import {
  CreateFile,
  CreateFileFolder,
  DeleteFile,
  DeleteFileFolder,
  DownloadToWorkspaceFile,
  Ffmpeg,
  GenerateAudio,
  GenerateImage,
  GenerateVideo,
  KnowledgeBase,
  ManageCredential,
  ManageCustomTool,
  ManageMcpTool,
  ManageSkill,
  MoveFile,
  MoveFileFolder,
  RenameFile,
  RenameFileFolder,
  UserTable,
  WorkspaceFile,
} from '@/lib/copilot/generated/tool-catalog-v1'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import { getBlocksMetadataServerTool } from '@/lib/copilot/tools/server/blocks/get-blocks-metadata-tool'
import { getTriggerBlocksServerTool } from '@/lib/copilot/tools/server/blocks/get-trigger-blocks'
import { searchDocumentationServerTool } from '@/lib/copilot/tools/server/docs/search-documentation'
import { enrichmentRunServerTool } from '@/lib/copilot/tools/server/enrichment/enrichment-run'
import { createFileServerTool } from '@/lib/copilot/tools/server/files/create-file'
import { deleteFileServerTool } from '@/lib/copilot/tools/server/files/delete-file'
import { downloadToWorkspaceFileServerTool } from '@/lib/copilot/tools/server/files/download-to-workspace-file'
import { editContentServerTool } from '@/lib/copilot/tools/server/files/edit-content'
import {
  createFileFolderServerTool,
  deleteFileFolderServerTool,
  listFileFoldersServerTool,
  moveFileFolderServerTool,
  moveFileServerTool,
  renameFileFolderServerTool,
} from '@/lib/copilot/tools/server/files/file-folders'
import { renameFileServerTool } from '@/lib/copilot/tools/server/files/rename-file'
import { workspaceFileServerTool } from '@/lib/copilot/tools/server/files/workspace-file'
import { validateGeneratedToolPayload } from '@/lib/copilot/tools/server/generated-schema'
import { generateImageServerTool } from '@/lib/copilot/tools/server/image/generate-image'
import { getJobLogsServerTool } from '@/lib/copilot/tools/server/jobs/get-job-logs'
import { knowledgeBaseServerTool } from '@/lib/copilot/tools/server/knowledge/knowledge-base'
import { ffmpegServerTool } from '@/lib/copilot/tools/server/media/ffmpeg'
import { generateAudioServerTool } from '@/lib/copilot/tools/server/media/generate-audio'
import { generateVideoServerTool } from '@/lib/copilot/tools/server/media/generate-video'
import { searchOnlineServerTool } from '@/lib/copilot/tools/server/other/search-online'
import { userTableServerTool } from '@/lib/copilot/tools/server/table/user-table'
import { getCredentialsServerTool } from '@/lib/copilot/tools/server/user/get-credentials'
import { setEnvironmentVariablesServerTool } from '@/lib/copilot/tools/server/user/set-environment-variables'
import { editWorkflowServerTool } from '@/lib/copilot/tools/server/workflow/edit-workflow'
import { queryLogsServerTool } from '@/lib/copilot/tools/server/workflow/query-logs'
import { listCustomBlocksWithInputsForWorkspace } from '@/lib/workflows/custom-blocks/operations'
import { withCustomBlockOverlay } from '@/blocks/custom/server-overlay'
import { withBlockVisibility } from '@/blocks/visibility/server-context'

export type ExecuteResponseSuccess = z.output<typeof ExecuteResponseSuccessSchema>

const ExecuteResponseSuccessSchema = z.object({
  success: z.literal(true),
  result: z.unknown(),
})

const logger = createLogger('ServerToolRouter')

/**
 * Tools that resolve blocks through the registry (`getBlock`/`getAllBlocks`) and
 * must run inside the custom-block overlay so `custom_block_*` types resolve.
 */
const CUSTOM_BLOCK_OVERLAY_TOOLS = new Set(['edit_workflow', 'get_blocks_metadata'])

/**
 * DISCOVERY tools that must run inside the viewer's block-visibility context so
 * gated (preview / kill-switched) blocks disappear from what the agent can
 * list. Deliberately a DIFFERENT set from {@link CUSTOM_BLOCK_OVERLAY_TOOLS}:
 * `edit_workflow` is excluded because its registry use is functional
 * (find-by-type over clones, never a discovery listing) and gating it would
 * only risk leaking display projections into persisted state.
 */
const VISIBILITY_GATED_TOOLS = new Set(['get_blocks_metadata', 'get_trigger_blocks'])

const WRITE_ACTIONS: Record<string, string[]> = {
  [KnowledgeBase.id]: [
    'create',
    'add_file',
    'update',
    'delete',
    'delete_document',
    'update_document',
    'create_tag',
    'update_tag',
    'delete_tag',
    'add_connector',
    'update_connector',
    'delete_connector',
    'sync_connector',
  ],
  [UserTable.id]: [
    'create',
    'create_from_file',
    'import_file',
    'delete',
    'insert_row',
    'batch_insert_rows',
    'update_row',
    'batch_update_rows',
    'delete_row',
    'batch_delete_rows',
    'update_rows_by_filter',
    'delete_rows_by_filter',
    'add_column',
    'rename_column',
    'delete_column',
    'update_column',
    'add_enrichment',
  ],
  [ManageCustomTool.id]: ['add', 'edit', 'delete'],
  [ManageMcpTool.id]: ['add', 'edit', 'delete'],
  [ManageSkill.id]: ['add', 'edit', 'delete'],
  [ManageCredential.id]: ['rename', 'delete'],
  [WorkspaceFile.id]: ['create', 'append', 'update', 'delete', 'rename', 'patch'],
  [editContentServerTool.name]: ['*'],
  [CreateFile.id]: ['*'],
  [RenameFile.id]: ['*'],
  [DeleteFile.id]: ['*'],
  [MoveFile.id]: ['*'],
  [CreateFileFolder.id]: ['*'],
  [RenameFileFolder.id]: ['*'],
  [MoveFileFolder.id]: ['*'],
  [DeleteFileFolder.id]: ['*'],
  [DownloadToWorkspaceFile.id]: ['*'],
  [GenerateImage.id]: ['generate'],
  [GenerateVideo.id]: ['generate'],
  [GenerateAudio.id]: ['generate'],
  [Ffmpeg.id]: ['*'],
  // Paid external-provider lookups (hosted-key cost), like the media tools.
  [enrichmentRunServerTool.name]: ['*'],
}

function isWritePermission(userPermission: string): boolean {
  return userPermission === 'write' || userPermission === 'admin'
}

function isWriteAction(toolName: string, action: string | undefined): boolean {
  const writeActions = WRITE_ACTIONS[toolName]
  if (!writeActions) return false
  // '*' means the tool is always a write operation regardless of action field
  if (writeActions.includes('*')) return true
  return Boolean(action && writeActions.includes(action))
}

/** Registry of all server tools. Tools self-declare their validation schemas. */
const baseServerToolRegistry: Record<string, BaseServerTool> = {
  [getBlocksMetadataServerTool.name]: getBlocksMetadataServerTool,
  [getTriggerBlocksServerTool.name]: getTriggerBlocksServerTool,
  [editWorkflowServerTool.name]: editWorkflowServerTool,
  [queryLogsServerTool.name]: queryLogsServerTool,
  [getJobLogsServerTool.name]: getJobLogsServerTool,
  [searchDocumentationServerTool.name]: searchDocumentationServerTool,
  [searchOnlineServerTool.name]: searchOnlineServerTool,
  [setEnvironmentVariablesServerTool.name]: setEnvironmentVariablesServerTool,
  [getCredentialsServerTool.name]: getCredentialsServerTool,
  [knowledgeBaseServerTool.name]: knowledgeBaseServerTool,
  [enrichmentRunServerTool.name]: enrichmentRunServerTool,
  [userTableServerTool.name]: userTableServerTool,
  [workspaceFileServerTool.name]: workspaceFileServerTool,
  [editContentServerTool.name]: editContentServerTool,
  [createFileServerTool.name]: createFileServerTool,
  [renameFileServerTool.name]: renameFileServerTool,
  [deleteFileServerTool.name]: deleteFileServerTool,
  [moveFileServerTool.name]: moveFileServerTool,
  [listFileFoldersServerTool.name]: listFileFoldersServerTool,
  [createFileFolderServerTool.name]: createFileFolderServerTool,
  [renameFileFolderServerTool.name]: renameFileFolderServerTool,
  [moveFileFolderServerTool.name]: moveFileFolderServerTool,
  [deleteFileFolderServerTool.name]: deleteFileFolderServerTool,
  [downloadToWorkspaceFileServerTool.name]: downloadToWorkspaceFileServerTool,
  [generateImageServerTool.name]: generateImageServerTool,
  [generateVideoServerTool.name]: generateVideoServerTool,
  [generateAudioServerTool.name]: generateAudioServerTool,
  [ffmpegServerTool.name]: ffmpegServerTool,
}

function getServerToolRegistry(): Record<string, BaseServerTool> {
  return baseServerToolRegistry
}

export function getRegisteredServerToolNames(): string[] {
  return Object.keys(getServerToolRegistry())
}

export async function routeExecution(
  toolName: string,
  payload: unknown,
  context?: ServerToolContext
): Promise<unknown> {
  const tool = getServerToolRegistry()[toolName]
  if (!tool) {
    throw new Error(`Unknown server tool: ${toolName}`)
  }

  logger.debug(
    context?.messageId ? `Routing to tool [messageId:${context.messageId}]` : 'Routing to tool',
    { toolName }
  )

  // Action-level permission enforcement for mixed read/write tools
  if (WRITE_ACTIONS[toolName]) {
    const p = payload as Record<string, unknown>
    const action = (p?.operation ?? p?.action) as string | undefined
    if (isWriteAction(toolName, action) && !isWritePermission(context?.userPermission ?? '')) {
      const actionLabel = action ? `'${action}' on ` : ''
      throw new Error(
        `Permission denied: ${actionLabel}${toolName} requires write access. You have '${context?.userPermission ?? 'none'}' permission.`
      )
    }
  }

  assertServerToolNotAborted(
    context,
    `User stop signal aborted ${toolName} before payload normalization`
  )

  // Go injects chatId/workspaceId and may wrap the model's args inside a
  // nested "args" object. Unwrap that before validation so the generated
  // JSON Schema sees the flat tool contract shape.
  let normalizedPayload = payload ?? {}
  if (
    normalizedPayload &&
    typeof normalizedPayload === 'object' &&
    !Array.isArray(normalizedPayload)
  ) {
    const raw = normalizedPayload as Record<string, unknown>
    if (raw.args && typeof raw.args === 'object' && !raw.operation) {
      const nested = raw.args as Record<string, unknown>
      normalizedPayload = { ...nested, ...raw, args: undefined }
    }
  }

  const args = tool.inputSchema
    ? tool.inputSchema.parse(normalizedPayload)
    : validateGeneratedToolPayload(toolName, 'parameters', normalizedPayload)

  assertServerToolNotAborted(context, `User stop signal aborted ${toolName} after validation`)

  // Execute. The registry-dependent tools resolve blocks via getBlock/getAllBlocks;
  // wrap them in the custom-block overlay for the workspace's org so `custom_block_*`
  // types resolve (metadata lookup + edit-workflow validation) instead of being
  // rejected as unknown, and wrap discovery tools in the viewer's block-visibility
  // context so gated blocks stay hidden. The two ALS scopes are independent and
  // nest in either order. Other tools skip the extra queries.
  let run = () => tool.execute(args, context)
  if (VISIBILITY_GATED_TOOLS.has(toolName) && context?.userId) {
    // Memoized per (userId, workspaceId) ~30s — a multi-tool turn resolves once.
    const vis = await getBlockVisibilityForCopilot(context.userId, context.workspaceId)
    const inner = run
    run = () => withBlockVisibility(vis, inner)
  }
  if (CUSTOM_BLOCK_OVERLAY_TOOLS.has(toolName) && context?.workspaceId) {
    const rows = await listCustomBlocksWithInputsForWorkspace(context.workspaceId)
    const inner = run
    run = () => withCustomBlockOverlay(rows, inner)
  }
  const result = await run()

  // Validate output if tool declares a schema; otherwise fall back to the
  // generated JSON schema contract emitted from Go.
  return tool.outputSchema
    ? tool.outputSchema.parse(result)
    : validateGeneratedToolPayload(toolName, 'resultSchema', result)
}
