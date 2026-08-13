import { z } from 'zod'
import { workflowIdSchema } from '@/lib/api/contracts/primitives'
import { definePostSelector } from '@/lib/api/contracts/selectors/shared'
import type { ContractBodyInput, ContractJsonResponse } from '@/lib/api/contracts/types'

export const NETSUITE_SELECTOR_KINDS = ['record_types', 'async_tasks'] as const

const credentialSchema = z
  .string({ error: 'Credential is required' })
  .trim()
  .min(1, 'Credential is required')
  .max(128, 'Credential ID is too long')

const boundedWorkflowIdSchema = workflowIdSchema.trim().max(128, 'Workflow ID is too long')

const commonBodyShape = {
  credential: credentialSchema,
  workflowId: boundedWorkflowIdSchema,
} as const

export const netsuiteObjectsBodySchema = z.discriminatedUnion('kind', [
  z.object({ ...commonBodyShape, kind: z.literal('record_types') }).strict(),
  z
    .object({
      ...commonBodyShape,
      kind: z.literal('async_tasks'),
      jobId: z
        .string({ error: 'Job ID is required to list asynchronous tasks' })
        .trim()
        .min(1, 'Job ID is required to list asynchronous tasks')
        .max(512, 'Job ID is too long'),
    })
    .strict(),
])

export const netsuiteSelectorObjectSchema = z
  .object({
    id: z.string().min(1).max(512),
    label: z.string().min(1).max(1_000),
    detail: z.string().max(2_000).nullable(),
  })
  .strict()

export const netsuiteObjectsSelectorContract = definePostSelector(
  '/api/tools/netsuite/objects',
  netsuiteObjectsBodySchema,
  z.object({ objects: z.array(netsuiteSelectorObjectSchema).max(1_000) }).strict()
)

export type NetSuiteSelectorKind = (typeof NETSUITE_SELECTOR_KINDS)[number]
export type NetSuiteObjectsSelectorBody = ContractBodyInput<typeof netsuiteObjectsSelectorContract>
export type NetSuiteObjectsSelectorResponse = ContractJsonResponse<
  typeof netsuiteObjectsSelectorContract
>
