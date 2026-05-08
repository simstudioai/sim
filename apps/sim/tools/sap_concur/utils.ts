import type { SapConcurBaseParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import type { OutputProperty } from '@/tools/types'

export const scimUserOutputProperties: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'User UUID' },
  externalId: {
    type: 'string',
    description: 'External identifier set by the provisioning client',
    optional: true,
  },
  userName: { type: 'string', description: 'Unique username (often email)' },
  displayName: { type: 'string', description: 'Display name', optional: true },
  nickName: { type: 'string', description: 'Casual or alternate name', optional: true },
  title: { type: 'string', description: 'Job title', optional: true },
  userType: { type: 'string', description: 'User type (e.g., Employee)', optional: true },
  preferredLanguage: { type: 'string', description: 'Preferred language tag', optional: true },
  locale: { type: 'string', description: 'Locale (e.g., en-US)', optional: true },
  timezone: { type: 'string', description: 'Timezone (e.g., America/Los_Angeles)', optional: true },
  active: { type: 'boolean', description: 'Whether the user is active', optional: true },
  dateOfBirth: { type: 'string', description: 'Date of birth (YYYY-MM-DD)', optional: true },
  name: {
    type: 'json',
    description: 'Structured name',
    optional: true,
    properties: {
      formatted: { type: 'string', description: 'Formatted full name', optional: true },
      familyName: { type: 'string', description: 'Family (last) name', optional: true },
      familyNamePrefix: { type: 'string', description: 'Family name prefix', optional: true },
      givenName: { type: 'string', description: 'Given (first) name', optional: true },
      middleName: { type: 'string', description: 'Middle name', optional: true },
      honorificPrefix: { type: 'string', description: 'Honorific prefix', optional: true },
      honorificSuffix: { type: 'string', description: 'Honorific suffix', optional: true },
    },
  },
  emails: {
    type: 'array',
    description: 'Email addresses',
    optional: true,
    items: {
      type: 'json',
      properties: {
        value: { type: 'string', description: 'Email address' },
        type: { type: 'string', description: 'Type (e.g., work, home)', optional: true },
        primary: { type: 'boolean', description: 'Primary email flag', optional: true },
        display: { type: 'string', description: 'Display label', optional: true },
        notifications: {
          type: 'boolean',
          description: 'Whether email notifications are enabled',
          optional: true,
        },
        verified: { type: 'boolean', description: 'Whether the email is verified', optional: true },
      },
    },
  },
  phoneNumbers: {
    type: 'array',
    description: 'Phone numbers',
    optional: true,
    items: {
      type: 'json',
      properties: {
        value: { type: 'string', description: 'Phone number' },
        type: { type: 'string', description: 'Type (work, mobile, fax, etc.)', optional: true },
        primary: { type: 'boolean', description: 'Primary phone flag', optional: true },
        display: { type: 'string', description: 'Display label', optional: true },
        notifications: {
          type: 'boolean',
          description: 'Whether SMS notifications are enabled',
          optional: true,
        },
      },
    },
  },
  addresses: {
    type: 'array',
    description: 'Addresses',
    optional: true,
    items: {
      type: 'json',
      properties: {
        type: { type: 'string', description: 'Address type (work, home, etc.)', optional: true },
        formatted: { type: 'string', description: 'Formatted address', optional: true },
        streetAddress: { type: 'string', description: 'Street address', optional: true },
        locality: { type: 'string', description: 'City / locality', optional: true },
        region: { type: 'string', description: 'State / region', optional: true },
        postalCode: { type: 'string', description: 'Postal code', optional: true },
        country: { type: 'string', description: 'ISO 3166-1 country code', optional: true },
        primary: { type: 'boolean', description: 'Primary address flag', optional: true },
      },
    },
  },
  entitlements: {
    type: 'array',
    description: 'Entitlements granted to the user',
    optional: true,
    items: { type: 'json' },
  },
  roles: {
    type: 'array',
    description: 'Roles assigned to the user',
    optional: true,
    items: { type: 'json' },
  },
  schemas: {
    type: 'array',
    description: 'SCIM schemas the resource conforms to',
    optional: true,
    items: { type: 'string' },
  },
  meta: {
    type: 'json',
    description: 'Resource metadata',
    optional: true,
    properties: {
      created: { type: 'string', description: 'Creation timestamp', optional: true },
      lastModified: { type: 'string', description: 'Last modified timestamp', optional: true },
      resourceType: { type: 'string', description: 'Resource type (User)', optional: true },
      location: { type: 'string', description: 'Resource URL', optional: true },
      version: { type: 'string', description: 'ETag version', optional: true },
    },
  },
  emergencyContacts: {
    type: 'array',
    description: 'Emergency contacts',
    optional: true,
    items: {
      type: 'json',
      properties: {
        name: { type: 'string', description: 'Contact full name', optional: true },
        relationship: { type: 'string', description: 'Relationship to user', optional: true },
        emails: { type: 'array', description: 'Emails', optional: true, items: { type: 'json' } },
        phones: { type: 'array', description: 'Phones', optional: true, items: { type: 'json' } },
        streetAddress: { type: 'string', description: 'Street address', optional: true },
        locality: { type: 'string', description: 'City / locality', optional: true },
        region: { type: 'string', description: 'State / region', optional: true },
        postalCode: { type: 'string', description: 'Postal code', optional: true },
        country: { type: 'string', description: 'ISO 3166-1 country code', optional: true },
      },
    },
  },
  localeOverrides: {
    type: 'json',
    description: 'Read-only locale and date/time/number preference overrides',
    optional: true,
  },
  'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': {
    type: 'json',
    description: 'SCIM Enterprise User extension',
    optional: true,
    properties: {
      employeeNumber: { type: 'string', description: 'Employee number', optional: true },
      companyId: { type: 'string', description: 'Concur company identifier', optional: true },
      startDate: { type: 'string', description: 'Employment start date', optional: true },
      terminationDate: {
        type: 'string',
        description: 'Employment termination date',
        optional: true,
      },
      leavesOfAbsence: {
        type: 'array',
        description: 'Leaves of absence',
        optional: true,
        items: {
          type: 'json',
          properties: {
            startDate: { type: 'string', description: 'Leave start date', optional: true },
            endDate: { type: 'string', description: 'Leave end date', optional: true },
            type: { type: 'string', description: 'Leave type', optional: true },
          },
        },
      },
      costCenter: { type: 'string', description: 'Cost center', optional: true },
      organization: { type: 'string', description: 'Organization', optional: true },
      division: { type: 'string', description: 'Division', optional: true },
      department: { type: 'string', description: 'Department', optional: true },
      manager: {
        type: 'json',
        description: 'Manager reference',
        optional: true,
        properties: {
          value: { type: 'string', description: 'Manager UUID', optional: true },
          $ref: { type: 'string', description: 'Manager resource URL', optional: true },
          displayName: { type: 'string', description: 'Manager display name', optional: true },
          employeeNumber: {
            type: 'string',
            description: 'Manager employee number',
            optional: true,
          },
        },
      },
    },
  },
  'urn:ietf:params:scim:schemas:extension:sap:2.0:User': {
    type: 'json',
    description: 'SAP SCIM extension',
    optional: true,
    properties: {
      userUuid: { type: 'string', description: 'SAP global user UUID', optional: true },
    },
  },
  'urn:ietf:params:scim:schemas:extension:sap:concur:2.0:User': {
    type: 'json',
    description: 'SAP Concur SCIM extension (Concur-specific attributes)',
    optional: true,
  },
}

