import { z } from 'zod'

export const HARMONIC_SAVED_SEARCH_SELECTOR_MAX_OPTIONS = 500

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
