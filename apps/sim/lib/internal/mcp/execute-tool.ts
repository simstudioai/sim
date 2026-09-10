import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { resolvePrincipalSubject } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isPlainRecord } from '@sim/utils/object'
import { executeCopilotManagedMcpUseCase } from '@/lib/copilot/application/execute-managed-mcp-use-case'
import { executeCopilotMcpServerUseCase } from '@/lib/copilot/application/execute-mcp-server-use-case'
import { requireTrustedCopilotExecutionContext } from '@/lib/copilot/auth/application-delegation'
import {
  capExecutionTimeoutMs,
  getAsyncExecutionTimeoutForBillingAttribution,
  getRemainingExecutionMs,
} from '@/lib/core/execution-limits'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { MANAGED_MCP_DELEGATION_AUDIENCE } from '@/lib/credentials/application/authorization'
import { ManagedMcpCredentialError } from '@/lib/credentials/managed-mcp'
import { createExecutorPrincipalFromExecutionContext } from '@/lib/internal/principals/executor'
import {
  classifyInternalToolIdentityFault,
  internalToolIdentityFaultMessage,
  internalToolIdentityFaultStatus,
} from '@/lib/internal/tool-operations/identity-faults'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { MCP_SERVER_DELEGATION_AUDIENCE } from '@/lib/mcp/application/authorization'
import { executeManagedMcpToolUseCase } from '@/lib/mcp/application/execute-managed-tool'
import {
  type ExecuteMcpToolInput,
  type ExecuteMcpToolResult,
  executeMcpToolUseCase,
  McpToolsNotAllowedError,
} from '@/lib/mcp/application/execute-tool'
import { McpOauthRedirectRequired } from '@/lib/mcp/oauth'
import { McpOauthAuthorizationRequiredError } from '@/lib/mcp/types'
import {
  categorizeError,
  isManagedMcpConnectionId,
  MANAGED_MCP_CONNECTION_PREFIX,
  parseMcpToolTarget,
} from '@/lib/mcp/utils'
import {
  ResolvedSecretTraceProvenanceAccumulator,
  type ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('McpInternalOperation')

const MCP_SYSTEM_PARAMETERS = new Set([
  'operationPolicy',
  'serverId',
  'serverUrl',
  'toolName',
  'serverName',
  '_context',
  'envVars',
  'workflowVariables',
  'blockData',
  'blockNameMapping',
  '_toolSchema',
])

function parseArguments(input: unknown): Record<string, unknown> | null {
  if (!isPlainRecord(input)) return null
  if (!Object.hasOwn(input, 'arguments')) {
    return Object.fromEntries(
      Object.entries(input).filter(([name]) => !MCP_SYSTEM_PARAMETERS.has(name))
    )
  }

  const value = input.arguments
  if (typeof value !== 'string') return isPlainRecord(value) ? value : null
  try {
    const parsed: unknown = JSON.parse(value)
    return isPlainRecord(parsed) ? parsed : null
  } catch (error) {
    logger.warn('Failed to parse MCP arguments JSON', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
      argumentsLength: value.length,
    })
    return null
  }
}

async function createResponse(
  body: Record<string, unknown>,
  status: number,
  provenance: ResolvedSecretTraceProvenanceAccumulator | undefined,
  registry: ResolvedSecretTraceRegistry | undefined,
  toolId: string
): Promise<Response> {
  if (!provenance || !registry) return Response.json(body, { status })
  const targetRegistry = registry.forkForToolCall()
  const imported = await targetRegistry.importCrossingProvenance(
    provenance.exportProvenance(),
    body,
    { trusted: true, origin: `tool.${toolId}` }
  )
  if (!imported) {
    return Response.json(
      { success: false, error: 'Internal tool response metadata could not be verified' },
      { status: 502, statusText: 'Bad Gateway' }
    )
  }
  registry.mergeToolCallRegistry(targetRegistry)
  return Response.json(body, { status })
}

