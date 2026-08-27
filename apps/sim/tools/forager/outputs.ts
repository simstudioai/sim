import type { OutputProperty } from '@/tools/types'

export const FORAGER_AUTH_PARAMS = {
  apiKey: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Forager API key sent in the X-API-KEY header',
  },
  accountId: {
    type: 'number',
    required: false,
    visibility: 'user-only',
    description:
      'Forager account ID. Optional for API keys attached to exactly one account; required for multi-account keys.',
  },
} as const

export const FORAGER_SEARCH_PARAMS = {
  ...FORAGER_AUTH_PARAMS,
  filters: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description: 'Documented Forager request body filters as a JSON object',
  },
} as const

export const JOB_SEARCH_RESULTS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Forager job posts matching the documented search request',
  items: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Forager job-post event ID' },
      source: { type: 'string', description: 'Job source' },
      date_featured: { type: 'string', description: 'Date the job was featured' },
      organization: { type: 'json', description: 'Short organization profile' },
      source_id: { type: 'string', description: 'Identifier from the job source' },
      url: { type: 'string', description: 'Job-post URL' },
      title: { type: 'string', description: 'Job title' },
      description: {
        type: 'string',
        description: 'Job description',
        optional: true,
        nullable: true,
      },
      is_remote: { type: 'boolean', description: 'Whether the job is remote' },
      location: { type: 'json', description: 'Job location with OSM locations' },
      is_active: { type: 'boolean', description: 'Whether the job is active' },
    },
  },
}

export const ORGANIZATION_SEARCH_RESULTS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Forager organizations matching the documented search request',
  items: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Forager organization ID' },
      name: { type: 'string', description: 'Organization name' },
      legal_name: { type: 'string', description: 'Legal organization name' },
      website: {
        type: 'string',
        description: 'Organization website',
        optional: true,
        nullable: true,
      },
      domain: {
        type: 'string',
        description: 'Organization domain',
        optional: true,
        nullable: true,
      },
      domain_rank: { type: 'number', description: 'Domain rank', nullable: true },
      logo: {
        type: 'string',
        description: 'Organization logo URL',
        optional: true,
        nullable: true,
      },
      description: {
        type: 'string',
        description: 'Organization description',
        optional: true,
        nullable: true,
      },
      founded_date: {
        type: 'string',
        description: 'Organization founding date',
        optional: true,
        nullable: true,
      },
      operating_status: {
        type: 'string',
        description: 'Operating status',
        optional: true,
        nullable: true,
      },
      employees_range: {
        type: 'string',
        description: 'Employee range',
        optional: true,
        nullable: true,
      },
      employees_amount: {
        type: 'number',
        description: 'Employee count',
        optional: true,
        nullable: true,
      },
      keywords: { type: 'array', description: 'Organization keyword records' },
      location: { type: 'json', description: 'Primary organization location' },
      finance_info: { type: 'json', description: 'Organization finance information' },
      linkedin_info: { type: 'json', description: 'Organization LinkedIn information' },
      addresses: { type: 'array', description: 'Organization addresses' },
      date_updated: { type: 'string', description: 'Last profile update timestamp' },
      found_simple_events: { type: 'array', description: 'Simple events matching the search' },
      found_funding_events: {
        type: 'array',
        description: 'Funding events matching the search',
      },
      found_job_post_events: {
        type: 'array',
        description: 'Job-post events matching the search',
      },
    },
  },
}

export const PERSON_ROLE_SEARCH_RESULTS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Forager person-role records matching the documented search request',
  items: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Forager person-role ID' },
      role_title: {
        type: 'string',
        description: 'Role title',
        optional: true,
        nullable: true,
      },
      start_date: {
        type: 'string',
        description: 'Role start date',
        optional: true,
        nullable: true,
      },
      end_date: {
        type: 'string',
        description: 'Role end date',
        optional: true,
        nullable: true,
      },
      duration: {
        type: 'string',
        description: 'Role duration',
        optional: true,
        nullable: true,
      },
      description: {
        type: 'string',
        description: 'Role description',
        optional: true,
        nullable: true,
      },
      is_current: { type: 'boolean', description: 'Whether the role is current' },
      organization: { type: 'json', description: 'Complete matching organization record' },
      person: { type: 'json', description: 'Matching person summary' },
      date_updated: { type: 'string', description: 'Last role update timestamp' },
    },
  },
}

