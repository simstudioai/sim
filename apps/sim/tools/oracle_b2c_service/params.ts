import type { OutputProperty, ToolConfig } from '@/tools/types'

type OracleParams = ToolConfig['params']

export const authParams: OracleParams = {
  siteUrl: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Oracle B2C Service REST Server origin, for example https://example.custhelp.com',
  },
  username: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Oracle B2C Service staff account username',
  },
  password: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Oracle B2C Service staff account password',
  },
  applicationContext: {
    type: 'string',
    required: false,
    visibility: 'user-only',
    default: 'Sim',
    description:
      'OSvC-CREST-Application-Context value used for Oracle resource-pool reporting (defaults to Sim; maximum 40 characters)',
  },
}

export const idParam: OracleParams = {
  id: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Oracle numeric resource ID, represented as a string to preserve precision',
  },
}

export const includeThreadsParam: OracleParams = {
  includeThreads: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Expand incident threads. Leave disabled unless thread context is needed because a long history can be large.',
  },
}

export const listParams: OracleParams = {
  q: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Oracle collection filter expression',
  },
  orderBy: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Oracle collection sort expression, for example updatedTime:desc',
  },
  limit: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    default: 100,
    description: 'Maximum items in this single page (1-1000; defaults to 100)',
  },
  offset: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Zero-based number of items to skip',
  },
  includeTotalResults: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description: 'Ask Oracle to include totalResults for the filtered collection',
  },
  pageUrl: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Same-origin nextPageUrl or previousPageUrl from an earlier call. Mutually exclusive with q, orderBy, limit, offset, and includeTotalResults.',
  },
}

export const incidentWriteParams: OracleParams = {
  subject: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Incident subject',
  },
  primaryContactId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Primary contact numeric ID',
  },
  organizationId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Organization numeric ID',
  },
  queueId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Queue numeric ID',
  },
  severityId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Severity numeric ID',
  },
  categoryId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Category numeric ID',
  },
  productId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Product numeric ID',
  },
  statusId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Incident status numeric ID',
  },
  assignedAccountId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Assigned staff account numeric ID',
  },
  assignedStaffGroupId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Assigned staff group numeric ID',
  },
  customFields: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description: 'Tenant-defined incident customFields object',
  },
}

export const contactWriteParams: OracleParams = {
  firstName: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Contact first name',
  },
  lastName: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Contact last name',
  },
  title: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Contact title',
  },
  organizationId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Organization numeric ID',
  },
  externalReference: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Numeric external-system reference (1-20 digits, first digit 1-9)',
  },
  disabled: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description: 'Whether the contact is disabled',
  },
  emails: {
    type: 'array',
    required: false,
    visibility: 'user-or-llm',
    description: 'Contact email addresses with Oracle address-type IDs',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['address', 'addressTypeId'],
      properties: {
        address: { type: 'string', minLength: 1 },
        addressTypeId: { type: 'string', pattern: '^\\d+$' },
      },
    },
  },
  customFields: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description: 'Tenant-defined contact customFields object',
  },
}

export const organizationWriteParams: OracleParams = {
  name: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Organization name',
  },
  externalReference: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Numeric external-system reference (1-20 digits, first digit 1-9)',
  },
  parentOrganizationId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Parent organization numeric ID',
  },
  industryId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Industry numeric ID',
  },
  numberOfEmployees: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Number of employees',
  },
  customFields: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description: 'Tenant-defined organization customFields object',
  },
}

export const answerWriteParams: OracleParams = {
  answerTypeId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Answer type numeric ID',
  },
  languageId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Language numeric ID',
  },
  summary: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Answer summary',
  },
  question: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Question the answer addresses',
  },
  solution: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Answer solution content',
  },
  keywords: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Search keywords',
  },
  statusId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Answer status numeric ID',
  },
  publishOnDate: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Publication timestamp accepted by Oracle',
  },
  expiresDate: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Expiration timestamp accepted by Oracle',
  },
  customFields: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description: 'Tenant-defined answer customFields object',
  },
}

