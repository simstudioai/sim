import { v2AddWorkspaceFilesToKnowledgeBaseContract } from '@/lib/api/contracts/v2/knowledge'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { addWorkspaceFilesToKnowledgeBase } from '@/lib/knowledge/application/add-workspace-files'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * POST /api/v2/knowledge/[knowledgeBaseId]/documents/from-workspace-files — Index files the
 * workspace already stores.
 *
 * Without it a file the server already holds has to be downloaded and re-uploaded
 * byte-for-byte through `POST /api/v2/knowledge/{knowledgeBaseId}/documents` purely to be
 * indexed. Each reference is authorized against the file's own canonical context.
 *
 * The use case's cancellation checkpoint is not wired here: the v2 builder maps
 * input from the parsed request alone, and no signal reaches it, so the batch
 * always runs to completion and `cancelled` never appears in the response.
 * Partial outcomes are reported through `failed` instead.
 */
export const POST = defineV2JsonRoute({
  contract: v2AddWorkspaceFilesToKnowledgeBaseContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.addWorkspaceFiles,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseUsageAuthorization,
  mapInput: ({ params, body }) => ({
    knowledgeBaseId: params.knowledgeBaseId,
    assertedWorkspaceId: body.workspaceId,
    fileReferences: body.fileReferences,
    source: 'api' as const,
  }),
  useCase: addWorkspaceFilesToKnowledgeBase,
  present: ({ knowledgeBaseId, added, failed }) => ({
    data: { knowledgeBaseId, added, failed },
  }),
})
