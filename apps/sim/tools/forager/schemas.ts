import { z } from 'zod'

/**
 * Request and response contracts transcribed from Forager's official OpenAPI document.
 * Source: https://docs.forager.ai/_spec/openapi.json?download=
 */

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const dateTimeSchema = z.string().datetime({ offset: true })
const integerArraySchema = z.array(z.number().int())
const nullableStringSchema = z.string().nullable()
const nullableIntegerSchema = z.number().int().nullable()

const fundingTypeSchema = z.enum([
  'angel',
  'convertible_note',
  'corporate_round',
  'debt_financing',
  'equity_crowdfunding',
  'grant',
  'initial_coin_offering',
  'non_equity_assistance',
  'post_ipo_debt',
  'post_ipo_equity',
  'post_ipo_secondary',
  'pre_seed',
  'private_equity',
  'product_crowdfunding',
  'secondary_market',
  'seed',
  'series_a',
  'series_b',
  'series_c',
  'series_d',
  'series_e',
  'series_f',
  'series_g',
  'series_h',
  'series_i',
  'series_j',
  'series_unknown',
  'undisclosed',
])

const organizationEventFields = {
  funding_types: z.array(fundingTypeSchema).optional(),
  funding_total_start: z.number().int().optional(),
  funding_total_end: z.number().int().optional(),
  funding_event_date_featured_start: dateSchema.optional(),
  funding_event_date_featured_end: dateSchema.optional(),
  job_post_title: z.string().optional(),
  job_post_description: z.string().optional(),
  job_post_is_remote: z.boolean().nullable().optional(),
  job_post_is_active: z.boolean().nullable().optional(),
  job_post_date_featured_start: dateSchema.optional(),
  job_post_date_featured_end: dateSchema.optional(),
  job_post_locations: integerArraySchema.optional(),
  job_post_locations_exclude: integerArraySchema.optional(),
  simple_event_source: z.enum(['product_hunt', 'form_c_sec_gov', 'form_d_sec_gov']).optional(),
  simple_event_reason: z.enum(['report_released', 'promoted_on_site']).optional(),
  simple_event_date_featured_start: dateSchema.optional(),
  simple_event_date_featured_end: dateSchema.optional(),
} as const

export const jobSearchRequestSchema = z
  .object({
    page: z.number().int().optional(),
    job_source: z.enum(['indeed', 'linkedin', 'angellist']).optional(),
    date_featured_start: dateSchema.optional(),
    date_featured_end: dateSchema.optional(),
    organization_ids: integerArraySchema.optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    is_remote: z.boolean().nullable().optional(),
    is_active: z.boolean().optional(),
    locations: integerArraySchema.optional(),
    locations_exclude: integerArraySchema.optional(),
  })
  .strict()

export const organizationSearchRequestSchema = z
  .object({
    page: z.number().int().optional(),
    organization_ids: integerArraySchema.optional(),
    description: z.string().optional(),
    locations: integerArraySchema.optional(),
    industries: integerArraySchema.optional(),
    industries_exclude: integerArraySchema.optional(),
    keywords: integerArraySchema.optional(),
    employees_start: z.number().int().optional(),
    employees_end: z.number().int().optional(),
    founded_date_start: dateSchema.optional(),
    founded_date_end: dateSchema.optional(),
    revenue_start: z.number().int().optional(),
    revenue_end: z.number().int().optional(),
    domains: z.array(z.string()).optional(),
    domain_rank_start: z.number().int().optional(),
    domain_rank_end: z.number().int().optional(),
    domain_traffic_start: z.number().int().optional(),
    domain_traffic_end: z.number().int().optional(),
    web_technologies: integerArraySchema.optional(),
    linkedin_public_identifiers: z.array(z.string()).optional(),
    ...organizationEventFields,
  })
  .strict()

export const personRoleSearchRequestSchema = z
  .object({
    page: z.number().int().optional(),
    role_title: z.string().optional(),
    role_description: z.string().optional(),
    role_is_current: z.boolean().optional(),
    role_position_start_date: dateSchema.optional(),
    role_position_end_date: dateSchema.optional(),
    role_years_on_position_start: z.number().int().optional(),
    role_years_on_position_end: z.number().int().optional(),
    person_name: z.string().optional(),
    person_headline: z.string().optional(),
    person_description: z.string().optional(),
    person_skills: integerArraySchema.optional(),
    person_locations: integerArraySchema.optional(),
    person_industries: integerArraySchema.optional(),
    person_industries_exclude: integerArraySchema.optional(),
    person_linkedin_public_identifiers: z.array(z.string()).optional(),
    organizations: integerArraySchema.optional(),
    organizations_bulk_domain: z.string().optional(),
    organization_domains: z.array(z.string()).optional(),
    organization_description: z.string().optional(),
    organization_locations: integerArraySchema.optional(),
    organization_industries: integerArraySchema.optional(),
    organization_industries_exclude: integerArraySchema.optional(),
    organization_keywords: integerArraySchema.optional(),
    organization_web_technologies: integerArraySchema.optional(),
    organization_founded_date_start: dateSchema.optional(),
    organization_founded_date_end: dateSchema.optional(),
    organization_employees_start: z.number().int().optional(),
    organization_employees_end: z.number().int().optional(),
    organization_revenue_start: z.number().int().optional(),
    organization_revenue_end: z.number().int().optional(),
    organization_domain_rank_start: z.number().int().optional(),
    organization_domain_rank_end: z.number().int().optional(),
    organization_linkedin_public_identifiers: z.array(z.string()).optional(),
    ...organizationEventFields,
  })
  .strict()