export const executeMcpTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  let target: ReturnType<typeof parseMcpToolTarget>
  try {
    if (request.toolId === 'mcp_run_operation') {
      if (!isPlainRecord(request.input)) throw new Error('MCP operation input is required')
      const { server, connection, tool } = request.input
      if (
        typeof server !== 'string' ||
        !server.trim() ||
        typeof tool !== 'string' ||
        !tool.trim()
      ) {
        throw new Error('MCP server and operation name are required')
      }
      if (connection !== undefined && (typeof connection !== 'string' || !connection.trim()))
        throw new Error('Invalid managed connection')
      const targetId = typeof connection === 'string' && connection ? connection : server
      if (connection && !isManagedMcpConnectionId(targetId))
        throw new Error('Expected a managed MCP connection ID')
      if (targetId.startsWith(MANAGED_MCP_CONNECTION_PREFIX) && !isManagedMcpConnectionId(targetId))
        throw new Error('Invalid managed MCP connection ID')
      target = isManagedMcpConnectionId(targetId)
        ? { kind: 'managed_connection', credentialId: targetId, toolName: tool }
        : { kind: 'shared_server', serverId: targetId, toolName: tool }
    } else {
      target = parseMcpToolTarget(request.toolId)
    }
  } catch (error) {
    return Response.json(
      { success: false, error: getErrorMessage(error, 'Invalid MCP tool ID') },
      { status: 400 }
    )
  }
  const toolName = target.toolName
  const targetId = target.kind === 'shared_server' ? target.serverId : target.credentialId

  if (!request.context.workspaceId) {
    return Response.json(
      {
        success: false,
        error: `Missing workspaceId in execution context for MCP tool ${toolName}`,
      },
      { status: 400 }
    )
  }
  if (!request.context.billingAttribution) {
    return Response.json(
      {
        success: false,
        error: `Missing billing attribution in execution context for MCP tool ${toolName}`,
      },
      { status: 400 }
    )
  }
  const args = parseArguments(request.input)
  if (!args)
    return Response.json({ success: false, error: 'Invalid request format' }, { status: 400 })

  let provenance: ResolvedSecretTraceProvenanceAccumulator | undefined
  try {
    const interactiveCopilot =
      request.context.copilotToolExecution &&
      request.context.copilotInteractionMode === 'interactive' &&
      !request.context.mcpBlockId
    const principal = interactiveCopilot
      ? undefined
      : await createExecutorPrincipalFromExecutionContext({
          context: request.context,
          audience:
            target.kind === 'shared_server'
              ? MCP_SERVER_DELEGATION_AUDIENCE
              : MANAGED_MCP_DELEGATION_AUDIENCE,
          ...(target.kind === 'managed_connection'
            ? { resourceScope: { credentialId: target.credentialId } }
            : { resourceScope: { mcpServerId: target.serverId } }),
        })
    request.signal?.throwIfAborted()
    const subject = principal
      ? resolvePrincipalSubject(principal)
      : {
          kind: 'sim_user' as const,
          userId: requireTrustedCopilotExecutionContext(request.context).userId,
        }
    provenance =
      request.context.resolvedSecretTraceRegistry && subject?.kind === 'sim_user'
        ? new ResolvedSecretTraceProvenanceAccumulator({
            userId: subject.userId,
            workspaceId: request.context.workspaceId,
          })
        : undefined
    const policyTimeoutMs = getAsyncExecutionTimeoutForBillingAttribution(
      request.context.billingAttribution
    )
    const timeoutMs = capExecutionTimeoutMs(
      policyTimeoutMs,
      getRemainingExecutionMs(request.signal)
    )
    const commonInput = {
      workspaceId: request.context.workspaceId,
      toolName,
      arguments: args,
      callChain: request.context.callChain,
      timeoutMs,
      signal: request.signal,
    }
    let result: ExecuteMcpToolResult
    if (target.kind === 'shared_server') {
      const input: ExecuteMcpToolInput = {
        ...commonInput,
        serverId: target.serverId,
        onResolvedSecretTraceProvenance: provenance
          ? (value) => provenance?.record(value)
          : undefined,
      }
      result = principal
        ? await executeMcpToolUseCase.execute({ principal, input })
        : await executeCopilotMcpServerUseCase(request.context, executeMcpToolUseCase, input)
    } else {
      const input = {
        ...commonInput,
        credentialId: target.credentialId,
        ...(isPlainRecord(request.input) && request.input.connection
          ? { assertedServerId: String(request.input.server) }
          : {}),
      }
      result = principal
        ? await executeManagedMcpToolUseCase.execute({ principal, input })
        : await executeCopilotManagedMcpUseCase(
            request.context,
            executeManagedMcpToolUseCase,
            input,
            { credentialId: target.credentialId }
          )
    }
    request.signal?.throwIfAborted()
    const body =
      request.toolId === 'mcp_run_operation'
        ? result
        : result.success
          ? { success: true, data: { success: true, output: result.output } }
          : { success: false, error: result.error }
    return createResponse(
      body,
      result.success ? 200 : 400,
      provenance,
      request.context.resolvedSecretTraceRegistry,
      request.toolId
    )
  } catch (error) {
    request.signal?.throwIfAborted()
    const identityFault = classifyInternalToolIdentityFault(error)
    if (identityFault) {
      return Response.json(
        { success: false, error: internalToolIdentityFaultMessage(identityFault) },
        { status: internalToolIdentityFaultStatus(identityFault) }
      )
    }
    if (error instanceof McpToolsNotAllowedError) {
      return createResponse(
        { success: false, error: error.message },
        403,
        provenance,
        request.context.resolvedSecretTraceRegistry,
        request.toolId
      )
    }
    if (error instanceof ManagedMcpCredentialError && error.statusCode === 401) {
      return createResponse(
        {
          success: false,
          error: 'OAuth re-authorization required',
          code: 'reauth_required',
          serverId: targetId,
        },
        401,
        provenance,
        request.context.resolvedSecretTraceRegistry,
        request.toolId
      )
    }
    if (
      error instanceof McpOauthAuthorizationRequiredError ||
      error instanceof McpOauthRedirectRequired ||
      error instanceof UnauthorizedError
    ) {
      const oauthServerId =
        error instanceof McpOauthAuthorizationRequiredError ? error.serverId : targetId
      return createResponse(
        {
          success: false,
          error: 'OAuth re-authorization required',
          code: 'reauth_required',
          serverId: oauthServerId,
        },
        401,
        provenance,
        request.context.resolvedSecretTraceRegistry,
        request.toolId
      )
    }

    if (error instanceof ManagedMcpCredentialError) {
      return createResponse(
        {
          success: false,
          error: error.statusCode === 404 ? 'Resource not found' : 'Managed MCP connection failed',
        },
        error.statusCode,
        provenance,
        request.context.resolvedSecretTraceRegistry,
        request.toolId
      )
    }

    const orchestrationError = asOrchestrationError(error)
    if (orchestrationError) {
      const message =
        orchestrationError.code === 'not_found' &&
        orchestrationError.message !== 'Tool not found on the specified server'
          ? 'Resource not found'
          : orchestrationError.message
      return createResponse(
        { success: false, error: message },
        statusForOrchestrationError(orchestrationError.code),
        provenance,
        request.context.resolvedSecretTraceRegistry,
        request.toolId
      )
    }

    const categorized = categorizeError(error)
    if (categorized.status === 408) provenance?.markIncomplete('mcp-tool-execution-timeout')
    logger.error('MCP tool execution failed', {
      error: getErrorMessage(error),
      requestId: request.requestId,
      serverId: targetId,
      toolName,
    })
    return createResponse(
      { success: false, error: categorized.message },
      categorized.status,
      provenance,
      request.context.resolvedSecretTraceRegistry,
      request.toolId
    )
  }
}
