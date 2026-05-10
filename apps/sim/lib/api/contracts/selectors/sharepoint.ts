import { z } from 'zod'
import {
  credentialWorkflowBodySchema,
  defineGetSelector,
  definePostSelector,
  fileOptionSchema,
  idDisplayNameSchema,
  optionalString,
} from '@/lib/api/contracts/selectors/shared'
import type { ContractBody, ContractJsonResponse, ContractQuery } from '@/lib/api/contracts/types'

const sharepointListsBodySchema = credentialWorkflowBodySchema.extend({
  siteId: z.string().min(1),
})

const sharepointSitesBodySchema = credentialWorkflowBodySchema.extend({
  query: optionalString,
})

export const sharepointSiteQuerySchema = z.object({
  credentialId: z.preprocess(
    (value) => value ?? '',
    z.string().min(1, 'Credential ID and Site ID are required')
  ),
  siteId: z.preprocess(
    (value) => value ?? '',
    z.string().min(1, 'Credential ID and Site ID are required')
  ),
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

export const sharepointSiteSelectorContract = defineGetSelector(
  '/api/tools/sharepoint/site',
  sharepointSiteQuerySchema,
  z.object({ site: fileOptionSchema.optional() }).passthrough()
)

type SharepointListsSelectorResponse = ContractJsonResponse<typeof sharepointListsSelectorContract>
type SharepointListsSelectorBody = ContractBody<typeof sharepointListsSelectorContract>
type SharepointSitesSelectorResponse = ContractJsonResponse<typeof sharepointSitesSelectorContract>
type SharepointSitesSelectorBody = ContractBody<typeof sharepointSitesSelectorContract>
type SharepointSiteSelectorResponse = ContractJsonResponse<typeof sharepointSiteSelectorContract>
type SharepointSiteSelectorQuery = ContractQuery<typeof sharepointSiteSelectorContract>
