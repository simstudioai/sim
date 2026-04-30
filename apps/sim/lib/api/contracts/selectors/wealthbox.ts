import { z } from 'zod'
import {
  defineGetSelector,
  idNameSchema,
  optionalString,
} from '@/lib/api/contracts/selectors/shared'
import type { ContractJsonResponse } from '@/lib/api/contracts/types'

export const WEALTHBOX_ITEM_TYPES = ['note', 'contact', 'task'] as const

export const wealthboxItemsQuerySchema = z.object({
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

export const wealthboxItemQuerySchema = z.object({
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
  z.object({ items: z.array(idNameSchema) })
)

export const wealthboxItemContract = defineGetSelector(
  '/api/tools/wealthbox/item',
  wealthboxItemQuerySchema,
  z.object({ item: idNameSchema.passthrough() })
)

export const wealthboxOAuthItemsContract = defineGetSelector(
  '/api/auth/oauth/wealthbox/items',
  wealthboxItemsQuerySchema,
  z.object({}).passthrough()
)

export const wealthboxOAuthItemContract = defineGetSelector(
  '/api/auth/oauth/wealthbox/item',
  wealthboxItemQuerySchema,
  z.object({}).passthrough()
)

export type WealthboxItemsSelectorResponse = ContractJsonResponse<
  typeof wealthboxItemsSelectorContract
>
export type WealthboxItemResponse = ContractJsonResponse<typeof wealthboxItemContract>
export type WealthboxOAuthItemsResponse = ContractJsonResponse<typeof wealthboxOAuthItemsContract>
export type WealthboxOAuthItemResponse = ContractJsonResponse<typeof wealthboxOAuthItemContract>