export const personInfoRequestSchema = z
  .object({
    person_id: z.number().int().optional(),
    linkedin_public_identifier: z.string().optional(),
  })
  .strict()

export const personWorkEmailsRequestSchema = personInfoRequestSchema.extend({
  do_contacts_enrichment: z.boolean().optional(),
})

export const websiteLookupRequestSchema = z
  .object({
    domain: z.string().optional(),
    organization_id: z.number().int().optional(),
    organization_linkedin_public_identifier: z.string().optional(),
  })
  .strict()

const osmLocationSchema = z
  .object({ id: z.number().int(), name: z.string(), place_type: z.string() })
  .passthrough()

const innerLocationSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    osm_locations: z.array(osmLocationSchema),
  })
  .passthrough()

const linkedinIndustrySchema = z.object({ id: z.number().int(), name: z.string() }).passthrough()

const organizationLinkedinInfoSchema = z
  .object({
    public_identifier: nullableStringSchema.optional(),
    industry: linkedinIndustrySchema,
    public_profile_url: nullableStringSchema,
  })
  .passthrough()

const shortOrganizationSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    domain: nullableStringSchema.optional(),
    linkedin_info: organizationLinkedinInfoSchema,
  })
  .passthrough()

const jobInnerLocationSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    osm_locations: z.array(osmLocationSchema),
  })
  .passthrough()

const jobSearchResultSchema = z
  .object({
    id: z.number().int(),
    source: z.string(),
    date_featured: dateSchema,
    organization: shortOrganizationSchema,
    source_id: z.string(),
    url: z.string(),
    title: z.string(),
    description: nullableStringSchema.optional(),
    is_remote: z.boolean(),
    location: jobInnerLocationSchema,
    is_active: z.boolean(),
  })
  .passthrough()

const organizationKeywordSchema = z.object({ id: z.number().int(), name: z.string() }).passthrough()

const organizationAddressSchema = z
  .object({ country: z.string(), summary: z.string() })
  .passthrough()

const organizationFinanceInfoSchema = z
  .object({ revenue: nullableIntegerSchema.optional() })
  .passthrough()

const organizationSimpleEventSchema = z
  .object({
    id: z.number().int(),
    source: z.string(),
    date_featured: dateSchema,
    organization_id: z.number().int(),
    reason: z.string(),
    url: z.string(),
  })
  .passthrough()

const organizationFundingEventSchema = z
  .object({
    id: z.number().int(),
    source: z.string(),
    date_featured: dateSchema,
    organization_id: z.number().int(),
    funding_type: z.string(),
    funding_total: z.number().int(),
  })
  .passthrough()

const organizationJobPostEventSchema = z
  .object({
    id: z.number().int(),
    source: z.string(),
    date_featured: dateSchema,
    organization_id: z.number().int(),
    source_id: z.string(),
    url: z.string(),
    title: z.string(),
    is_remote: z.boolean(),
    is_active: z.boolean(),
  })
  .passthrough()

export const organizationSearchResultSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    legal_name: z.string(),
    domain_rank: nullableIntegerSchema,
    keywords: z.array(organizationKeywordSchema),
    location: innerLocationSchema,
    finance_info: organizationFinanceInfoSchema,
    linkedin_info: organizationLinkedinInfoSchema,
    addresses: z.array(organizationAddressSchema),
    date_updated: dateTimeSchema,
    found_simple_events: z.array(organizationSimpleEventSchema),
    found_funding_events: z.array(organizationFundingEventSchema),
    found_job_post_events: z.array(organizationJobPostEventSchema),
  })
  .passthrough()

const personSkillSchema = z.object({ name: z.string() }).passthrough()

const personLinkedinInfoSchema = z
  .object({
    public_identifier: nullableStringSchema.optional(),
    industry: linkedinIndustrySchema,
    public_profile_url: z.string(),
  })
  .passthrough()

const personChildSchema = z
  .object({
    id: z.number().int(),
    full_name: z.string(),
    first_name: z.string(),
    skills: z.array(personSkillSchema),
    location: innerLocationSchema,
    linkedin_info: personLinkedinInfoSchema,
    date_updated: dateTimeSchema,
  })
  .passthrough()

const personRoleSchema = z
  .object({
    id: z.number().int(),
    is_current: z.boolean(),
    organization: shortOrganizationSchema,
  })
  .passthrough()

