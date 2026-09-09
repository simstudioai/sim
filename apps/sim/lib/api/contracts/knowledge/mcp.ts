import { z } from 'zod'
import { workspaceSearchFiltersSchema } from '@/lib/api/contracts/knowledge/search'
import { mcpJsonRpcMessageSchema } from '@/lib/api/contracts/mcp'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const organizationKnowledgeMcpContract = defineRouteContract({
  method: 'POST',
  path: '/api/mcp/search/organizations/[organizationId]',
  params: z.object({ organizationId: organizationIdSchema }),
  body: mcpJsonRpcMessageSchema,
  response: { mode: 'json', schema: mcpJsonRpcMessageSchema },
})

const documentIdSchema = z.string().min(1, 'Document ID is required').max(255)

export const searchMcpSchema = workspaceSearchFiltersSchema
  .extend({
    query: z.string().trim().min(1, 'Search query is required').max(8192),
    topK: z.number().int().min(1).max(50).default(10),
  })
  .strict()

export const readDocumentMcpSchema = z
  .object({
    documentId: documentIdSchema.optional(),
    url: z
      .string()
      .trim()
      .url('Provide the original document URL')
      .max(8192)
      .refine((value) => {
        if (!URL.canParse(value)) return false
        const url = new URL(value)
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      }, 'Document URL must use HTTP or HTTPS without credentials')
      .optional(),
    limit: z.number().int().min(1).max(50).default(20),
    offset: z.number().int().min(0).max(1_000_000).optional(),
    aroundChunkIndex: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (Boolean(input.documentId) === Boolean(input.url)) {
      ctx.addIssue({
        code: 'custom',
        path: ['documentId'],
        message: 'Provide either a document ID or its original URL',
      })
    }
    if (input.offset !== undefined && input.aroundChunkIndex !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['aroundChunkIndex'],
        message: 'Use either an offset or a matching chunk index',
      })
    }
  })

export const chatSearchMcpSchema = workspaceSearchFiltersSchema
  .extend({
    query: z.string().trim().min(1, 'A question is required').max(8192),
  })
  .strict()

export type SearchMcpInput = z.input<typeof searchMcpSchema>
export type ReadDocumentMcpInput = z.input<typeof readDocumentMcpSchema>
