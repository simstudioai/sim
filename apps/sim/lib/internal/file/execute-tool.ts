import { resolvePrincipalAttribution, resolvePrincipalSubject } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { fileParseContract } from '@/lib/api/contracts/storage-transfer'
import { fileManageContract } from '@/lib/api/contracts/tools/file'
import { executeFileManageOperation } from '@/lib/internal/file/operations'
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

const logger = createLogger('FileToolExecution')

const FILE_MANAGE_TOOL_IDS = new Set([
  'file_append',
  'file_compress',
  'file_decompress',
  'file_get',
  'file_get_content',
  'file_manage_sharing',
  'file_fetch',
  'file_parser',
  'file_parser_v2',
  'file_parser_v3',
  'file_read',
  'file_write',
])

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

  const isParserTool =
    request.toolId === 'file_fetch' ||
    request.toolId === 'file_parser' ||
    request.toolId === 'file_parser_v2' ||
    request.toolId === 'file_parser_v3'
  const parserInput = isParserTool ? parseInternalToolInput(fileParseContract, request.input) : null
  if (parserInput && !parserInput.success) return parserInput.response
  const manageInput = isParserTool
    ? null
    : parseInternalToolInput(fileManageContract, request.input)
  if (manageInput && !manageInput.success) return manageInput.response
  try {
    const principal = await createExecutorPrincipalFromExecutionContext({
      context: request.context,
      audience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
    })
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
        executionActorUserId: request.context.userId,
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
    const message = getErrorMessage(error, 'Unknown error')
    logger.error('File operation dispatch failed', {
      error: message,
      requestId: request.requestId,
      toolId: request.toolId,
    })
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}
