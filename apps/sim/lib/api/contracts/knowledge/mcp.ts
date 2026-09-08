import { z } from 'zod'
import { mcpJsonRpcMessageSchema } from '@/lib/api/contracts/mcp'
import { organizationIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const knowledgeMcpParamsSchema = z.object({ workspaceId: workspaceIdSchema })

export const knowledgeMcpContract = defineRouteContract({
  method: 'POST',
  path: '/api/mcp/search/[workspaceId]',
  params: knowledgeMcpParamsSchema,
  body: mcpJsonRpcMessageSchema,
  response: { mode: 'json', schema: mcpJsonRpcMessageSchema },
})

export const organizationKnowledgeMcpContract = defineRouteContract({
  method: 'POST',
  path: '/api/mcp/search/organizations/[organizationId]',
  params: z.object({ organizationId: organizationIdSchema }),
  body: mcpJsonRpcMessageSchema,
  response: { mode: 'json', schema: mcpJsonRpcMessageSchema },
})

const knowledgeIdSchema = z.string().min(1, 'Knowledge base ID is required').max(255)
const documentIdSchema = z.string().min(1, 'Document ID is required').max(255)

export const searchDocumentsMcpSchema = z.object({
  query: z.string().trim().min(1, 'Search query is required').max(8192),
  knowledgeBaseIds: z
    .array(knowledgeIdSchema)
    .min(1)
    .max(20)
    .optional()
    .describe('Optional knowledge bases in this workspace. Defaults to its Search index.'),
  topK: z.number().int().min(1).max(50).default(10),
})

export const readDocumentMcpSchema = z.object({
  knowledgeBaseId: knowledgeIdSchema,
  documentId: documentIdSchema,
})

export const listDocumentChunksMcpSchema = readDocumentMcpSchema.extend({
  limit: z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).max(1_000_000).default(0),
})

export type SearchDocumentsMcpInput = z.input<typeof searchDocumentsMcpSchema>
export type ReadDocumentMcpInput = z.input<typeof readDocumentMcpSchema>
export type ListDocumentChunksMcpInput = z.input<typeof listDocumentChunksMcpSchema>
