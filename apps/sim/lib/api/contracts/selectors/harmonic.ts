import { z } from 'zod'
import { workflowIdSchema } from '@/lib/api/contracts/primitives'
import { definePostSelector } from '@/lib/api/contracts/selectors/shared'
import type { ContractBodyInput, ContractJsonResponse } from '@/lib/api/contracts/types'

export const HARMONIC_SAVED_SEARCH_SELECTOR_MAX_OPTIONS = 500

const harmonicCredentialSchema = z
  .string({ error: 'Credential is required' })
  .trim()
  .min(1, 'Credential is required')
  .max(128, 'Credential ID is too long')

const harmonicWorkflowIdSchema = workflowIdSchema
  .trim()
  .min(1, 'Workflow ID is required')
  .max(128, 'Workflow ID is too long')

export const harmonicSavedSearchesBodySchema = z
  .object({
    credential: harmonicCredentialSchema,
    workflowId: harmonicWorkflowIdSchema,
  })
  .strict()

const harmonicSavedSearchIdSchema = z.string().regex(/^-?\d+$/, 'Invalid Harmonic saved-search ID')
const harmonicSavedSearchUrnSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .regex(/^urn:harmonic:saved_search:[^\s]+$/, 'Invalid Harmonic saved-search URN')
const harmonicSavedSearchNameSchema = z.string().trim().min(1).max(1_000)

/** Validates the documented fields consumed from a PERSONS saved-search row. */
export const harmonicPeopleSavedSearchProviderSchema = z
  .object({
    id: z.number().int().safe(),
    entity_urn: harmonicSavedSearchUrnSchema,
    name: harmonicSavedSearchNameSchema,
    type: z.literal('PERSONS'),
  })
  .passthrough()

export const harmonicSavedSearchSelectorOptionSchema = z
  .object({
    id: harmonicSavedSearchIdSchema,
    urn: harmonicSavedSearchUrnSchema,
    name: harmonicSavedSearchNameSchema,
  })
  .strict()

export const harmonicSavedSearchesSelectorContract = definePostSelector(
  '/api/tools/harmonic/saved-searches',
  harmonicSavedSearchesBodySchema,
  z
    .object({
      savedSearches: z
        .array(harmonicSavedSearchSelectorOptionSchema)
        .max(HARMONIC_SAVED_SEARCH_SELECTOR_MAX_OPTIONS),
    })
    .strict()
)

export type HarmonicSavedSearchesSelectorBody = ContractBodyInput<
  typeof harmonicSavedSearchesSelectorContract
>
export type HarmonicSavedSearchesSelectorResponse = ContractJsonResponse<
  typeof harmonicSavedSearchesSelectorContract
>
