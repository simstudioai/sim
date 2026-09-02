import { resolvePrincipalAttribution, resolvePrincipalSubject } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { z } from 'zod'
import { fileParseContract } from '@/lib/api/contracts/storage-transfer'
import { fileManageContract } from '@/lib/api/contracts/tools/file'
import { v2FolderPathInputSchema } from '@/lib/api/contracts/v2/shared'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import {
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
  requestsPrivateToolMetadata,
} from '@/lib/execution/private-tool-metadata'
import {
  executeFileManageOperation,
  fileContentJsonResponse,
  getFileContentProvenance,
} from '@/lib/internal/file/operations'
import { executeFileParserOperation } from '@/lib/internal/file/parser'
import { createExecutorPrincipalFromExecutionContext } from '@/lib/internal/principals/executor'
import {
  classifyInternalToolIdentityFault,
  internalToolIdentityFaultMessage,
  internalToolIdentityFaultStatus,
} from '@/lib/internal/tool-operations/identity-faults'
import { parseInternalToolInput } from '@/lib/internal/tool-operations/parse-input'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { WORKSPACE_FILES_DELEGATION_AUDIENCE } from '@/lib/workspace-files/application/authorization'
import { searchWorkspaceFileContent } from '@/lib/workspace-files/application/search-workspace-file-content'
import {
  FILE_SEARCH_DEFAULT_MAX_RESULTS,
  FILE_SEARCH_MAX_QUERY_LENGTH,
  FILE_SEARCH_MAX_RESULTS,
  FILE_SEARCH_MIN_QUERY_LENGTH,
} from '@/lib/workspace-files/search/constants'
import { FILE_SEARCH_MODES } from '@/lib/workspace-files/search/pattern'

const logger = createLogger('FileToolExecution')

const FILE_MANAGE_TOOL_IDS = new Set([
  'file_append',
  'file_compress',
  'file_decompress',
  'file_get',
  'file_get_content',
  'file_manage_sharing',
  'file_edit',
  'file_fetch',
  'file_parser',
  'file_parser_v2',
  'file_parser_v3',
  'file_read',
  'file_search',
  'file_write',
  'file_list',
  'file_create_folder',
  'file_update_folder',
  'file_delete_folder',
  'file_restore_folder',
  'file_move',
])

const fileSearchInputSchema = z
  .object({
    query: z
      .string()
      .min(FILE_SEARCH_MIN_QUERY_LENGTH)
      .max(FILE_SEARCH_MAX_QUERY_LENGTH)
      .refine((query) => !query.includes('\0'), 'Search query cannot contain NUL characters'),
    mode: z.enum(FILE_SEARCH_MODES).default('regex'),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(FILE_SEARCH_MAX_RESULTS)
      .default(FILE_SEARCH_DEFAULT_MAX_RESULTS),
    /** Same spelling and bound as the folder scope on read, content and compress. */
    folderPaths: z.array(v2FolderPathInputSchema).max(64, 'Too many folders').optional(),
    includeSubfolders: z.boolean().optional(),
  })
  .strict()

