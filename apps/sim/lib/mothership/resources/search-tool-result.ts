import { z } from 'zod'
import {
  searchWorkspaceInputSchema,
  workspaceKnowledgeSearchDataSchema,
} from '@/lib/api/contracts/mothership-assistant-tools'
import { intersectWorkspaceSearchFilters } from '@/lib/knowledge/search/filters'
import { createSearchResource } from '@/lib/mothership/resources/search'
import type { ServerToolContext } from '@/lib/mothership/tools/server/base-tool'

const successfulSearch = z.object({
  success: z.literal(true),
  data: z.object({ query: z.string().trim().min(1).max(2000) }).passthrough(),
})

/** Project only an authorized successful search; the result carries its secret-safe query. */
export function searchResourceFromToolResult(
  params: unknown,
  output: unknown,
  context: ServerToolContext
) {
  const result = successfulSearch.safeParse(output)
  if (!result.success) return undefined
  const scope = context.organizationId
    ? { kind: 'organization' as const, organizationId: context.organizationId }
    : context.workspaceId
      ? { kind: 'workspace' as const, workspaceId: context.workspaceId }
      : undefined
  if (!scope) return undefined
  const { topK, query: _query, ...requestedFilters } = searchWorkspaceInputSchema.parse(params)
  return createSearchResource({
    query: result.data.data.query,
    scope,
    filters: intersectWorkspaceSearchFilters(requestedFilters, context.assistantSearch),
    topK,
  })
}

/** Live-only panel data is carried beside the address, never stored as a chat resource. */
export function searchResultFromToolResult(output: unknown, actorUserId?: string) {
  const result = successfulSearch.safeParse(output)
  if (!result.success || !actorUserId) return undefined
  const parsed = workspaceKnowledgeSearchDataSchema.safeParse(result.data.data)
  return parsed.success ? { actorUserId, data: parsed.data } : undefined
}
