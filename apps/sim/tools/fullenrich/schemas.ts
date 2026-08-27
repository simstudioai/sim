import { z } from 'zod'

const nonEmptyStringSchema = z.string().trim().min(1)
const customValuesSchema = z.record(z.string(), z.string())

export const fullEnrichNameSchema = nonEmptyStringSchema
export const fullEnrichIdSchema = nonEmptyStringSchema
export const fullEnrichWebhookUrlSchema = z.url()

export const fullEnrichContactSchema = z
  .object({
    first_name: nonEmptyStringSchema.optional(),
    last_name: nonEmptyStringSchema.optional(),
    domain: nonEmptyStringSchema.optional(),
    company_name: nonEmptyStringSchema.optional(),
    linkedin_url: nonEmptyStringSchema.optional(),
    enrich_fields: z
      .array(z.enum(['contact.work_emails', 'contact.phones', 'contact.personal_emails']))
      .min(1),
    custom: customValuesSchema.refine((value) => Object.keys(value).length <= 20).optional(),
  })
  .strict()
  .refine(
    (contact) =>
      Boolean(contact.linkedin_url) ||
      Boolean(contact.first_name && contact.last_name && (contact.domain || contact.company_name)),
    {
      message:
        'Each contact requires linkedin_url, or first_name and last_name with domain or company_name',
    }
  )

export const fullEnrichContactsSchema = z.array(fullEnrichContactSchema).min(1).max(100)

export const fullEnrichReverseEmailSchema = z
  .object({
    email: z.string().trim().email(),
    custom: customValuesSchema
      .refine((value) => Object.keys(value).length <= 10)
      .refine((value) => Object.values(value).every((item) => item.length <= 100))
      .optional(),
  })
  .strict()

export const fullEnrichReverseEmailsSchema = z.array(fullEnrichReverseEmailSchema).min(1).max(100)

const stringFilterSchema = z
  .object({
    value: z.string().optional(),
    exclude: z.boolean().optional(),
    exact_match: z.boolean().optional(),
  })
  .strict()

const integerFilterSchema = z
  .object({
    value: z.number().int().optional(),
    exclude: z.boolean().optional(),
    exact_match: z.boolean().optional(),
  })
  .strict()

const rangeFilterSchema = z
  .object({
    min: z.number().int().optional(),
    max: z.number().int().optional(),
    exclude: z.boolean().optional(),
  })
  .strict()

const stringFiltersSchema = z.array(stringFilterSchema)
const integerFiltersSchema = z.array(integerFilterSchema)
const rangeFiltersSchema = z.array(rangeFilterSchema)

export const fullEnrichPeopleFiltersSchema = z
  .object({
    current_company_names: stringFiltersSchema.optional(),
    current_company_domains: stringFiltersSchema.optional(),
    current_company_professional_network_ids: integerFiltersSchema.optional(),
    current_company_professional_network_urls: stringFiltersSchema.optional(),
    current_company_specialties: stringFiltersSchema.optional(),
    current_company_industries: stringFiltersSchema.optional(),
    past_company_names: stringFiltersSchema.optional(),
    past_company_domains: stringFiltersSchema.optional(),
    current_company_types: stringFiltersSchema.optional(),
    current_company_headquarters: stringFiltersSchema.optional(),
    current_company_headcounts: rangeFiltersSchema.optional(),
    current_company_founded_years: rangeFiltersSchema.optional(),
    current_company_ids: stringFiltersSchema.optional(),
    person_ids: stringFiltersSchema.optional(),
    person_names: stringFiltersSchema.optional(),
    person_professional_network_ids: integerFiltersSchema.optional(),
    person_professional_network_urls: stringFiltersSchema.optional(),
    person_locations: stringFiltersSchema.optional(),
    person_languages: stringFiltersSchema.optional(),
    person_skills: stringFiltersSchema.optional(),
    current_position_seniority_level: stringFiltersSchema.optional(),
    current_position_job_functions: stringFiltersSchema.optional(),
    current_position_sub_functions: stringFiltersSchema.optional(),
    current_position_titles: stringFiltersSchema.optional(),
    past_position_titles: stringFiltersSchema.optional(),
    current_position_years_in: rangeFiltersSchema.optional(),
    current_company_years_at: rangeFiltersSchema.optional(),
    person_universities: stringFiltersSchema.optional(),
    current_company_days_since_last_job_change: rangeFiltersSchema.optional(),
  })
  .strict()

