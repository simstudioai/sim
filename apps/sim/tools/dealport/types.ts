import type { OutputProperty, ToolResponse } from '@/tools/types'

export interface DealportMarketFilter {
  state: string
  counties?: string[]
}

interface DealportCompanyFilterParams {
  accessToken: string
  q?: string
  state?: string
  counties?: string[] | string
  cities?: string[] | string
  domain?: string
  naics?: string[] | string
  min_revenue?: number
  max_revenue?: number
  filed_revenue_only?: boolean
  min_employees?: number
  max_employees?: number
  size_unknown?: boolean
  independent?: boolean
  owner_businesses?: number
  medicare?: boolean
  owner_operated?: boolean
  owner_contact?: boolean
  licensed?: boolean
  care_types?: string[] | string
  adviser?: boolean
  wealth_adviser?: boolean
  online_store?: boolean
  sells?: string[] | string
  store_words?: string[] | string
  min_reviews?: number
  order?: 'reviews' | 'products' | 'match'
}

export interface DealportPreviewCompaniesParams extends DealportCompanyFilterParams {
  markets?: DealportMarketFilter[] | string
}

export interface DealportPreviewSampleCompany {
  id: string
  name: string
  city: string | null
  state: string | null
  industry: string | null
  employee_band: string | null
  revenue_band: string | null
  independent: boolean
}

export interface DealportPreviewCompaniesResponse extends ToolResponse {
  output: {
    matching_count: number
    matching_count_more: boolean
    sample: DealportPreviewSampleCompany[]
    board_url: string
    cost_usd: number
    remaining_balance_usd: number
  }
}

export interface DealportSearchCompaniesParams extends DealportCompanyFilterParams {
  markets?: string
  limit?: number
  cursor?: string
}

export interface DealportMetricEstimate {
  value: number | null
  low: number | null
  high: number | null
  basis: string | null
}

export interface DealportCompanySummary {
  id: string
  name: string
  city: string | null
  state: string | null
  zip: string | null
  naics: string[]
  industry: string[]
  industryLabel: string | null
  phone: string | null
  website: string | null
  revenue: DealportMetricEstimate
  employees: DealportMetricEstimate
  owner: { name: string; role: string | null } | null
  sources: number
  foundedYear: number | null
}

export interface DealportSearchCompaniesResponse extends ToolResponse {
  output: {
    companies: DealportCompanySummary[]
    next_cursor: string | null
  }
}

export interface DealportSearchBuildingsParams {
  accessToken: string
  borough: string
  min_units?: number
  q?: string
  loan_due_by?: number
  loan_holder?: string
  signal?: string
  limit?: number
  cursor?: string
}

export interface DealportBuildingSummary {
  bbl: string
  borough: string
  address: string
  owner_of_record: string | null
  residential_units: number | null
  building_class: string | null
  year_built: number | null
  zoning: string | null
  rent_stabilized_units: number | null
  loan: { holder_type: string | null; estimated_due_year: number | null } | null
}

export interface DealportSearchBuildingsResponse extends ToolResponse {
  output: {
    buildings: DealportBuildingSummary[]
    next_cursor: string | null
  }
}

export interface DealportGetRecordParams {
  accessToken: string
  recordId: string
}

export interface DealportRecordFact {
  kind: string
  value: unknown
  low: number | null
  high: number | null
  as_of: string | null
  basis: string | null
  source: { name: string; detail: string | null; url: string | null } | null
}

export interface DealportRecordPerson {
  name: string
  role: string | null
  owner: boolean | null
  organization: string | null
  share: string | number | null
  since: string | null
  phone: string | null
  email: string | null
  sources: string[]
}

export interface DealportRecordIdentifier {
  type: string
  values: string[]
}

export interface DealportRecordSource {
  name: string
  url: string | null
  used_for: string | null
  latest: string | null
}

export interface DealportRecord {
  id: string
  kind: string
  name: string
  summary: string | null
  website: string | null
  phone: string | null
  facts: DealportRecordFact[]
  people: DealportRecordPerson[]
  identifiers: DealportRecordIdentifier[]
  sources: DealportRecordSource[]
  capsule_freshness: Record<string, unknown> | null
}

