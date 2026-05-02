import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const onePasswordCredentialsBodySchema = z.object({
  connectionMode: z.enum(['service_account', 'connect']).nullish(),
  serviceAccountToken: z.string().nullish(),
  serverUrl: z.string().nullish(),
  apiKey: z.string().nullish(),
})

export const onePasswordListVaultsBodySchema = onePasswordCredentialsBodySchema.extend({
  filter: z.string().nullish(),
})

export const onePasswordGetVaultBodySchema = onePasswordCredentialsBodySchema.extend({
  vaultId: z.string().min(1, 'Vault ID is required'),
})

export const onePasswordListItemsBodySchema = onePasswordGetVaultBodySchema.extend({
  filter: z.string().nullish(),
})

export const onePasswordGetItemBodySchema = onePasswordGetVaultBodySchema.extend({
  itemId: z.string().min(1, 'Item ID is required'),
})

export const onePasswordCreateItemBodySchema = onePasswordGetVaultBodySchema.extend({
  category: z.string().min(1, 'Category is required'),
  title: z.string().nullish(),
  tags: z.string().nullish(),
  fields: z.string().nullish(),
})

export const onePasswordUpdateItemBodySchema = onePasswordGetItemBodySchema.extend({
  operations: z.string().min(1, 'Patch operations are required'),
})

export const onePasswordReplaceItemBodySchema = onePasswordGetItemBodySchema.extend({
  item: z.string().min(1, 'Item JSON is required'),
})

export const onePasswordDeleteItemBodySchema = onePasswordGetItemBodySchema

export const onePasswordResolveSecretBodySchema = onePasswordCredentialsBodySchema.extend({
  secretReference: z.string().min(1, 'Secret reference is required'),
})

export const onePasswordListVaultsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/onepassword/list-vaults',
  body: onePasswordListVaultsBodySchema,
  response: {
    mode: 'json',
    // untyped-response: service-account mode returns normalized vault shapes while connect-server mode forwards 1Password Connect /v1/vaults response unchanged
    schema: z.unknown(),
  },
})

export const onePasswordGetVaultContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/onepassword/get-vault',
  body: onePasswordGetVaultBodySchema,
  response: {
    mode: 'json',
    // untyped-response: service-account mode returns a normalized vault shape while connect-server mode forwards 1Password Connect /v1/vaults/{id} response unchanged
    schema: z.unknown(),
  },
})

export const onePasswordListItemsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/onepassword/list-items',
  body: onePasswordListItemsBodySchema,
  response: {
    mode: 'json',
    // untyped-response: service-account mode returns normalized item-overview shapes while connect-server mode forwards 1Password Connect /v1/vaults/{id}/items response unchanged
    schema: z.unknown(),
  },
})

export const onePasswordGetItemContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/onepassword/get-item',
  body: onePasswordGetItemBodySchema,
  response: {
    mode: 'json',
    // untyped-response: service-account mode returns a normalized item shape while connect-server mode forwards 1Password Connect /v1/vaults/{vaultId}/items/{itemId} response unchanged
    schema: z.unknown(),
  },
})

export const onePasswordCreateItemContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/onepassword/create-item',
  body: onePasswordCreateItemBodySchema,
  response: {
    mode: 'json',
    // untyped-response: service-account mode returns a normalized item shape while connect-server mode forwards 1Password Connect create-item response unchanged
    schema: z.unknown(),
  },
})

export const onePasswordUpdateItemContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/onepassword/update-item',
  body: onePasswordUpdateItemBodySchema,
  response: {
    mode: 'json',
    // untyped-response: service-account mode returns a normalized item shape while connect-server mode forwards 1Password Connect PATCH item response unchanged
    schema: z.unknown(),
  },
})

export const onePasswordReplaceItemContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/onepassword/replace-item',
  body: onePasswordReplaceItemBodySchema,
  response: {
    mode: 'json',
    // untyped-response: service-account mode returns a normalized item shape while connect-server mode forwards 1Password Connect PUT item response unchanged
    schema: z.unknown(),
  },
})

const onePasswordDeleteItemResponseSchema = z.object({
  success: z.literal(true),
})

export const onePasswordDeleteItemContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/onepassword/delete-item',
  body: onePasswordDeleteItemBodySchema,
  response: {
    mode: 'json',
    schema: onePasswordDeleteItemResponseSchema,
  },
})

const onePasswordResolveSecretResponseSchema = z.object({
  value: z.string(),
  reference: z.string(),
})

export const onePasswordResolveSecretContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/onepassword/resolve-secret',
  body: onePasswordResolveSecretBodySchema,
  response: {
    mode: 'json',
    schema: onePasswordResolveSecretResponseSchema,
  },
})