export const executeFileTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!FILE_MANAGE_TOOL_IDS.has(request.toolId)) {
    return Response.json(
      { success: false, error: `Unsupported File tool: ${request.toolId}` },
      { status: 500 }
    )
  }

  const workspaceId = request.context.workspaceId
  if (!workspaceId || !request.context.executorDelegationOrigin) {
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 })
  }

  const isSearchTool = request.toolId === 'file_search'
  const searchInput = isSearchTool ? fileSearchInputSchema.safeParse(request.input) : null
  if (searchInput && !searchInput.success) {
    return Response.json(
      { success: false, error: searchInput.error.issues[0]?.message ?? 'Invalid search input' },
      { status: 400 }
    )
  }
  const isParserTool =
    request.toolId === 'file_fetch' ||
    request.toolId === 'file_parser' ||
    request.toolId === 'file_parser_v2' ||
    request.toolId === 'file_parser_v3'
  const parserInput = isParserTool ? parseInternalToolInput(fileParseContract, request.input) : null
  if (parserInput && !parserInput.success) return parserInput.response
  const manageInput =
    isParserTool || isSearchTool ? null : parseInternalToolInput(fileManageContract, request.input)
  if (manageInput && !manageInput.success) return manageInput.response
  try {
    const principal = await createExecutorPrincipalFromExecutionContext({
      context: request.context,
      audience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
    })
    if (searchInput) {
      request.signal?.throwIfAborted()
      const result = await searchWorkspaceFileContent.execute({
        principal,
        input: {
          workspaceId,
          query: searchInput.data.query,
          mode: searchInput.data.mode,
          maxResults: searchInput.data.maxResults,
          folderPaths: searchInput.data.folderPaths,
          includeSubfolders: searchInput.data.includeSubfolders,
          signal: request.signal,
        },
      })
      request.signal?.throwIfAborted()
      const { sources, ...data } = result
      const includePrivateProvenance = requestsPrivateToolMetadata(
        request.headers,
        RESOLVED_SECRET_PROVENANCE_METADATA_V1
      )
      const provenance = includePrivateProvenance
        ? await getFileContentProvenance(principal, workspaceId, sources, request.signal)
        : undefined
      request.signal?.throwIfAborted()
      return fileContentJsonResponse(
        { success: true, data },
        includePrivateProvenance,
        undefined,
        provenance
      )
    }
    const { attributedUserId } = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: request.context.billingAttribution?.billedAccountUserId,
    })
    const subject = resolvePrincipalSubject(principal)
    const fileAccessUserId = subject?.kind === 'sim_user' ? subject.userId : undefined
    request.signal?.throwIfAborted()
    let response: Response
    if (parserInput) {
      response = await executeFileParserOperation(parserInput.data, {
        principal,
        workspaceId,
        workflowId: request.context.workflowId,
        executionId: request.context.executionId,
        attributedUserId,
        fileAccessUserId,
        largeValueExecutionIds: request.context.largeValueExecutionIds,
        fileKeys: request.context.fileKeys,
        allowLargeValueWorkflowScope: request.context.allowLargeValueWorkflowScope,
        requestId: request.requestId,
        signal: request.signal,
      })
    } else {
      if (!manageInput) throw new Error('File tool dispatch input is unavailable')
      response = await executeFileManageOperation(manageInput.data, {
        principal,
        workspaceId,
        attributedUserId,
        fileAccessUserId,
        workflowId: request.context.workflowId,
        executionId: request.context.executionId,
        largeValueExecutionIds: request.context.largeValueExecutionIds,
        fileKeys: request.context.fileKeys,
        allowLargeValueWorkflowScope: request.context.allowLargeValueWorkflowScope,
        headers: request.headers,
        requestId: request.requestId,
        signal: request.signal,
      })
    }
    request.signal?.throwIfAborted()
    return response
  } catch (error) {
    request.signal?.throwIfAborted()
    const identityFault = classifyInternalToolIdentityFault(error)
    if (identityFault) {
      return Response.json(
        { success: false, error: internalToolIdentityFaultMessage(identityFault) },
        { status: internalToolIdentityFaultStatus(identityFault) }
      )
    }
    const orchestrationError = request.toolId === 'file_search' ? asOrchestrationError(error) : null
    if (orchestrationError) {
      return Response.json(
        { success: false, error: orchestrationError.message },
        { status: statusForOrchestrationError(orchestrationError.code) }
      )
    }
    const isSearchFailure = request.toolId === 'file_search'
    const message = getErrorMessage(error, 'Unknown error')
    logger.error('File operation dispatch failed', {
      error: isSearchFailure ? 'Workspace file search failed' : message,
      errorType: isSearchFailure ? toError(error).name : undefined,
      requestId: request.requestId,
      toolId: request.toolId,
    })
    return Response.json(
      { success: false, error: isSearchFailure ? 'Failed to search workspace files' : message },
      { status: 500 }
    )
  }
}
