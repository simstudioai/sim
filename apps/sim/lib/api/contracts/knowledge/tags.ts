import { z } from 'zod'
import {
  knowledgeBaseParamsSchema,
  knowledgeDocumentParamsSchema,
  knowledgeTagParamsSchema,
  successResponseSchema,
} from '@/lib/api/contracts/knowledge/shared'
import { defineRouteContract } from '@/lib/api/contracts/types'

const nextAvailableSlotQuerySchema = z.object({
  fieldType: z.string().min(1),
})

const createTagDefinitionBodySchema = z.object({
  tagSlot: z.string().min(1, 'Tag slot is required'),
  displayName: z.string().min(1, 'Display name is required'),
  fieldType: z.string().min(1, 'Invalid field type'),
})

const documentTagDefinitionInputSchema = z.object({
  tagSlot: z.string().min(1, 'Tag slot is required'),
  displayName: z.string().min(1, 'Display name is required').max(100, 'Display name too long'),
  fieldType: z.string().default('text'),
  _originalDisplayName: z.string().optional(),
})

const saveDocumentTagDefinitionsBodySchema = z.object({
  definitions: z.array(documentTagDefinitionInputSchema),
})

const deleteDocumentTagDefinitionsQuerySchema = z.object({
  action: z.enum(['cleanup', 'all']).optional(),
})

const tagDefinitionDataSchema = z.object({
  id: z.string(),
  tagSlot: z.string(),
  displayName: z.string(),
  fieldType: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type TagDefinitionData = z.output<typeof tagDefinitionDataSchema>
export type DocumentTagDefinitionData = TagDefinitionData

const nextAvailableSlotDataSchema = z.object({
  nextAvailableSlot: z.string().nullable(),
  fieldType: z.string(),
  usedSlots: z.array(z.string()),
  totalSlots: z.number(),
  availableSlots: z.number(),
})
export type NextAvailableSlotData = z.output<typeof nextAvailableSlotDataSchema>

const saveDocumentTagDefinitionsDataSchema = z
  .object({
    created: z.array(tagDefinitionDataSchema).optional(),
    updated: z.array(tagDefinitionDataSchema).optional(),
    errors: z.array(z.string()).optional(),
  })
  .or(z.array(tagDefinitionDataSchema))
export type SaveDocumentTagDefinitionsResult = z.output<typeof saveDocumentTagDefinitionsDataSchema>

const tagUsageDocumentSchema = z.object({
  id: z.string(),
  name: z.string(),
  tagValue: z.string(),
})

const tagUsageDataSchema = z.object({
  tagName: z.string(),
  tagSlot: z.string(),
  documentCount: z.number(),
  documents: z.array(tagUsageDocumentSchema),
})

export type TagUsageData = z.output<typeof tagUsageDataSchema>

export const listTagDefinitionsContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/[id]/tag-definitions',
  params: knowledgeBaseParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.array(tagDefinitionDataSchema)),
  },
})

export const createTagDefinitionContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/[id]/tag-definitions',
  params: knowledgeBaseParamsSchema,
  body: createTagDefinitionBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(tagDefinitionDataSchema),
  },
})

export const deleteTagDefinitionContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/knowledge/[id]/tag-definitions/[tagId]',
  params: knowledgeTagParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true) }).passthrough(),
  },
})

export const nextAvailableSlotContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/[id]/next-available-slot',
  params: knowledgeBaseParamsSchema,
  query: nextAvailableSlotQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(nextAvailableSlotDataSchema),
  },
})

export const listDocumentTagDefinitionsContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/[id]/documents/[documentId]/tag-definitions',
  params: knowledgeDocumentParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.array(tagDefinitionDataSchema)),
  },
})

export const saveDocumentTagDefinitionsContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/[id]/documents/[documentId]/tag-definitions',
  params: knowledgeDocumentParamsSchema,
  body: saveDocumentTagDefinitionsBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(saveDocumentTagDefinitionsDataSchema),
  },
})

export const deleteDocumentTagDefinitionsContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/knowledge/[id]/documents/[documentId]/tag-definitions',
  params: knowledgeDocumentParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true) }).passthrough(),
  },
})

export const getTagUsageContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/[id]/tag-usage',
  params: knowledgeBaseParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.array(tagUsageDataSchema)),
  },
})