const namedIdProperties: Record<string, OutputProperty> = {
  id: { type: 'string', nullable: true, description: 'Oracle numeric ID as a string' },
  lookupName: { type: 'string', nullable: true, description: 'Oracle display name' },
}

const baseProperties: Record<string, OutputProperty> = {
  id: { type: 'string', nullable: true, description: 'Oracle numeric ID as a string' },
  lookupName: { type: 'string', nullable: true, description: 'Oracle display name' },
  createdTime: { type: 'string', nullable: true, description: 'Creation timestamp' },
  updatedTime: { type: 'string', nullable: true, description: 'Last update timestamp' },
}

const namedId = (description: string): OutputProperty => ({
  type: 'object',
  nullable: true,
  description,
  properties: namedIdProperties,
})

const resourceReference = (description: string): OutputProperty => ({
  type: 'object',
  nullable: true,
  description,
  properties: {
    links: {
      type: 'array',
      description: 'Oracle links for the referenced REST resource',
      items: {
        type: 'object',
        properties: {
          rel: { type: 'string', nullable: true, description: 'Oracle link relation' },
          href: { type: 'string', nullable: true, description: 'Oracle resource URL' },
        },
      },
    },
  },
})

const statusWithType = (description: string): OutputProperty => ({
  type: 'object',
  nullable: true,
  description,
  properties: {
    status: namedId('Status'),
    statusType: namedId('Status type'),
  },
})

export const incidentProperties: Record<string, OutputProperty> = {
  ...baseProperties,
  subject: { type: 'string', nullable: true, description: 'Incident subject' },
  primaryContact: resourceReference('Primary contact resource reference'),
  organization: resourceReference('Organization resource reference'),
  queue: namedId('Queue'),
  severity: namedId('Severity'),
  category: resourceReference('Service category resource reference'),
  product: resourceReference('Service product resource reference'),
  statusWithType: statusWithType('Incident status and status type'),
  assignedTo: {
    type: 'object',
    nullable: true,
    description: 'Incident assignment',
    properties: {
      account: resourceReference('Assigned staff account resource reference'),
      staffGroup: namedId('Assigned staff group'),
    },
  },
  threads: {
    type: 'array',
    description: 'Expanded incident threads; empty when the response does not expand them',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', nullable: true },
        text: { type: 'string', nullable: true },
        createdTime: { type: 'string', nullable: true },
        channel: namedId('Thread channel'),
        entryType: namedId('Thread entry type'),
      },
    },
  },
  customFields: { type: 'json', nullable: true, description: 'Tenant-defined incident fields' },
}

export const incidentSummaryProperties: Record<string, OutputProperty> = {
  ...baseProperties,
  subject: incidentProperties.subject,
  primaryContact: incidentProperties.primaryContact,
  organization: incidentProperties.organization,
  queue: incidentProperties.queue,
  severity: incidentProperties.severity,
  category: incidentProperties.category,
  product: incidentProperties.product,
  statusWithType: incidentProperties.statusWithType,
  assignedTo: incidentProperties.assignedTo,
}

export const contactProperties: Record<string, OutputProperty> = {
  ...baseProperties,
  name: {
    type: 'object',
    nullable: true,
    description: 'Contact name',
    properties: {
      first: { type: 'string', nullable: true },
      last: { type: 'string', nullable: true },
    },
  },
  title: { type: 'string', nullable: true, description: 'Contact title' },
  disabled: { type: 'boolean', nullable: true, description: 'Whether the contact is disabled' },
  externalReference: { type: 'string', nullable: true, description: 'External reference' },
  organization: resourceReference('Organization resource reference'),
  emails: {
    type: 'array',
    description: 'Expanded contact email addresses',
    items: {
      type: 'object',
      properties: {
        address: { type: 'string', nullable: true },
        addressType: namedId('Email address type'),
      },
    },
  },
  phones: {
    type: 'array',
    description: 'Expanded contact phone numbers',
    items: {
      type: 'object',
      properties: {
        number: { type: 'string', nullable: true },
        rawNumber: { type: 'string', nullable: true },
        phoneType: namedId('Phone number type'),
      },
    },
  },
  customFields: { type: 'json', nullable: true, description: 'Tenant-defined contact fields' },
}