export interface DealportGetRecordResponse extends ToolResponse {
  output: {
    record: DealportRecord
    record_url: string
    cost_usd: number
    remaining_balance_usd: number
  }
}

export interface DealportMatchInputItem {
  external_id?: string | null
  name?: string | null
  domain?: string | null
  city?: string | null
  state?: string | null
}

export interface DealportMatchCompaniesParams {
  accessToken: string
  items?: DealportMatchInputItem[] | string
  csv?: string
  watch?: boolean
  project_id?: string
  project_name?: string
}

export interface DealportMatchedCompanyRow {
  index: number
  external_id: string | null
  input: {
    name: string | null
    domain: string | null
    city: string | null
    state: string | null
  }
  matched: boolean
  match_method: string | null
  company_id: string | null
  company_name: string | null
  domain: string | null
  city: string | null
  state: string | null
  naics: string[]
  industry: string | null
  cached_owner: { name: string; role: string | null; resolved_at: string | null } | null
  record_url: string | null
}

export interface DealportMatchCompaniesResponse extends ToolResponse {
  output: {
    total_input: number
    matched_count: number
    unmatched_count: number
    domain_matched_count: number
    fuzzy_matched_count: number
    cached_owners_count: number
    matched_company_ids: string[]
    results: DealportMatchedCompanyRow[]
    board_url: string | null
    cost_usd: number
    remaining_balance_usd: number
  }
}

export interface DealportFindOwnerParams {
  accessToken: string
  company_id?: string
  llc_name?: string
  property_address?: string
  state?: string
  city?: string
  mailing_address?: string
  care_of?: string
  person?: string
}

export interface DealportOwnerPerson {
  name: string
  role: string | null
  headline: string | null
  summary: string | null
  linkedin_url: string | null
  photo_url: string | null
  location: string | null
  seniority: string | null
  department: string | null
  decision_role: string | null
}

export interface DealportOwnerPhone {
  number: string
  kind: string
  label: string | null
  dnc: string | null
}

export interface DealportOwnerEmail {
  address: string
  kind: string
  verified: boolean | null
  status: string | null
  checked_at: string | null
}

export interface DealportOwnerRole {
  title: string | null
  company: string | null
  domain: string | null
  start: string | null
  end: string | null
  current: boolean | null
}

export interface DealportOwnerEducation {
  school: string
  degree: string | null
  field: string | null
  start: string | null
  end: string | null
}

export interface DealportOwnerProfile {
  headline: string | null
  summary: string | null
  linkedin_url: string | null
  photo_url: string | null
  location: string | null
  seniority: string | null
  department: string | null
  decision_role: string | null
  company: { name: string | null; domain: string | null; industry: string | null } | null
  roles: DealportOwnerRole[]
  education: DealportOwnerEducation[]
  skills: string[]
  certifications: string[]
  languages: string[]
  organizations: string[]
}

export interface DealportFindOwnerResponse extends ToolResponse {
  output: {
    company: { id: string; name: string }
    person: DealportOwnerPerson | null
    phone: string | null
    email: string | null
    phones: DealportOwnerPhone[]
    emails: DealportOwnerEmail[]
    profile: DealportOwnerProfile | null
    sources: Array<{ url: string; title: string }>
    record_url: string
    note: string | null
    cost_usd: number
    remaining_balance_usd: number
  }
}

export const DEALPORT_PREVIEW_SAMPLE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Dealport company UUID' },
  name: { type: 'string', description: 'Company name' },
  city: { type: 'string', nullable: true, description: 'Company city' },
  state: { type: 'string', nullable: true, description: 'Two-letter US state code' },
  industry: { type: 'string', nullable: true, description: 'Primary industry label' },
  employee_band: { type: 'string', nullable: true, description: 'Headcount range band' },
  revenue_band: { type: 'string', nullable: true, description: 'Annual revenue range band' },
  independent: { type: 'boolean', description: 'Whether the company is independent' },
} as const satisfies Record<string, OutputProperty>

