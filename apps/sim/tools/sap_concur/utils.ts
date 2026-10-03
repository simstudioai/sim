import { truncate } from '@sim/utils/string'
import type { SapConcurBaseParams, SapConcurResponse } from '@/tools/sap_concur/types'
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
  preferredLanguage: { type: 'string', description: 'Preferred language tag', optional: true },
  timezone: { type: 'string', description: 'Timezone (e.g., America/Los_Angeles)', optional: true },
  active: { type: 'boolean', description: 'Whether the user is active', optional: true },
  dateOfBirth: { type: 'string', description: 'Date of birth (YYYY-MM-DD)', optional: true },
  name: {
    type: 'json',
    description: 'Structured name',
    optional: true,
    properties: {
      formatted: { type: 'string', description: 'Formatted full name', optional: true },
      academicTitle: { type: 'string', description: 'Academic title', optional: true },
      familyName: { type: 'string', description: 'Family (last) name', optional: true },
      familyNamePrefix: { type: 'string', description: 'Family name prefix', optional: true },
      givenName: { type: 'string', description: 'Given (first) name', optional: true },
      legalName: { type: 'string', description: 'Legal name (read-only)', optional: true },
      middleName: { type: 'string', description: 'Middle name', optional: true },
      middleInitial: { type: 'string', description: 'Middle initial', optional: true },
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
        streetAddress: { type: 'string', description: 'Street address', optional: true },
        locality: { type: 'string', description: 'City / locality', optional: true },
        region: { type: 'string', description: 'State / region', optional: true },
        postalCode: { type: 'string', description: 'Postal code', optional: true },
        country: { type: 'string', description: 'ISO 3166-1 country code', optional: true },
      },
    },
  },
  entitlements: {
    type: 'array',
    description:
      'Concur products the user is entitled to. Supported values: Expense, Invoice, Request, Travel',
    optional: true,
    items: { type: 'string' },
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
      version: { type: 'number', description: 'Resource version number', optional: true },
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
    properties: {
      preference24Hour: { type: 'string', description: '24-hour clock preference', optional: true },
      preferenceCurrencySymbolLocation: {
        type: 'string',
        description: 'Position of the currency symbol',
        optional: true,
      },
      preferenceDateFormat: { type: 'string', description: 'Date format', optional: true },
      preferenceDefaultCalView: {
        type: 'string',
        description: 'Default calendar view',
        optional: true,
      },
      preferenceDistance: { type: 'string', description: 'Distance unit', optional: true },
      preferenceEndDayViewHour: {
        type: 'number',
        description: 'End hour of the day view (0-23)',
        optional: true,
      },
      preferenceFirstDayOfWeek: {
        type: 'string',
        description: 'First day of the week',
        optional: true,
      },
      preferenceHourMinuteSeparator: {
        type: 'string',
        description: 'Hour/minute separator character',
        optional: true,
      },
      preferenceNegativeCurrencyFormat: {
        type: 'string',
        description: 'Negative currency format',
        optional: true,
      },
      preferenceNegativeNumberFormat: {
        type: 'string',
        description: 'Negative number format',
        optional: true,
      },
      preferenceNumberFormat: { type: 'string', description: 'Number format', optional: true },
      preferenceStartDayViewHour: {
        type: 'number',
        description: 'Start hour of the day view (0-23)',
        optional: true,
      },
    },
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
  nextCursor: {
    type: 'string',
    description:
      'SCIM v4.1 cursor to pass as the cursor query param to fetch the next page. Absent on the last page.',
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

export function baseSapConcurInput(params: SapConcurBaseParams): Record<string, unknown> {
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

/**
 * Build a Concur query object from loosely typed tool params.
 *
 * Runs at execution time, after variable resolution, so it is the legal place to coerce
 * types. The agent/LLM tool-call path invokes tools directly and bypasses
 * `tools.config.params`, so a model emitting the string `'false'` would otherwise reach
 * Concur as the literal text `false`, which most filters read as truthy. Only a value that
 * is exactly `'true'` or `'false'` is converted — operator-prefixed filter strings such as
 * `eq:true` or `sw:foo` must pass through untouched. Non-finite numbers are dropped rather
 * than serialized as `NaN`, which the operation schema would reject as `null`.
 */
export function buildListQuery(
  params: Record<string, string | number | boolean | undefined | null>
): Record<string, string | number | boolean> {
  const query: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) continue
      query[key] = value
      continue
    }
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed === '') continue
      if (trimmed === 'true' || trimmed === 'false') {
        query[key] = trimmed === 'true'
        continue
      }
      query[key] = value
      continue
    }
    query[key] = value
  }
  return query
}

/**
 * Cap for a non-JSON operation body echoed back in the thrown error, enough to identify a
 * malformed response without pasting a whole document into the message.
 */
const OPERATION_NON_JSON_BODY_MAX_LENGTH = 200

/**
 * Normalize the direct operation's envelope into a tool response.
 *
 * The body is read as text and parsed explicitly so a malformed provider-operation response
 * produces an actionable error rather than an opaque `SyntaxError` from `response.json()`.
 */
export async function transformSapConcurResponse(response: Response): Promise<SapConcurResponse> {
  const text = await response.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(
      `Concur operation returned a non-JSON response (HTTP ${response.status}): ${truncate(
        text,
        OPERATION_NON_JSON_BODY_MAX_LENGTH
      )}`
    )
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `Concur operation returned a non-JSON response (HTTP ${response.status}): ${truncate(
        text,
        OPERATION_NON_JSON_BODY_MAX_LENGTH
      )}`
    )
  }
  const data = parsed as
    | { success: true; output?: { status: number; data: unknown } }
    | { success: false; error?: string; status?: number }
  if (!('success' in data) || data.success === false) {
    const errMessage = 'error' in data && data.error ? data.error : 'Concur request failed'
    throw new Error(errMessage)
  }
  if (!data.output) {
    throw new Error('Concur operation returned no output')
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