const nullableAssociationFields = {
  associated_role_id: nullableIntegerSchema,
  associated_education_id: nullableIntegerSchema,
} as const

const personCertificationSchema = z
  .object({ id: z.number().int(), organization_id: nullableIntegerSchema, name: z.string() })
  .passthrough()
const personCourseSchema = z
  .object({ id: z.number().int(), name: z.string(), ...nullableAssociationFields })
  .passthrough()
const personEducationSchema = z
  .object({ id: z.number().int(), school_name: z.string(), organization: shortOrganizationSchema })
  .passthrough()
const personHonorSchema = z
  .object({ id: z.number().int(), title: z.string(), ...nullableAssociationFields })
  .passthrough()
const personLanguageSchema = z.object({ id: z.number().int(), name: z.string() }).passthrough()
const personOrganizationSchema = z
  .object({ id: z.number().int(), name: z.string(), ...nullableAssociationFields })
  .passthrough()
const personPatentSchema = z
  .object({
    id: z.number().int(),
    title: z.string(),
    is_pending: z.boolean(),
    linkedin_inventors_ids: integerArraySchema,
  })
  .passthrough()
const personProjectSchema = z
  .object({
    id: z.number().int(),
    title: z.string(),
    linkedin_contributors_ids: integerArraySchema,
    ...nullableAssociationFields,
  })
  .passthrough()
const personPublicationSchema = z
  .object({ id: z.number().int(), name: z.string(), linkedin_authors_ids: integerArraySchema })
  .passthrough()
const personTestScoreSchema = z
  .object({ id: z.number().int(), name: z.string(), ...nullableAssociationFields })
  .passthrough()
const personVolunteeringSchema = z
  .object({
    id: z.number().int(),
    title: z.string(),
    organization_name: z.string(),
    organization_id: nullableIntegerSchema,
  })
  .passthrough()

export const personDetailSchema = z
  .object({
    id: z.number().int(),
    full_name: z.string(),
    first_name: z.string(),
    skills: z.array(personSkillSchema),
    location: innerLocationSchema,
    linkedin_info: personLinkedinInfoSchema,
    roles: z.array(personRoleSchema),
    educations: z.array(personEducationSchema),
    certifications: z.array(personCertificationSchema),
    courses: z.array(personCourseSchema),
    honors: z.array(personHonorSchema),
    languages: z.array(personLanguageSchema),
    organizations: z.array(personOrganizationSchema),
    patents: z.array(personPatentSchema),
    publications: z.array(personPublicationSchema),
    test_scores: z.array(personTestScoreSchema),
    projects: z.array(personProjectSchema),
    volunteering: z.array(personVolunteeringSchema),
  })
  .passthrough()

const personRoleSearchResultSchema = z
  .object({
    id: z.number().int(),
    is_current: z.boolean(),
    organization: organizationSearchResultSchema,
    person: personChildSchema,
    date_updated: dateTimeSchema,
  })
  .passthrough()

export const jobSearchResponseSchema = z
  .object({
    search_results: z.array(jobSearchResultSchema),
    total_search_results: z.number().int().nonnegative(),
  })
  .passthrough()

export const organizationSearchResponseSchema = z
  .object({
    search_results: z.array(organizationSearchResultSchema),
    total_search_results: z.number().int().nonnegative(),
  })
  .passthrough()

export const personRoleSearchResponseSchema = z
  .object({
    search_results: z.array(personRoleSearchResultSchema),
    total_search_results: z.number().int().nonnegative(),
  })
  .passthrough()

export const searchTotalsResponseSchema = z
  .object({ total_search_results: z.number().int().nonnegative() })
  .passthrough()

export const personRoleSearchTotalsResponseSchema = searchTotalsResponseSchema.extend({
  total_persons: z.number().int().nonnegative(),
  total_organizations: z.number().int().nonnegative(),
})

export const personEmailDetailsSchema = z.array(
  z
    .object({
      email: z.string().email(),
      email_type: z.string(),
      validation_status: z.enum(['valid', 'risky', 'invalid', 'unknown']),
    })
    .passthrough()
)

export const personPhoneDetailsSchema = z.array(
  z.object({ phone_number: z.string() }).passthrough()
)

export const websiteSchema = z
  .object({
    id: z.number().int(),
    domain: z.string(),
    website_technologies: z.array(
      z
        .object({
          web_technology_id: z.number().int(),
          name: z.string(),
          is_active: z.boolean().optional(),
        })
        .passthrough()
    ),
  })
  .passthrough()

export const currentUserSchema = z
  .object({
    id: z.number().int(),
    username: z.string(),
    email: z.string().email(),
    accounts: z.array(
      z
        .object({
          id: z.number().int().positive(),
          name: z.string(),
          subscription: z.unknown(),
        })
        .passthrough()
    ),
  })
  .passthrough()

export interface ForagerResponseSchema<T> {
  parse(data: unknown): T
}
