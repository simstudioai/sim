import type { Principal } from '@sim/auth/principal'
import type { NextRequest } from 'next/server'
import {
  deleteKnowledgeChunkContract,
  getKnowledgeChunkContract,
  updateKnowledgeChunkContract,
} from '@/lib/api/contracts/knowledge'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  internalKnowledgeAuthType,
  internalKnowledgeProvenanceUserId,
  toInternalKnowledgeChunk,
} from '@/lib/knowledge/api/internal-route'
import {
  internalKnowledgeErrorPolicies,
  internalKnowledgeSessionOrExecutorAuth,
} from '@/lib/knowledge/api/route-policies'
import {
  finalizeKnowledgePersistedResponse,
  resolveKnowledgeWriteSecretProvenance,
} from '@/lib/knowledge/api/secret-provenance'
import {
  deleteKnowledgeChunk,
  readKnowledgeChunk,
  updateKnowledgeChunk,
} from '@/lib/knowledge/application/chunks'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'

function resolveContentProvenance(
  request: NextRequest,
  principal: Principal,
  payload: unknown,
  workspaceId: string | undefined,
  includeContent: boolean
) {
  const resolved = resolveKnowledgeWriteSecretProvenance({
    headers: request.headers,
    payload,
    authType: internalKnowledgeAuthType(principal),
    userId: internalKnowledgeProvenanceUserId(request.headers, principal, workspaceId),
    ...(workspaceId ? { workspaceId } : {}),
    selectionKeys: includeContent ? ['chunk-content'] : [],
  })
  if (!resolved.success) {
    throw new OrchestrationError('validation', 'Invalid knowledge secret provenance')
  }
  return resolved.provenances?.[0]
}

export const GET = defineInternalJsonRoute({
  contract: getKnowledgeChunkContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.readChunk,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal chunk-read behavior' }),
  errorPolicy: internalKnowledgeErrorPolicies.chunks,
  mapInput: ({ params }) => ({
    knowledgeBaseId: params.id,
    documentId: params.documentId,
    chunkId: params.chunkId,
  }),
  useCase: readKnowledgeChunk,
  present: ({ chunk }) => ({ success: true as const, data: toInternalKnowledgeChunk(chunk) }),
  finalizeResponse: ({ request, principal, result, body }) =>
    finalizeKnowledgePersistedResponse({
      headers: request.headers,
      authType: internalKnowledgeAuthType(principal),
      userId: internalKnowledgeProvenanceUserId(request.headers, principal, result.workspaceId),
      workspaceId: result.workspaceId,
      body,
      chunks: [
        {
          id: result.chunk.id,
          documentId: result.documentId,
          content: result.chunk.content,
          value: result.chunk,
        },
      ],
    }),
})

export const PUT = defineInternalJsonRoute({
  contract: updateKnowledgeChunkContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.updateChunk,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal chunk-update behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.chunks,
  mapInput: ({ params, body }, { principal, request }) => ({
    knowledgeBaseId: params.id,
    documentId: params.documentId,
    chunkId: params.chunkId,
    content: body.content,
    enabled: body.enabled,
    resolveContentProvenance: ({ workspaceId }: { workspaceId?: string }) =>
      resolveContentProvenance(request, principal, body, workspaceId, body.content !== undefined),
  }),
  useCase: updateKnowledgeChunk,
  present: ({ chunk }) => ({ success: true as const, data: toInternalKnowledgeChunk(chunk) }),
  finalizeResponse: ({ request, principal, result, body }) =>
    finalizeKnowledgePersistedResponse({
      headers: request.headers,
      authType: internalKnowledgeAuthType(principal),
      userId: internalKnowledgeProvenanceUserId(request.headers, principal, result.workspaceId),
      workspaceId: result.workspaceId,
      body,
      chunks: [
        {
          id: result.chunk.id,
          documentId: result.documentId,
          content: result.chunk.content,
          value: result.chunk,
        },
      ],
    }),
})

export const DELETE = defineInternalJsonRoute({
  contract: deleteKnowledgeChunkContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.deleteChunk,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal chunk-delete behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.chunks,
  mapInput: ({ params }) => ({
    knowledgeBaseId: params.id,
    documentId: params.documentId,
    chunkId: params.chunkId,
  }),
  useCase: deleteKnowledgeChunk,
  present: () => ({
    success: true as const,
    data: { message: 'Chunk deleted successfully' },
  }),
})