export const fullEnrichCompanyFiltersSchema = z
  .object({
    names: stringFiltersSchema.optional(),
    domains: stringFiltersSchema.optional(),
    professional_network_ids: integerFiltersSchema.optional(),
    professional_network_urls: stringFiltersSchema.optional(),
    keywords: stringFiltersSchema.optional(),
    specialties: stringFiltersSchema.optional(),
    industries: stringFiltersSchema.optional(),
    types: stringFiltersSchema.optional(),
    headquarters_locations: stringFiltersSchema.optional(),
    founded_years: rangeFiltersSchema.optional(),
    headcounts: rangeFiltersSchema.optional(),
    company_ids: stringFiltersSchema.optional(),
  })
  .strict()

export const fullEnrichSearchPaginationSchema = z.object({
  offset: z.number().int().min(0).max(10000).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  search_after: nonEmptyStringSchema.optional(),
})

export const fullEnrichLookupPersonSchema = z
  .object({
    person_name: nonEmptyStringSchema.optional(),
    person_professional_network_url: nonEmptyStringSchema.optional(),
    person_professional_network_id: z.number().int().optional(),
    company_professional_network_url: nonEmptyStringSchema.optional(),
    company_professional_network_id: z.number().int().optional(),
    company_domain: nonEmptyStringSchema.optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'At least one person identifier is required',
  })

export const fullEnrichLookupCompanySchema = z
  .object({
    domain: nonEmptyStringSchema.optional(),
    professional_network_url: nonEmptyStringSchema.optional(),
    professional_network_id: z.number().int().optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'At least one company identifier is required',
  })

const fullEnrichPersonResponseSchema = z.object({}).passthrough()
const fullEnrichCompanyResponseSchema = z.object({}).passthrough()

export const fullEnrichAsyncStartResponseSchema = z.object({
  enrichment_id: nonEmptyStringSchema,
})

export const fullEnrichGetEnrichmentResponseSchema = z.object({
  id: nonEmptyStringSchema,
  name: z.string(),
  status: z.enum([
    'CREATED',
    'IN_PROGRESS',
    'CANCELED',
    'CREDITS_INSUFFICIENT',
    'FINISHED',
    'RATE_LIMIT',
    'UNKNOWN',
  ]),
  data: z.array(z.object({}).passthrough()),
  cost: z.object({ credits: z.number().int().min(0) }),
})

export const fullEnrichSearchPeopleResponseSchema = z.object({
  people: z.array(fullEnrichPersonResponseSchema),
  metadata: z.object({
    total: z.number().int().min(0),
    credits: z.number().min(0),
    offset: z.number().int().min(0),
    search_after: z.string().optional(),
  }),
})

export const fullEnrichSearchCompaniesResponseSchema = z.object({
  companies: z.array(fullEnrichCompanyResponseSchema),
  metadata: z.object({
    total: z.number().int().min(0),
    credits: z.number().min(0),
    offset: z.number().int().min(0),
    search_after: z.string().optional(),
  }),
})

export const fullEnrichLookupPeopleResponseSchema = z.object({
  people: z.array(fullEnrichPersonResponseSchema),
  metadata: z.object({ credits: z.number().min(0) }),
})

export const fullEnrichLookupCompaniesResponseSchema = z.object({
  companies: z.array(fullEnrichCompanyResponseSchema),
  metadata: z.object({ credits: z.number().min(0) }),
})