export const contactSummaryProperties: Record<string, OutputProperty> = {
  ...baseProperties,
  name: contactProperties.name,
  title: contactProperties.title,
  disabled: contactProperties.disabled,
  externalReference: contactProperties.externalReference,
  organization: contactProperties.organization,
}

export const organizationProperties: Record<string, OutputProperty> = {
  ...baseProperties,
  name: { type: 'string', nullable: true, description: 'Organization name' },
  externalReference: { type: 'string', nullable: true, description: 'External reference' },
  parent: resourceReference('Parent organization resource reference'),
  industry: namedId('Industry'),
  numberOfEmployees: { type: 'number', nullable: true, description: 'Employee count' },
  customFields: { type: 'json', nullable: true, description: 'Tenant-defined organization fields' },
}

export const organizationSummaryProperties: Record<string, OutputProperty> = {
  ...baseProperties,
  name: organizationProperties.name,
  externalReference: organizationProperties.externalReference,
  parent: organizationProperties.parent,
  industry: organizationProperties.industry,
  numberOfEmployees: organizationProperties.numberOfEmployees,
}

export const answerProperties: Record<string, OutputProperty> = {
  ...baseProperties,
  answerType: namedId('Answer type'),
  language: namedId('Language'),
  summary: { type: 'string', nullable: true, description: 'Answer summary' },
  question: { type: 'string', nullable: true, description: 'Answer question' },
  solution: { type: 'string', nullable: true, description: 'Answer solution' },
  keywords: { type: 'string', nullable: true, description: 'Answer keywords' },
  statusWithType: statusWithType('Answer status and status type'),
  publishOnDate: { type: 'string', nullable: true, description: 'Publication timestamp' },
  expiresDate: { type: 'string', nullable: true, description: 'Expiration timestamp' },
  customFields: { type: 'json', nullable: true, description: 'Tenant-defined answer fields' },
}

export const answerSummaryProperties: Record<string, OutputProperty> = {
  ...baseProperties,
  answerType: answerProperties.answerType,
  language: answerProperties.language,
  summary: answerProperties.summary,
  keywords: answerProperties.keywords,
  statusWithType: answerProperties.statusWithType,
  publishOnDate: answerProperties.publishOnDate,
  expiresDate: answerProperties.expiresDate,
}

export const resourceOutputs = (
  properties: Record<string, OutputProperty>
): ToolConfig['outputs'] => ({
  resource: { type: 'object', description: 'Oracle B2C Service resource', properties },
})

export const pageOutputs = (properties: Record<string, OutputProperty>): ToolConfig['outputs'] => ({
  items: {
    type: 'array',
    description: 'One bounded Oracle collection page',
    items: { type: 'object', properties },
  },
  count: { type: 'number', description: 'Number of items returned in this page' },
  hasMore: { type: 'boolean', description: 'Whether Oracle reports another page' },
  totalResults: {
    type: 'number',
    nullable: true,
    description: 'Total matching items when requested and returned by Oracle',
  },
  nextPageUrl: { type: 'string', nullable: true, description: 'Same-origin URL for the next page' },
  previousPageUrl: {
    type: 'string',
    nullable: true,
    description: 'Same-origin URL for the previous page',
  },
})

export const mutationOutputs: ToolConfig['outputs'] = {
  id: { type: 'string', description: 'Oracle resource ID as a string' },
  updated: { type: 'boolean', optional: true, description: 'Whether the resource was updated' },
  deleted: { type: 'boolean', optional: true, description: 'Whether the resource was deleted' },
}

export const incidentResponseOutputs: ToolConfig['outputs'] = {
  incident: {
    type: 'object',
    nullable: true,
    description: 'Incident that received the response',
    properties: namedIdProperties,
  },
  responseSent: { type: 'boolean', description: 'Whether Oracle accepted the incident response' },
}
