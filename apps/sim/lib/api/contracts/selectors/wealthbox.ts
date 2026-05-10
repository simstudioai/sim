import { z } from 'zod'
import { defineGetSelector, optionalString } from '@/lib/api/contracts/selectors/shared'
import type { ContractJsonResponse } from '@/lib/api/contracts/types'

const WEALTHBOX_ITEM_TYPES = ['note', 'contact', 'task'] as const

const wealthboxItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  content: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const wealthboxItemsResponseSchema = z.object({
  items: z.array(wealthboxItemSchema),
})

const wealthboxItemResponseSchema = z.object({
  item: wealthboxItemSchema.optional(),
})

const wealthboxItemsQuerySchema = z.object({
  credentialId: z.string().min(1),
  type: z.preprocess(
    (value) => (value === '' || value === undefined ? 'contact' : value),
    z.literal('contact').default('contact')
  ),
  query: z.preprocess(
    (value) => (value === undefined || value === null ? '' : value),
    optionalString.default('')
  ),
})

const wealthboxItemQuerySchema = z.object({
  credentialId: z.preprocess(
    (value) => value ?? '',
    z.string().min(1, 'Credential ID is required')
  ),
  itemId: z.preprocess((value) => value ?? '', z.string().min(1, 'Item ID is required')),
  type: z.preprocess(
    (value) => value || 'note',
    z.enum(WEALTHBOX_ITEM_TYPES, { error: 'type must be one of: note, contact, task' })
  ),
})

export const wealthboxItemsSelectorContract = defineGetSelector(
  '/api/tools/wealthbox/items',
  wealthboxItemsQuerySchema,
  wealthboxItemsResponseSchema
)

export const wealthboxItemContract = defineGetSelector(
  '/api/tools/wealthbox/item',
  wealthboxItemQuerySchema,
  wealthboxItemResponseSchema
)

export const wealthboxOAuthItemsContract = defineGetSelector(
  '/api/auth/oauth/wealthbox/items',
  wealthboxItemsQuerySchema,
  wealthboxItemsResponseSchema
)

export const wealthboxOAuthItemContract = defineGetSelector(
  '/api/auth/oauth/wealthbox/item',
  wealthboxItemQuerySchema,
  wealthboxItemResponseSchema
)

type WealthboxItemsSelectorResponse = ContractJsonResponse<typeof wealthboxItemsSelectorContract>
type WealthboxItemResponse = ContractJsonResponse<typeof wealthboxItemContract>
type WealthboxOAuthItemsResponse = ContractJsonResponse<typeof wealthboxOAuthItemsContract>
type WealthboxOAuthItemResponse = ContractJsonResponse<typeof wealthboxOAuthItemContract>