const METRIC_ESTIMATE_PROPERTIES = {
  value: { type: 'number', nullable: true, description: 'Point figure when reported' },
  low: { type: 'number', nullable: true, description: 'Lower bound of the range' },
  high: { type: 'number', nullable: true, description: 'Upper bound of the range' },
  basis: {
    type: 'string',
    nullable: true,
    description: 'Evidence basis: filed, observed, or estimate',
  },
} as const satisfies Record<string, OutputProperty>

export const DEALPORT_COMPANY_SUMMARY_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Dealport company UUID' },
  name: { type: 'string', description: 'Company name' },
  city: { type: 'string', nullable: true, description: 'Company city' },
  state: { type: 'string', nullable: true, description: 'Two-letter US state code' },
  zip: { type: 'string', nullable: true, description: 'Postal ZIP code' },
  naics: {
    type: 'array',
    description: 'NAICS industry codes',
    items: { type: 'string' },
  },
  industry: {
    type: 'array',
    description: 'Industry categories',
    items: { type: 'string' },
  },
  industryLabel: { type: 'string', nullable: true, description: 'Primary display industry label' },
  phone: { type: 'string', nullable: true, description: 'Company phone number' },
  website: { type: 'string', nullable: true, description: 'Company website or domain' },
  revenue: {
    type: 'object',
    description: 'Annual revenue in USD with filing basis',
    properties: METRIC_ESTIMATE_PROPERTIES,
  },
  employees: {
    type: 'object',
    description: 'Employee headcount with filing basis',
    properties: METRIC_ESTIMATE_PROPERTIES,
  },
  owner: {
    type: 'object',
    nullable: true,
    description: 'Filed or observed principal on the company Record',
    properties: {
      name: { type: 'string', description: 'Principal full name' },
      role: { type: 'string', nullable: true, description: 'Principal title or role' },
    },
  },
  sources: { type: 'number', description: 'Number of primary public-filing sources' },
  foundedYear: { type: 'number', nullable: true, description: 'Year founded when known' },
} as const satisfies Record<string, OutputProperty>

export const DEALPORT_BUILDING_SUMMARY_OUTPUT_PROPERTIES = {
  bbl: { type: 'string', description: '10-digit NYC Borough-Block-Lot identifier' },
  borough: { type: 'string', description: 'NYC borough code (MN, BK, QN, BX, SI)' },
  address: { type: 'string', description: 'Street address of the building' },
  owner_of_record: { type: 'string', nullable: true, description: 'Recorded deed or tax owner' },
  residential_units: {
    type: 'number',
    nullable: true,
    description: 'Residential unit count',
  },
  building_class: { type: 'string', nullable: true, description: 'NYC DOF building class code' },
  year_built: { type: 'number', nullable: true, description: 'Year built' },
  zoning: { type: 'string', nullable: true, description: 'Primary zoning district' },
  rent_stabilized_units: {
    type: 'number',
    nullable: true,
    description: 'Registered rent-stabilized unit count',
  },
  loan: {
    type: 'object',
    nullable: true,
    description: 'Current ACRIS mortgage summary',
    properties: {
      holder_type: {
        type: 'string',
        nullable: true,
        description: 'Mortgage holder category: agency, cmbs, or bank',
      },
      estimated_due_year: {
        type: 'number',
        nullable: true,
        description: 'Estimated loan maturity year',
      },
    },
  },
} as const satisfies Record<string, OutputProperty>

