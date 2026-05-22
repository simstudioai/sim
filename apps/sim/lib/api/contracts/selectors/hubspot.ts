import { z } from 'zod'
import {
  credentialIdQuerySchema,
  defineGetSelector,
  optionalString,
} from '@/lib/api/contracts/selectors/shared'
import type { ContractJsonResponse, ContractQueryInput } from '@/lib/api/contracts/types'

const hubspotPropertySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.string().optional(),
    fieldType: z.string().optional(),
    groupName: z.string().optional(),
  })
  .passthrough()

const hubspotListSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    objectType: z.string().optional(),
    processingType: z.string().optional(),
  })
  .passthrough()

const hubspotPipelineSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    stages: z.array(z.object({ id: z.string(), label: z.string() }).passthrough()).optional(),
  })
  .passthrough()

const hubspotOwnerSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string().optional(),
  })
  .passthrough()

const hubspotPropertiesQuerySchema = credentialIdQuerySchema.extend({
  objectType: z
    .string()
    .min(1, 'objectType is required')
    .describe('Built-in slug or custom object type id'),
  query: optionalString,
})

const hubspotListsQuerySchema = credentialIdQuerySchema.extend({
  objectTypeId: optionalString.describe('Limit to lists targeting this object type'),
  query: optionalString,
})

const hubspotPipelinesQuerySchema = credentialIdQuerySchema.extend({
  objectType: z
    .string()
    .min(1, 'objectType is required')
    .describe("Object type for which to fetch pipelines (e.g., 'deal' or 'ticket')"),
})

const hubspotOwnersQuerySchema = credentialIdQuerySchema.extend({
  query: optionalString,
})

export const hubspotPropertiesSelectorContract = defineGetSelector(
  '/api/tools/hubspot/properties',
  hubspotPropertiesQuerySchema,
  z.object({ properties: z.array(hubspotPropertySchema) })
)

export const hubspotListsSelectorContract = defineGetSelector(
  '/api/tools/hubspot/lists',
  hubspotListsQuerySchema,
  z.object({ lists: z.array(hubspotListSchema) })
)

export const hubspotPipelinesSelectorContract = defineGetSelector(
  '/api/tools/hubspot/pipelines',
  hubspotPipelinesQuerySchema,
  z.object({ pipelines: z.array(hubspotPipelineSchema) })
)

export const hubspotOwnersSelectorContract = defineGetSelector(
  '/api/tools/hubspot/owners',
  hubspotOwnersQuerySchema,
  z.object({ owners: z.array(hubspotOwnerSchema) })
)

export type HubspotPropertiesSelectorQuery = ContractQueryInput<
  typeof hubspotPropertiesSelectorContract
>
export type HubspotListsSelectorQuery = ContractQueryInput<typeof hubspotListsSelectorContract>
export type HubspotPipelinesSelectorQuery = ContractQueryInput<
  typeof hubspotPipelinesSelectorContract
>
export type HubspotOwnersSelectorQuery = ContractQueryInput<typeof hubspotOwnersSelectorContract>

export type HubspotPropertiesSelectorResponse = ContractJsonResponse<
  typeof hubspotPropertiesSelectorContract
>
export type HubspotListsSelectorResponse = ContractJsonResponse<typeof hubspotListsSelectorContract>
export type HubspotPipelinesSelectorResponse = ContractJsonResponse<
  typeof hubspotPipelinesSelectorContract
>
export type HubspotOwnersSelectorResponse = ContractJsonResponse<
  typeof hubspotOwnersSelectorContract
>
