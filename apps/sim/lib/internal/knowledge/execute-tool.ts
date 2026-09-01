import { createLogger } from '@sim/logger'
import type { AnyApiRouteContract, ApiSchema } from '@/lib/api/contracts'
import {
  createKnowledgeChunkContract,
  createKnowledgeDocumentsResponseSchema,
  createKnowledgeDocumentsSchemas,
  deleteKnowledgeChunkContract,
  deleteKnowledgeDocumentContract,
  getKnowledgeConnectorContract,
  getKnowledgeDocumentContract,
  internalKnowledgeSearchContract,
  listKnowledgeChunksContract,
  listKnowledgeConnectorsContract,
  listKnowledgeDocumentsContract,
  listTagDefinitionsContract,
  triggerKnowledgeConnectorSyncContract,
  updateKnowledgeChunkContract,
  upsertKnowledgeDocumentContract,
} from '@/lib/api/contracts/knowledge'
import type { JsonErrorResponseDescriptor } from '@/lib/api/server/routes/types'
import {
  createChunkOperation,
  createDocumentsOperation,
  deleteChunkOperation,
  deleteDocumentOperation,
  type KnowledgeOperationResponse,
  listChunksOperation,
  listConnectorsOperation,
  listDocumentsOperation,
  listTagsOperation,
  readConnectorOperation,
  readDocumentOperation,
  searchOperation,
  syncConnectorOperation,
  updateChunkOperation,
  upsertDocumentOperation,
} from '@/lib/internal/knowledge/operations'
import {
  createExecutorPrincipalFromExecutionContext,
  requireExecutorWorkspaceId,
} from '@/lib/internal/principals/executor'
import {
  classifyInternalToolIdentityFault,
  internalToolIdentityFaultMessage,
  internalToolIdentityFaultStatus,
} from '@/lib/internal/tool-operations/identity-faults'
import {
  parseInternalContractInput,
  parseInternalOperationInput,
} from '@/lib/internal/tool-operations/parse-contract-input'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { internalKnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'

const logger = createLogger('KnowledgeToolExecution')
const MAX_KNOWLEDGE_BODY_BYTES = 2 * 1024 * 1024

export const KNOWLEDGE_TOOL_IDS = [
  'knowledge_create_document',
  'knowledge_delete_chunk',
  'knowledge_delete_document',
  'knowledge_get_connector',
  'knowledge_get_document',
  'knowledge_list_chunks',
  'knowledge_list_connectors',
  'knowledge_list_documents',
  'knowledge_list_tags',
  'knowledge_search',
  'knowledge_trigger_sync',
  'knowledge_update_chunk',
  'knowledge_upload_chunk',
  'knowledge_upsert_document',
] as const

type KnowledgeErrorPolicy =
  (typeof internalKnowledgeErrorPolicies)[keyof typeof internalKnowledgeErrorPolicies]

function normalizeKnowledgeInput(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input
  const record = input as Record<string, unknown>
  return { ...record, id: record.knowledgeBaseId }
}

function descriptorResponse(descriptor: JsonErrorResponseDescriptor): Response {
  return Response.json(descriptor.body, {
    status: descriptor.status,
    headers: descriptor.headers,
  })
}

function projectError(
  policy: KnowledgeErrorPolicy,
  error: unknown,
  requestId: string,
  signal?: AbortSignal
): Response {
  signal?.throwIfAborted()
  const projected = policy.project(error)
  if (projected) return descriptorResponse(projected)
  logger.error(`[${requestId}] Knowledge tool execution failed`, { error })
  return descriptorResponse(
    policy.unhandled?.() ?? { status: 500, body: { error: 'Internal server error' } }
  )
}

function schemaSuccessResponse(schema: ApiSchema, result: KnowledgeOperationResponse): Response {
  const validated = schema.parse(result.body) as Record<string, unknown>
  return Response.json({ ...validated, ...result.bodyFields }, { headers: result.headers })
}

function successResponse<C extends AnyApiRouteContract>(
  contract: C,
  result: KnowledgeOperationResponse
): Response {
  if (contract.response.mode !== 'json') {
    throw new Error('Knowledge tool contract must return JSON')
  }
  return schemaSuccessResponse(contract.response.schema, result)
}

/** Executes every Knowledge tool through the same authorized application use cases as HTTP. */
export const executeKnowledgeTool: InternalToolOperationHandler = async (request) => {
  const { toolId, signal, requestId } = request
  signal?.throwIfAborted()

  let policy: KnowledgeErrorPolicy = internalKnowledgeErrorPolicies.documents
  try {
    let principal
    try {
      principal = await createExecutorPrincipalFromExecutionContext({
        context: request.context,
      })
    } catch (error) {
      const identityFault = classifyInternalToolIdentityFault(error)
      if (identityFault) {
        return Response.json(
          { error: internalToolIdentityFaultMessage(identityFault) },
          { status: internalToolIdentityFaultStatus(identityFault) }
        )
      }
      throw error
    }
    signal?.throwIfAborted()
    const context = {
      principal,
      workspaceId: requireExecutorWorkspaceId(request.context),
      headers: request.headers,
      signal,
    }
    const input = normalizeKnowledgeInput(request.input)

    switch (toolId) {
      case 'knowledge_create_document': {
        policy = internalKnowledgeErrorPolicies.uploads
        const parsed = parseInternalOperationInput(createKnowledgeDocumentsSchemas, input)
        if (!parsed.success) return parsed.response
        return schemaSuccessResponse(
          createKnowledgeDocumentsResponseSchema,
          await createDocumentsOperation(parsed.data.params.id, parsed.data.body, context)
        )
      }
      case 'knowledge_delete_chunk': {
        policy = internalKnowledgeErrorPolicies.chunks
        const parsed = parseInternalContractInput(deleteKnowledgeChunkContract, input)
        if (!parsed.success) return parsed.response
        return successResponse(
          deleteKnowledgeChunkContract,
          await deleteChunkOperation(
            parsed.data.params.id,
            parsed.data.params.documentId,
            parsed.data.params.chunkId,
            context
          )
        )
      }
      case 'knowledge_delete_document': {
        policy = internalKnowledgeErrorPolicies.documents
        const parsed = parseInternalContractInput(deleteKnowledgeDocumentContract, input)
        if (!parsed.success) return parsed.response
        return successResponse(
          deleteKnowledgeDocumentContract,
          await deleteDocumentOperation(
            parsed.data.params.id,
            parsed.data.params.documentId,
            context
          )
        )
      }
      case 'knowledge_get_connector': {
        policy = internalKnowledgeErrorPolicies.connectors
        const parsed = parseInternalContractInput(getKnowledgeConnectorContract, input)
        if (!parsed.success) return parsed.response
        return successResponse(
          getKnowledgeConnectorContract,
          await readConnectorOperation(
            parsed.data.params.id,
            parsed.data.params.connectorId,
            context
          )
        )
      }
      case 'knowledge_get_document': {
        policy = internalKnowledgeErrorPolicies.documents
        const parsed = parseInternalContractInput(getKnowledgeDocumentContract, input)
        if (!parsed.success) return parsed.response
        return successResponse(
          getKnowledgeDocumentContract,
          await readDocumentOperation(parsed.data.params.id, parsed.data.params.documentId, context)
        )
      }
      case 'knowledge_list_chunks': {
        policy = internalKnowledgeErrorPolicies.chunkList
        const parsed = parseInternalContractInput(listKnowledgeChunksContract, input)
        if (!parsed.success) return parsed.response
        return successResponse(
          listKnowledgeChunksContract,
          await listChunksOperation(
            parsed.data.params.id,
            parsed.data.params.documentId,
            parsed.data.query,
            context
          )
        )
      }
      case 'knowledge_list_connectors': {
        policy = internalKnowledgeErrorPolicies.connectors
        const parsed = parseInternalContractInput(listKnowledgeConnectorsContract, input)
        if (!parsed.success) return parsed.response
        return successResponse(
          listKnowledgeConnectorsContract,
          await listConnectorsOperation(parsed.data.params.id, context)
        )
      }
      case 'knowledge_list_documents': {
        policy = internalKnowledgeErrorPolicies.documents
        const parsed = parseInternalContractInput(listKnowledgeDocumentsContract, input)
        if (!parsed.success) return parsed.response
        return successResponse(
          listKnowledgeDocumentsContract,
          await listDocumentsOperation(parsed.data.params.id, parsed.data.query, context)
        )
      }
      case 'knowledge_list_tags': {
        policy = internalKnowledgeErrorPolicies.tags
        const parsed = parseInternalContractInput(listTagDefinitionsContract, input)
        if (!parsed.success) return parsed.response
        return successResponse(
          listTagDefinitionsContract,
          await listTagsOperation(parsed.data.params.id, context)
        )
      }
      case 'knowledge_search': {
        policy = internalKnowledgeErrorPolicies.search
        const parsed = parseInternalContractInput(internalKnowledgeSearchContract, input, {
          maxInputBytes: MAX_KNOWLEDGE_BODY_BYTES,
        })
        if (!parsed.success) return parsed.response
        return successResponse(
          internalKnowledgeSearchContract,
          await searchOperation(parsed.data.body, context)
        )
      }
      case 'knowledge_trigger_sync': {
        policy = internalKnowledgeErrorPolicies.connectors
        const parsed = parseInternalContractInput(triggerKnowledgeConnectorSyncContract, input)
        if (!parsed.success) return parsed.response
        return successResponse(
          triggerKnowledgeConnectorSyncContract,
          await syncConnectorOperation(
            parsed.data.params.id,
            parsed.data.params.connectorId,
            parsed.data.query.rehydrate,
            context
          )
        )
      }
      case 'knowledge_update_chunk': {
        policy = internalKnowledgeErrorPolicies.chunks
        const parsed = parseInternalContractInput(updateKnowledgeChunkContract, input)
        if (!parsed.success) return parsed.response
        return successResponse(
          updateKnowledgeChunkContract,
          await updateChunkOperation(
            parsed.data.params.id,
            parsed.data.params.documentId,
            parsed.data.params.chunkId,
            parsed.data.body,
            context
          )
        )
      }
      case 'knowledge_upload_chunk': {
        policy = internalKnowledgeErrorPolicies.chunks
        const parsed = parseInternalContractInput(createKnowledgeChunkContract, input)
        if (!parsed.success) return parsed.response
        return successResponse(
          createKnowledgeChunkContract,
          await createChunkOperation(
            parsed.data.params.id,
            parsed.data.params.documentId,
            parsed.data.body,
            context
          )
        )
      }
      case 'knowledge_upsert_document': {
        policy = internalKnowledgeErrorPolicies.upsert
        const parsed = parseInternalContractInput(upsertKnowledgeDocumentContract, input, {
          maxInputBytes: MAX_KNOWLEDGE_BODY_BYTES,
        })
        if (!parsed.success) return parsed.response
        return successResponse(
          upsertKnowledgeDocumentContract,
          await upsertDocumentOperation(parsed.data.params.id, parsed.data.body, context)
        )
      }
      default:
        return Response.json({ error: `Unsupported Knowledge tool: ${toolId}` }, { status: 500 })
    }
  } catch (error) {
    return projectError(policy, error, requestId, signal)
  }
}
