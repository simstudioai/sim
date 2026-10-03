import { createLogger } from '@sim/logger'
import { isPlainRecord } from '@sim/utils/object'
import type { ZodError } from 'zod'
import type { AnyApiRouteContract } from '@/lib/api/contracts'
import {
  createMemoryContract,
  deleteMemoryByQueryContract,
  getMemoryByIdContract,
  listMemoriesContract,
  memoryDeleteQuerySchema,
  memoryIdParamsSchema,
  memoryListQuerySchema,
  memoryPostBodySchema,
} from '@/lib/api/contracts/memory'
import { serializeZodIssues } from '@/lib/api/server/validation'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import {
  executeMemoryAdd,
  executeMemoryDelete,
  executeMemoryGet,
  executeMemoryList,
  type MemoryToolOperationContext,
  type MemoryToolOperationResult,
} from '@/lib/internal/memory/operations'
import { createMemoryToolResponse, MemoryProvenanceError } from '@/lib/internal/memory/provenance'
import { createExecutorPrincipalFromExecutionContext } from '@/lib/internal/principals/executor'
import {
  classifyInternalToolIdentityFault,
  internalToolIdentityFaultMessage,
  internalToolIdentityFaultStatus,
} from '@/lib/internal/tool-operations/identity-faults'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { MEMORY_DELEGATION_AUDIENCE } from '@/lib/memory/application/authorization'

const logger = createLogger('MemoryInternalOperation')

const FAILURE_MESSAGES: Record<string, string> = {
  memory_add: 'Failed to create memory',
  memory_get: 'Failed to retrieve memory',
  memory_get_all: 'Failed to search memories',
  memory_delete: 'Failed to delete memories',
}

function failureResponse(toolId: string, error: unknown): Response {
  if (error instanceof MemoryProvenanceError) {
    return Response.json({ error: error.message }, { status: 400 })
  }
  const classified = asOrchestrationError(error)
  if (classified) {
    return Response.json(
      { success: false, error: { message: classified.message } },
      { status: statusForOrchestrationError(classified.code) }
    )
  }
  logger.error(FAILURE_MESSAGES[toolId] ?? 'Memory operation failed', { error })
  return Response.json(
    {
      success: false,
      error: { message: FAILURE_MESSAGES[toolId] ?? 'Memory operation failed' },
    },
    { status: 500 }
  )
}

async function dispatchMemoryTool(
  request: Parameters<InternalToolOperationHandler>[0],
  context: MemoryToolOperationContext
): Promise<{ contract: AnyApiRouteContract; result: MemoryToolOperationResult } | Response> {
  const dispatched = async (
    contract: AnyApiRouteContract,
    result: Promise<MemoryToolOperationResult>
  ) => ({ contract, result: await result })

  switch (request.toolId) {
    case 'memory_add': {
      const parsed = memoryPostBodySchema.safeParse(request.input)
      return parsed.success
        ? dispatched(createMemoryContract, executeMemoryAdd(parsed.data, context))
        : validationResponse(parsed.error)
    }
    case 'memory_get_all': {
      const parsed = memoryListQuerySchema.safeParse({
        ...(isPlainRecord(request.input) ? request.input : {}),
        workspaceId: context.principal.workspaceId,
      })
      return parsed.success
        ? dispatched(listMemoriesContract, executeMemoryList(parsed.data, context))
        : validationResponse(parsed.error)
    }
    case 'memory_get': {
      const parsed = memoryIdParamsSchema.safeParse(request.input)
      return parsed.success
        ? dispatched(getMemoryByIdContract, executeMemoryGet(parsed.data.id, context))
        : validationResponse(parsed.error)
    }
    case 'memory_delete': {
      const parsed = memoryDeleteQuerySchema.safeParse({
        ...(isPlainRecord(request.input) ? request.input : {}),
        workspaceId: context.principal.workspaceId,
      })
      return parsed.success
        ? dispatched(deleteMemoryByQueryContract, executeMemoryDelete(parsed.data, context))
        : validationResponse(parsed.error)
    }
    default:
      return Response.json({ error: `Unsupported Memory tool: ${request.toolId}` }, { status: 500 })
  }
}

function validationResponse(error: ZodError): Response {
  return Response.json(
    { error: 'Validation error', details: serializeZodIssues(error) },
    { status: 400 }
  )
}

export const executeMemoryTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!Object.hasOwn(FAILURE_MESSAGES, request.toolId)) {
    return Response.json({ error: `Unsupported Memory tool: ${request.toolId}` }, { status: 500 })
  }

  try {
    const principal = await createExecutorPrincipalFromExecutionContext({
      context: request.context,
      audience: MEMORY_DELEGATION_AUDIENCE,
    })
    request.signal?.throwIfAborted()
    const dispatched = await dispatchMemoryTool(request, {
      principal,
      headers: request.headers,
      signal: request.signal,
    })
    if (dispatched instanceof Response) return dispatched
    if (dispatched.contract.response.mode !== 'json') {
      throw new Error('Memory tool contract must return JSON')
    }
    const body = dispatched.contract.response.schema.parse(dispatched.result.body) as Record<
      string,
      unknown
    >
    return createMemoryToolResponse(
      body,
      dispatched.result.provenance,
      dispatched.result.provenanceScope
    )
  } catch (error) {
    request.signal?.throwIfAborted()
    const identityFault = classifyInternalToolIdentityFault(error)
    if (identityFault) {
      return Response.json(
        { success: false, error: { message: internalToolIdentityFaultMessage(identityFault) } },
        { status: internalToolIdentityFaultStatus(identityFault) }
      )
    }
    return failureResponse(request.toolId, error)
  }
}