export const scimListResponseOutputProperties: Record<string, OutputProperty> = {
  schemas: {
    type: 'array',
    description: 'SCIM schemas the response conforms to',
    optional: true,
    items: { type: 'string' },
  },
  totalResults: {
    type: 'number',
    description: 'Total number of results matching the query',
    optional: true,
  },
  itemsPerPage: {
    type: 'number',
    description: 'Number of results returned in this page',
    optional: true,
  },
  startIndex: {
    type: 'number',
    description: '1-based index of the first result',
    optional: true,
  },
  cursor: {
    type: 'string',
    description: 'SCIM v4.1 cursor for the next page of results',
    optional: true,
  },
  Resources: {
    type: 'array',
    description: 'SCIM User resources',
    optional: true,
    items: {
      type: 'json',
      properties: scimUserOutputProperties,
    },
  },
}

export const SAP_CONCUR_PROXY_URL = '/api/tools/sap_concur/proxy'

export function baseProxyBody(params: SapConcurBaseParams): Record<string, unknown> {
  const body: Record<string, unknown> = {
    datacenter: params.datacenter ?? 'us.api.concursolutions.com',
    grantType: params.grantType ?? 'client_credentials',
    clientId: params.clientId,
    clientSecret: params.clientSecret,
  }
  if (params.username) body.username = params.username
  if (params.password) body.password = params.password
  if (params.companyUuid) body.companyUuid = params.companyUuid
  return body
}

export function buildListQuery(
  params: Record<string, string | number | boolean | undefined | null>
): Record<string, string | number | boolean> {
  const query: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value.trim() === '') continue
    query[key] = value
  }
  return query
}

export async function transformSapConcurProxyResponse(
  response: Response
): Promise<SapConcurProxyResponse> {
  const data = (await response.json()) as
    | { success: true; output: { status: number; data: unknown } }
    | { success: false; error?: string; status?: number }
  if (!('success' in data) || data.success === false) {
    const errMessage = 'error' in data && data.error ? data.error : 'Concur request failed'
    throw new Error(errMessage)
  }
  return {
    success: true,
    output: {
      status: data.output.status,
      data: data.output.data,
    },
  }
}

export function trimRequired(value: string | undefined, name: string): string {
  if (!value || !value.trim()) {
    throw new Error(`${name} is required`)
  }
  return value.trim()
}
