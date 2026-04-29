import { z } from 'zod'
import { optionalString } from '@/lib/api/contracts/selectors/shared'
import type { ContractJsonResponse } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const knowledgeDocumentsParamsSchema = z.object({ id: z.string().min(1) })

const knowledgeDocumentParamsSchema = knowledgeDocumentsParamsSchema.extend({
  documentId: z.string().min(1),
})

const knowledgeDocumentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: optionalString,
})

const knowledgeDocumentQuerySchema = z.object({
  includeDisabled: optionalString,
})

const knowledgeDocumentSchema = z.object({ id: z.string(), filename: z.string() }).passthrough()

export const listKnowledgeSelectorDocumentsContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/[id]/documents',
  params: knowledgeDocumentsParamsSchema,
  query: knowledgeDocumentsQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      data: z
        .object({
          documents: z.array(knowledgeDocumentSchema),
          pagination: z
            .object({
              total: z.number(),
              limit: z.number(),
              offset: z.number(),
              hasMore: z.boolean(),
            })
            .passthrough(),
        })
        .passthrough(),
    }),
  },
})

export const getKnowledgeSelectorDocumentContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/[id]/documents/[documentId]',
  params: knowledgeDocumentParamsSchema,
  query: knowledgeDocumentQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      data: knowledgeDocumentSchema,
    }),
  },
})

export type ListKnowledgeSelectorDocumentsResponse = ContractJsonResponse<
  typeof listKnowledgeSelectorDocumentsContract
>
export type GetKnowledgeSelectorDocumentResponse = ContractJsonResponse<
  typeof getKnowledgeSelectorDocumentContract
>
