import type { OutputProperty, ToolResponse } from '@/tools/types'

export interface DropcontactBaseParams {
  apiKey: string
}

// ---------------------------------------------------------------------------
// Shared output property constants
// ---------------------------------------------------------------------------

export const DROPCONTACT_EMAIL_ITEM_OUTPUT_PROPERTIES = {
  email: { type: 'string', description: 'Email address' },
  qualification: {
    type: 'string',
    description:
      'Email qualification in the format <local>@<domain>, e.g. nominative@pro, catch_all@pro, generic@perso',
  },
} as const satisfies Record<string, OutputProperty>

export const DROPCONTACT_EMAILS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'All email addresses found for the contact',
  items: {
    type: 'object',
    properties: DROPCONTACT_EMAIL_ITEM_OUTPUT_PROPERTIES,
  },
}

// ---------------------------------------------------------------------------
// Enrich Contact (single-contact async enrichment)
// ---------------------------------------------------------------------------

export interface DropcontactEnrichContactParams extends DropcontactBaseParams {
  /** Email address of the contact to enrich */
  email?: string
  /** First name of the contact */
  first_name?: string
  /** Last name of the contact */
  last_name?: string
  /** Full name (alternative to first_name + last_name) */
  full_name?: string
  /** Company name */
  company?: string
  /** Company website (e.g. acme.com) */
  website?: string
  /** French company SIREN number */
  num_siren?: string
  /** Phone number */
  phone?: string
  /** LinkedIn profile URL */
  linkedin?: string
  /** Country code (ISO 3166-1 alpha-2) */
  country?: string
  /** Whether to include SIREN/SIRET enrichment (France only) */
  siren?: boolean
  /** Language for returned data (e.g. "en", "fr") */
  language?: string
}

/** Per-contact email entry returned by the Dropcontact API */
export interface DropcontactEmailEntry {
  email: string
  qualification: string
}

/** Enriched contact data returned in the poll result */
export interface DropcontactEnrichedContact {
  civility: string | null
  first_name: string | null
  last_name: string | null
  full_name: string | null
  email: DropcontactEmailEntry[] | null
  phone: string | null
  mobile_phone: string | null
  company: string | null
  website: string | null
  company_linkedin: string | null
  linkedin: string | null
  country: string | null
  siren: string | null
  siret: string | null
  siret_address: string | null
  siret_zip: string | null
  siret_city: string | null
  vat: string | null
  nb_employees: string | null
  employee_count: number | null
  naf5_code: string | null
  naf5_des: string | null
  industry: string | null
  job: string | null
  job_level: string | null
  job_function: string | null
  company_turnover: string | null
  company_results: string | null
}

export interface DropcontactEnrichContactResponse extends ToolResponse {
  output: {
    request_id: string | null
    /** Whether the enrichment returned a verified email */
    email_found: boolean
    /** First verified email address, if any */
    email: string | null
    /** All emails returned by Dropcontact */
    emails: DropcontactEmailEntry[] | null
    /** Email qualification (e.g. nominative@pro) */
    qualification: string | null
    first_name: string | null
    last_name: string | null
    full_name: string | null
    civility: string | null
    phone: string | null
    mobile_phone: string | null
    company: string | null
    website: string | null
    company_linkedin: string | null
    linkedin: string | null
    country: string | null
    siren: string | null
    siret: string | null
    siret_address: string | null
    siret_zip: string | null
    siret_city: string | null
    vat: string | null
    nb_employees: string | null
    employee_count: number | null
    naf5_code: string | null
    naf5_des: string | null
    industry: string | null
    job: string | null
    job_level: string | null
    job_function: string | null
    company_turnover: string | null
    company_results: string | null
  }
}

/** Discriminated union of all Dropcontact tool responses */
export type DropcontactResponse = DropcontactEnrichContactResponse