export const TOTAL_SEARCH_RESULTS_OUTPUT: OutputProperty = {
  type: 'number',
  description: 'Total number of records matching the search',
}

export const PERSON_OUTPUT: OutputProperty = {
  type: 'object',
  description:
    'Complete person profile validated against Forager PersonDetail, including roles, education, skills, organizations, projects, publications, and volunteering',
  properties: {
    id: { type: 'number', description: 'Forager person ID' },
    full_name: { type: 'string', description: 'Full name' },
    first_name: { type: 'string', description: 'First name' },
    last_name: {
      type: 'string',
      description: 'Last name',
      optional: true,
      nullable: true,
    },
    photo: { type: 'string', description: 'Photo URL', optional: true, nullable: true },
    gender: { type: 'string', description: 'Gender', optional: true, nullable: true },
    headline: {
      type: 'string',
      description: 'Profile headline',
      optional: true,
      nullable: true,
    },
    description: {
      type: 'string',
      description: 'Profile description',
      optional: true,
      nullable: true,
    },
    skills: { type: 'array', description: 'Person skill records' },
    location: { type: 'json', description: 'Person location' },
    linkedin_info: { type: 'json', description: 'Person LinkedIn information' },
    roles: { type: 'array', description: 'Person role records' },
    educations: { type: 'array', description: 'Education records' },
    certifications: { type: 'array', description: 'Certification records' },
    courses: { type: 'array', description: 'Course records' },
    honors: { type: 'array', description: 'Honor records' },
    languages: { type: 'array', description: 'Language records' },
    organizations: { type: 'array', description: 'Associated organization records' },
    patents: { type: 'array', description: 'Patent records' },
    publications: { type: 'array', description: 'Publication records' },
    test_scores: { type: 'array', description: 'Test-score records' },
    projects: { type: 'array', description: 'Project records' },
    volunteering: { type: 'array', description: 'Volunteering records' },
  },
}

export const EMAILS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Email records returned by Forager',
  items: {
    type: 'object',
    properties: {
      email: { type: 'string', description: 'Email address' },
      email_type: { type: 'string', description: 'Forager email type' },
      validation_status: {
        type: 'string',
        description: 'Validation status: valid, risky, invalid, or unknown',
      },
    },
  },
}

export const PHONE_NUMBERS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Phone number records returned by Forager',
  items: {
    type: 'object',
    properties: {
      phone_number: { type: 'string', description: 'Phone number' },
    },
  },
}

export const WEBSITE_OUTPUT: OutputProperty = {
  type: 'object',
  description:
    'Website record with domain, traffic ranks, estimated traffic, and detected technologies',
  properties: {
    id: { type: 'number', description: 'Forager website ID' },
    domain: { type: 'string', description: 'Website domain' },
    tranco_rank: {
      type: 'number',
      description: 'Tranco three-month average traffic rank',
      optional: true,
      nullable: true,
    },
    similarweb_rank: {
      type: 'number',
      description: 'Similarweb rank',
      optional: true,
      nullable: true,
    },
    similarweb_traffic: {
      type: 'number',
      description: 'Similarweb traffic estimate',
      optional: true,
      nullable: true,
    },
    website_technologies: {
      type: 'array',
      description: 'Detected website technologies',
      items: {
        type: 'object',
        properties: {
          web_technology_id: { type: 'number', description: 'Forager technology ID' },
          name: { type: 'string', description: 'Technology name' },
          is_active: {
            type: 'boolean',
            description: 'Whether the technology is active',
            optional: true,
          },
        },
      },
    },
  },
}