export const DEALPORT_RECORD_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Company UUID or 10-digit NYC BBL' },
  kind: { type: 'string', description: 'Record kind: company, property, or person' },
  name: { type: 'string', description: 'Entity or property display name' },
  summary: { type: 'string', nullable: true, description: 'Cited Record summary' },
  website: { type: 'string', nullable: true, description: 'Company website when present' },
  phone: { type: 'string', nullable: true, description: 'Main phone number when present' },
  facts: {
    type: 'array',
    description: 'Cited primary-filing facts with basis (filed, observed, or estimate)',
    items: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'Fact category key' },
        value: { type: 'json', description: 'Fact value' },
        low: { type: 'number', nullable: true, description: 'Range lower bound' },
        high: { type: 'number', nullable: true, description: 'Range upper bound' },
        as_of: { type: 'string', nullable: true, description: 'Filing or observation date' },
        basis: {
          type: 'string',
          nullable: true,
          description: 'Evidence basis: filed, observed, or estimate',
        },
        source: {
          type: 'object',
          nullable: true,
          description: 'Primary source citation',
          properties: {
            name: { type: 'string', description: 'Source registry or filing name' },
            detail: { type: 'string', nullable: true, description: 'Filing detail' },
            url: { type: 'string', nullable: true, description: 'Source URL' },
          },
        },
      },
    },
  },
  people: {
    type: 'array',
    description: 'Human principals and officers linked to the Record',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Person full name' },
        role: { type: 'string', nullable: true, description: 'Role or title' },
        owner: { type: 'boolean', nullable: true, description: 'Whether marked as an owner' },
        organization: { type: 'string', nullable: true, description: 'Associated entity name' },
        share: { type: 'json', nullable: true, description: 'Ownership share when filed' },
        since: { type: 'string', nullable: true, description: 'Start date or year on filing' },
        phone: { type: 'string', nullable: true, description: 'Phone on record' },
        email: { type: 'string', nullable: true, description: 'Email on record' },
        sources: {
          type: 'array',
          description: 'Source names citing this person',
          items: { type: 'string' },
        },
      },
    },
  },
  identifiers: {
    type: 'array',
    description: 'Registry and regulatory identifiers (EIN, NPI, CRD, BBL, state file numbers)',
    items: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Identifier type' },
        values: {
          type: 'array',
          description: 'Identifier values',
          items: { type: 'string' },
        },
      },
    },
  },
  sources: {
    type: 'array',
    description: 'Primary public filings and sources backing the Record',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Source name' },
        url: { type: 'string', nullable: true, description: 'Source link' },
        used_for: { type: 'string', nullable: true, description: 'Facts derived from this source' },
        latest: { type: 'string', nullable: true, description: 'Most recent filing date' },
      },
    },
  },
  capsule_freshness: {
    type: 'json',
    nullable: true,
    description: 'Freshness metadata for the Record',
  },
} as const satisfies Record<string, OutputProperty>

export const DEALPORT_MATCHED_COMPANY_OUTPUT_PROPERTIES = {
  index: { type: 'number', description: 'Zero-based input row index' },
  external_id: { type: 'string', nullable: true, description: 'Caller-supplied external ID' },
  input: {
    type: 'object',
    description: 'Normalized input fields for this row',
    properties: {
      name: { type: 'string', nullable: true, description: 'Submitted company name' },
      domain: { type: 'string', nullable: true, description: 'Submitted domain' },
      city: { type: 'string', nullable: true, description: 'Submitted city' },
      state: { type: 'string', nullable: true, description: 'Submitted state' },
    },
  },
  matched: { type: 'boolean', description: 'Whether a Dealport company Record matched' },
  match_method: {
    type: 'string',
    nullable: true,
    description: 'Resolution method: domain_exact or name_fuzzy',
  },
  company_id: { type: 'string', nullable: true, description: 'Matched Dealport company UUID' },
  company_name: { type: 'string', nullable: true, description: 'Matched company name' },
  domain: { type: 'string', nullable: true, description: 'Matched company domain' },
  city: { type: 'string', nullable: true, description: 'Matched company city' },
  state: { type: 'string', nullable: true, description: 'Matched company state' },
  naics: {
    type: 'array',
    description: 'Matched NAICS codes',
    items: { type: 'string' },
  },
  industry: { type: 'string', nullable: true, description: 'Matched primary industry label' },
  cached_owner: {
    type: 'object',
    nullable: true,
    description: 'Previously resolved human owner when already cached',
    properties: {
      name: { type: 'string', description: 'Principal name' },
      role: { type: 'string', nullable: true, description: 'Principal role' },
      resolved_at: { type: 'string', nullable: true, description: 'Timestamp when resolved' },
    },
  },
  record_url: { type: 'string', nullable: true, description: 'Dealport Record URL' },
} as const satisfies Record<string, OutputProperty>

