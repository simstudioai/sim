import { z } from 'zod'
import {
  credentialWorkflowBodySchema,
  definePostSelector,
  fileOptionSchema,
  idDisplayNameSchema,
  optionalString,
} from '@/lib/api/contracts/selectors/shared'
import type { ContractBody, ContractJsonResponse } from '@/lib/api/contracts/types'

export const sharepointListsBodySchema = credentialWorkflowBodySchema.extend({
  siteId: z.string().min(1),
})

export const sharepointSitesBodySchema = credentialWorkflowBodySchema.extend({
  query: optionalString,
})

export const sharepointListsSelectorContract = definePostSelector(
  '/api/tools/sharepoint/lists',
  sharepointListsBodySchema,
  z.object({ lists: z.array(idDisplayNameSchema) })
)

export const sharepointSitesSelectorContract = definePostSelector(
  '/api/tools/sharepoint/sites',
  sharepointSitesBodySchema,
  z.object({ files: z.array(fileOptionSchema) })
)

export type SharepointListsSelectorResponse = ContractJsonResponse<
  typeof sharepointListsSelectorContract
>
export type SharepointListsSelectorBody = ContractBody<typeof sharepointListsSelectorContract>
export type SharepointSitesSelectorResponse = ContractJsonResponse<
  typeof sharepointSitesSelectorContract
>
export type SharepointSitesSelectorBody = ContractBody<typeof sharepointSitesSelectorContract>
