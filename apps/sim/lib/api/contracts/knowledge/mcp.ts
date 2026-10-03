import { z } from 'zod'
import { workspaceSearchFiltersSchema } from '@/lib/api/contracts/knowledge/search'
import { mcpJsonRpcMessageSchema } from '@/lib/api/contracts/mcp'
import {
  readDocumentInputSchema,
  searchWorkspaceInputSchema,
} from '@/lib/api/contracts/mothership-assistant-tools'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const organizationKnowledgeMcpContract = defineRouteContract({
  method: 'POST',
  path: '/api/mcp/search/organizations/[organizationId]',
  params: z.object({ organizationId: organizationIdSchema }),
  body: mcpJsonRpcMessageSchema,
  response: { mode: 'json', schema: mcpJsonRpcMessageSchema },
})

export const liveSearchMcpSchema = searchWorkspaceInputSchema.strict()
export const readLiveDocumentMcpSchema = readDocumentInputSchema.strict()

export const chatSearchMcpSchema = workspaceSearchFiltersSchema
  .extend({
    query: z.string().trim().min(1, 'A question is required').max(8192),
  })
  .strict()