export const DEALPORT_OWNER_PERSON_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Verified human principal full name' },
  role: { type: 'string', nullable: true, description: 'Role or title at the company' },
  headline: { type: 'string', nullable: true, description: 'Professional headline' },
  summary: { type: 'string', nullable: true, description: 'Professional bio summary' },
  linkedin_url: { type: 'string', nullable: true, description: 'LinkedIn profile URL' },
  photo_url: { type: 'string', nullable: true, description: 'Profile photo URL' },
  location: { type: 'string', nullable: true, description: 'City and state or country' },
  seniority: { type: 'string', nullable: true, description: 'Seniority tier' },
  department: { type: 'string', nullable: true, description: 'Department' },
  decision_role: { type: 'string', nullable: true, description: 'Decision-maker classification' },
} as const satisfies Record<string, OutputProperty>

export const DEALPORT_OWNER_PHONE_OUTPUT_PROPERTIES = {
  number: { type: 'string', description: 'Verified direct or mobile phone number' },
  kind: { type: 'string', description: 'Phone line type: mobile, direct, or landline' },
  label: { type: 'string', nullable: true, description: 'Carrier or line label' },
  dnc: { type: 'string', nullable: true, description: 'Do-Not-Call registry status when checked' },
} as const satisfies Record<string, OutputProperty>

export const DEALPORT_OWNER_EMAIL_OUTPUT_PROPERTIES = {
  address: { type: 'string', description: 'Work or personal email address' },
  kind: { type: 'string', description: 'Email type: work or personal' },
  verified: { type: 'boolean', nullable: true, description: 'Whether deliverability was verified' },
  status: { type: 'string', nullable: true, description: 'Verification status' },
  checked_at: { type: 'string', nullable: true, description: 'Verification timestamp' },
} as const satisfies Record<string, OutputProperty>

export const DEALPORT_OWNER_PROFILE_OUTPUT_PROPERTIES = {
  headline: { type: 'string', nullable: true, description: 'Professional headline' },
  summary: { type: 'string', nullable: true, description: 'Professional summary' },
  linkedin_url: { type: 'string', nullable: true, description: 'LinkedIn profile URL' },
  photo_url: { type: 'string', nullable: true, description: 'Profile photo URL' },
  location: { type: 'string', nullable: true, description: 'City and state or country' },
  seniority: { type: 'string', nullable: true, description: 'Seniority tier' },
  department: { type: 'string', nullable: true, description: 'Department' },
  decision_role: { type: 'string', nullable: true, description: 'Decision-maker role' },
  company: {
    type: 'object',
    nullable: true,
    description: 'Primary employer summary',
    properties: {
      name: { type: 'string', nullable: true, description: 'Company name' },
      domain: { type: 'string', nullable: true, description: 'Company domain' },
      industry: { type: 'string', nullable: true, description: 'Company industry' },
    },
  },
  roles: {
    type: 'array',
    description: 'Career history entries',
    items: {
      type: 'object',
      properties: {
        title: { type: 'string', nullable: true, description: 'Job title' },
        company: { type: 'string', nullable: true, description: 'Company name' },
        domain: { type: 'string', nullable: true, description: 'Company domain' },
        start: { type: 'string', nullable: true, description: 'Start date' },
        end: { type: 'string', nullable: true, description: 'End date' },
        current: { type: 'boolean', nullable: true, description: 'Whether role is current' },
      },
    },
  },
  education: {
    type: 'array',
    description: 'Education history entries',
    items: {
      type: 'object',
      properties: {
        school: { type: 'string', description: 'School or university name' },
        degree: { type: 'string', nullable: true, description: 'Degree earned' },
        field: { type: 'string', nullable: true, description: 'Field of study' },
        start: { type: 'string', nullable: true, description: 'Start year' },
        end: { type: 'string', nullable: true, description: 'End year' },
      },
    },
  },
  skills: {
    type: 'array',
    description: 'Professional skills',
    items: { type: 'string' },
  },
  certifications: {
    type: 'array',
    description: 'Professional certifications',
    items: { type: 'string' },
  },
  languages: {
    type: 'array',
    description: 'Spoken languages',
    items: { type: 'string' },
  },
  organizations: {
    type: 'array',
    description: 'Affiliated boards and organizations',
    items: { type: 'string' },
  },
} as const satisfies Record<string, OutputProperty>
