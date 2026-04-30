import { z } from 'zod'
import {
  credentialWorkflowBodySchema,
  definePostSelector,
  idNameSchema,
  optionalString,
} from '@/lib/api/contracts/selectors/shared'
import type { ContractJsonResponse } from '@/lib/api/contracts/types'

/**
 * Webflow `/sites` accepts an optional `siteId`. When provided, the route
 * dispatches to the single-site detail endpoint instead of the list endpoint.
 */
export const webflowSitesBodySchema = credentialWorkflowBodySchema.extend({
  siteId: optionalString,
})

export const webflowCollectionsBodySchema = credentialWorkflowBodySchema.extend({
  siteId: z.string().min(1, 'Site ID is required'),
})

export const webflowItemsBodySchema = credentialWorkflowBodySchema.extend({
  collectionId: z.string().min(1, 'Collection ID is required'),
  search: optionalString,
})

export const webflowSitesSelectorContract = definePostSelector(
  '/api/tools/webflow/sites',
  webflowSitesBodySchema,
  z.object({ sites: z.array(idNameSchema) })
)

export const webflowCollectionsSelectorContract = definePostSelector(
  '/api/tools/webflow/collections',
  webflowCollectionsBodySchema,
  z.object({ collections: z.array(idNameSchema) })
)

export const webflowItemsSelectorContract = definePostSelector(
  '/api/tools/webflow/items',
  webflowItemsBodySchema,
  z.object({ items: z.array(idNameSchema) })
)

export type WebflowSitesSelectorResponse = ContractJsonResponse<typeof webflowSitesSelectorContract>
export type WebflowCollectionsSelectorResponse = ContractJsonResponse<
  typeof webflowCollectionsSelectorContract
>
export type WebflowItemsSelectorResponse = ContractJsonResponse<typeof webflowItemsSelectorContract>
