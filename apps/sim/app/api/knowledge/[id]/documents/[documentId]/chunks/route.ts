import type { Principal } from '@sim/auth/principal'
import type { NextRequest } from 'next/server'
import {
  bulkKnowledgeChunksContract,
  createKnowledgeChunkContract,
  listKnowledgeChunksContract,
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
  bulkUpdateKnowledgeChunks,
  createKnowledgeChunk,
  listKnowledgeChunks,
} from '@/lib/knowledge/application/chunks'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  finalizeKnowledgePersistedResponse,
  finalizeKnowledgeProvenanceResponse,
  resolveKnowledgeWriteSecretProvenance,
} from '@/app/api/knowledge/secret-provenance'

function resolveContentProvenance(
  request: NextRequest,
  principal: Principal,
  payload: unknown,
  workspaceId: string | undefined,
  includeContent: boolean
) {
  const resolved = resolveKnowledgeWriteSecretProvenance({
    request,
    payload,
    authType: internalKnowledgeAuthType(principal),
    userId: internalKnowledgeProvenanceUserId(request, principal, workspaceId),
    ...(workspaceId ? { workspaceId } : {}),
    selectionKeys: includeContent ? ['chunk-content'] : [],
  })
  if (!resolved.success) {
    throw new OrchestrationError('validation', 'Invalid knowledge secret provenance')
  }
  return resolved.provenances?.[0]
}

export const GET = defineInternalJsonRoute({
  contract: listKnowledgeChunksContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.listChunks,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal chunk-list behavior' }),
  errorPolicy: internalKnowledgeErrorPolicies.chunkList,
  mapInput: ({ params, query }) => ({
    knowledgeBaseId: params.id,
    documentId: params.documentId,
    ...query,
  }),
  useCase: listKnowledgeChunks,
  present: ({ chunks, pagination }) => ({
    success: true as const,
    data: chunks.map(toInternalKnowledgeChunk),
    pagination,
  }),
  finalizeResponse: ({ request, principal, result, body }) =>
    finalizeKnowledgePersistedResponse({
      request,
      authType: internalKnowledgeAuthType(principal),
      userId: internalKnowledgeProvenanceUserId(request, principal, result.workspaceId),
      workspaceId: result.workspaceId,
      body,
      chunks: result.chunks.map((chunk) => ({
        id: chunk.id,
        documentId: result.documentId,
        content: chunk.content,
        value: chunk,
      })),
    }),
})

export const POST = defineInternalJsonRoute({
  contract: createKnowledgeChunkContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.createChunk,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal chunk-create behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.chunks,
  mapInput: ({ params, body }, { principal, request }) => ({
    knowledgeBaseId: params.id,
    documentId: params.documentId,
    content: body.content,
    enabled: body.enabled,
    resolveContentProvenance: ({ workspaceId }: { workspaceId?: string }) =>
      resolveContentProvenance(request, principal, body, workspaceId, true),
  }),
  useCase: createKnowledgeChunk,
  present: ({ chunk }) => ({ success: true as const, data: toInternalKnowledgeChunk(chunk) }),
  finalizeResponse: ({ request, principal, result, body }) =>
    finalizeKnowledgeProvenanceResponse({
      request,
      authType: internalKnowledgeAuthType(principal),
      userId: result.userId,
      workspaceId: result.workspaceId,
      body,
      provenances: result.provenance ? [result.provenance] : [],
    }),
})

export const PATCH = defineInternalJsonRoute({
  contract: bulkKnowledgeChunksContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.bulkChunks,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal bulk-chunk behavior' }),
  errorPolicy: internalKnowledgeErrorPolicies.chunks,
  mapInput: ({ params, body }) => ({
    knowledgeBaseId: params.id,
    documentId: params.documentId,
    ...body,
  }),
  useCase: bulkUpdateKnowledgeChunks,
  present: (data) => ({ success: true as const, data }),
})
