import { NetSuiteIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { OracleB2CServiceResponse } from '@/tools/oracle_b2c_service/types'

const LIST_OPERATIONS = [
  'list_incidents',
  'list_contacts',
  'list_organizations',
  'list_answers',
] as const

const INCIDENT_WRITE_OPERATIONS = ['create_incident', 'update_incident'] as const
const CONTACT_WRITE_OPERATIONS = ['create_contact', 'update_contact'] as const
const ORGANIZATION_WRITE_OPERATIONS = ['create_organization', 'update_organization'] as const
const ANSWER_WRITE_OPERATIONS = ['create_answer', 'update_answer'] as const
const WRITE_OPERATIONS = [
  ...INCIDENT_WRITE_OPERATIONS,
  ...CONTACT_WRITE_OPERATIONS,
  ...ORGANIZATION_WRITE_OPERATIONS,
  ...ANSWER_WRITE_OPERATIONS,
] as const
const ID_OPERATIONS = [
  'get_incident',
  'update_incident',
  'delete_incident',
  'get_contact',
  'update_contact',
  'delete_contact',
  'get_organization',
  'update_organization',
  'delete_organization',
  'get_answer',
  'update_answer',
  'delete_answer',
] as const

function parseJson(value: unknown, label: string): unknown {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`Invalid JSON provided for ${label}.`)
  }
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return Number(value)
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return value === true || value === 'true'
}

export const OracleB2CServiceBlock: BlockConfig<OracleB2CServiceResponse> = {
  type: 'oracle_b2c_service',
  name: 'Oracle B2C Service',
  description: 'Manage Oracle B2C Service incidents, contacts, organizations, and answers',
  longDescription:
    'Create, retrieve, update, delete, filter, sort, and page through Oracle B2C Service incidents, contacts, organizations, and Classic Answers using the Connect REST API.',
  docsLink: 'https://docs.sim.ai/integrations/oracle_b2c_service',
  category: 'tools',
  integrationType: IntegrationType.Support,
  authMode: AuthMode.ApiKey,
  bgColor: '#FFFFFF',
  icon: NetSuiteIcon,
  canvasPresentation: {
    defaultTitle: 'Oracle B2C Service',
    sentences: {
      byOperation: {
        list_incidents: [
          'List incidents',
          { text: 'matching', field: 'q' },
          { text: ', up to', field: 'limit' },
          { text: ', from page', field: 'pageUrl' },
        ],
        get_incident: [{ text: 'Get incident', field: 'id', core: true }],
        create_incident: [
          { text: 'Create incident', field: 'subject', core: true },
          { text: 'for contact', field: 'primaryContactId' },
        ],
        update_incident: [
          { text: 'Update incident', field: 'id', core: true },
          { text: ', setting subject to', field: 'subject' },
        ],
        delete_incident: [{ text: 'Delete incident', field: 'id', core: true }],
        create_incident_response: [
          { text: 'Respond to incident', field: 'incidentId', core: true },
          { text: ', saying', field: 'text' },
        ],
        list_contacts: [
          'List contacts',
          { text: 'matching', field: 'q' },
          { text: ', up to', field: 'limit' },
          { text: ', from page', field: 'pageUrl' },
        ],
        get_contact: [{ text: 'Get contact', field: 'id', core: true }],
        create_contact: [{ text: 'Create contact', field: ['firstName', 'lastName'], core: true }],
        update_contact: [
          { text: 'Update contact', field: 'id', core: true },
          { text: ', setting name to', field: ['firstName', 'lastName'] },
        ],
        delete_contact: [{ text: 'Delete contact', field: 'id', core: true }],
        list_organizations: [
          'List organizations',
          { text: 'matching', field: 'q' },
          { text: ', up to', field: 'limit' },
          { text: ', from page', field: 'pageUrl' },
        ],
        get_organization: [{ text: 'Get organization', field: 'id', core: true }],
        create_organization: [{ text: 'Create organization', field: 'name', core: true }],
        update_organization: [
          { text: 'Update organization', field: 'id', core: true },
          { text: ', setting name to', field: 'name' },
        ],
        delete_organization: [{ text: 'Delete organization', field: 'id', core: true }],
        list_answers: [
          'List Classic Answers',
          { text: 'matching', field: 'q' },
          { text: ', up to', field: 'limit' },
          { text: ', from page', field: 'pageUrl' },
        ],
        get_answer: [{ text: 'Get Classic Answer', field: 'id', core: true }],
        create_answer: [{ text: 'Create Classic Answer', field: 'summary', core: true }],
        update_answer: [
          { text: 'Update Classic Answer', field: 'id', core: true },
          { text: ', setting summary to', field: 'summary' },
        ],
        delete_answer: [{ text: 'Delete Classic Answer', field: 'id', core: true }],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Incidents', id: 'list_incidents' },
        { label: 'Get Incident', id: 'get_incident' },
        { label: 'Create Incident', id: 'create_incident' },
        { label: 'Update Incident', id: 'update_incident' },
        { label: 'Delete Incident', id: 'delete_incident' },
        { label: 'Create Incident Response', id: 'create_incident_response' },
        { label: 'List Contacts', id: 'list_contacts' },
        { label: 'Get Contact', id: 'get_contact' },
        { label: 'Create Contact', id: 'create_contact' },
        { label: 'Update Contact', id: 'update_contact' },
        { label: 'Delete Contact', id: 'delete_contact' },
        { label: 'List Organizations', id: 'list_organizations' },
        { label: 'Get Organization', id: 'get_organization' },
        { label: 'Create Organization', id: 'create_organization' },
        { label: 'Update Organization', id: 'update_organization' },
        { label: 'Delete Organization', id: 'delete_organization' },
        { label: 'List Classic Answers', id: 'list_answers' },
        { label: 'Get Classic Answer', id: 'get_answer' },
        { label: 'Create Classic Answer', id: 'create_answer' },
        { label: 'Update Classic Answer', id: 'update_answer' },
        { label: 'Delete Classic Answer', id: 'delete_answer' },
      ],
      value: () => 'list_incidents',
    },
    {
      id: 'siteUrl',
      title: 'REST Server URL',
      type: 'short-input',
      placeholder: 'https://example.custhelp.com',
      required: true,
      description: 'HTTPS origin shown as the REST Server URL in Oracle Site Configuration',
    },
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'Oracle staff username',
      required: true,
    },
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      placeholder: 'Oracle staff password',
      password: true,
      required: true,
    },
    {
      id: 'applicationContext',
      title: 'Application Context',
      type: 'short-input',
      placeholder: 'Sim',
      value: () => 'Sim',
      mode: 'advanced',
      description: 'Oracle application-context header, up to 40 characters',
    },
    {
      id: 'id',
      title: 'Resource ID',
      type: 'short-input',
      placeholder: 'Numeric Oracle ID',
      condition: { field: 'operation', value: [...ID_OPERATIONS] },
      required: { field: 'operation', value: [...ID_OPERATIONS] },
    },
    {
      id: 'includeThreads',
      title: 'Include Threads',
      type: 'switch',
      condition: { field: 'operation', value: 'get_incident' },
      mode: 'advanced',
      description:
        'Expand the incident thread history; enable only when the additional context is needed',
    },
    {
      id: 'q',
      title: 'Filter',
      type: 'long-input',
      placeholder: 'statusWithType.status.id=1',
      condition: { field: 'operation', value: [...LIST_OPERATIONS] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an Oracle B2C Service Connect REST collection q expression from the request. Use only documented fields for the selected resource. Return ONLY the expression.',
      },
    },
    {
      id: 'orderBy',
      title: 'Order By',
      type: 'short-input',
      placeholder: 'updatedTime:desc',
      condition: { field: 'operation', value: [...LIST_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '100 (maximum 1000)',
      condition: { field: 'operation', value: [...LIST_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: [...LIST_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'includeTotalResults',
      title: 'Include Total Results',
      type: 'switch',
      condition: { field: 'operation', value: [...LIST_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'pageUrl',
      title: 'Page URL',
      type: 'short-input',
      placeholder: 'Paste nextPageUrl or previousPageUrl',
      condition: { field: 'operation', value: [...LIST_OPERATIONS] },
      mode: 'advanced',
      description: 'Cannot be combined with the other list controls',
    },
    {
      id: 'subject',
      title: 'Subject',
      type: 'short-input',
      placeholder: 'Incident subject',
      condition: { field: 'operation', value: [...INCIDENT_WRITE_OPERATIONS] },
      required: { field: 'operation', value: 'create_incident' },
    },
    {
      id: 'primaryContactId',
      title: 'Primary Contact ID',
      type: 'short-input',
      placeholder: 'Numeric contact ID',
      condition: { field: 'operation', value: [...INCIDENT_WRITE_OPERATIONS] },
      required: { field: 'operation', value: 'create_incident' },
    },
    {
      id: 'organizationId',
      title: 'Organization ID',
      type: 'short-input',
      placeholder: 'Numeric organization ID',
      condition: {
        field: 'operation',
        value: [...INCIDENT_WRITE_OPERATIONS, ...CONTACT_WRITE_OPERATIONS],
      },
      mode: 'advanced',
    },
    {
      id: 'queueId',
      title: 'Queue ID',
      type: 'short-input',
      condition: { field: 'operation', value: [...INCIDENT_WRITE_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'severityId',
      title: 'Severity ID',
      type: 'short-input',
      condition: { field: 'operation', value: [...INCIDENT_WRITE_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'categoryId',
      title: 'Category ID',
      type: 'short-input',
      condition: { field: 'operation', value: [...INCIDENT_WRITE_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'productId',
      title: 'Product ID',
      type: 'short-input',
      condition: { field: 'operation', value: [...INCIDENT_WRITE_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'statusId',
      title: 'Status ID',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [...INCIDENT_WRITE_OPERATIONS, ...ANSWER_WRITE_OPERATIONS],
      },
      mode: 'advanced',
    },
    {
      id: 'assignedAccountId',
      title: 'Assigned Account ID',
      type: 'short-input',
      condition: { field: 'operation', value: [...INCIDENT_WRITE_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'assignedStaffGroupId',
      title: 'Assigned Staff Group ID',
      type: 'short-input',
      condition: { field: 'operation', value: [...INCIDENT_WRITE_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'incidentId',
      title: 'Incident ID',
      type: 'short-input',
      placeholder: 'Numeric incident ID',
      condition: { field: 'operation', value: 'create_incident_response' },
      required: { field: 'operation', value: 'create_incident_response' },
    },
    {
      id: 'text',
      title: 'Response',
      type: 'long-input',
      placeholder: 'Customer-facing response',
      condition: { field: 'operation', value: 'create_incident_response' },
      required: { field: 'operation', value: 'create_incident_response' },
    },
    {
      id: 'responseSubject',
      title: 'Response Subject',
      type: 'short-input',
      condition: { field: 'operation', value: 'create_incident_response' },
      mode: 'advanced',
    },
    {
      id: 'ccEmails',
      title: 'CC Emails',
      type: 'long-input',
      placeholder: '["manager@example.com"]',
      condition: { field: 'operation', value: 'create_incident_response' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: 'Generate a JSON array of CC email-address strings. Return ONLY the JSON array.',
        generationType: 'json-array',
      },
    },
    {
      id: 'bccEmails',
      title: 'BCC Emails',
      type: 'long-input',
      placeholder: '["audit@example.com"]',
      condition: { field: 'operation', value: 'create_incident_response' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: 'Generate a JSON array of BCC email-address strings. Return ONLY the JSON array.',
        generationType: 'json-array',
      },
    },
    {
      id: 'useEmailSignature',
      title: 'Use Email Signature',
      type: 'switch',
      condition: { field: 'operation', value: 'create_incident_response' },
      mode: 'advanced',
    },
    {
      id: 'firstName',
      title: 'First Name',
      type: 'short-input',
      condition: { field: 'operation', value: [...CONTACT_WRITE_OPERATIONS] },
    },
    {
      id: 'lastName',
      title: 'Last Name',
      type: 'short-input',
      condition: { field: 'operation', value: [...CONTACT_WRITE_OPERATIONS] },
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      condition: { field: 'operation', value: [...CONTACT_WRITE_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'externalReference',
      title: 'External Reference',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [...CONTACT_WRITE_OPERATIONS, ...ORGANIZATION_WRITE_OPERATIONS],
      },
      mode: 'advanced',
    },
    {
      id: 'disabled',
      title: 'Disabled',
      type: 'switch',
      condition: { field: 'operation', value: [...CONTACT_WRITE_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'emails',
      title: 'Emails',
      type: 'long-input',
      placeholder: '[{"address":"person@example.com","addressTypeId":"1"}]',
      condition: { field: 'operation', value: [...CONTACT_WRITE_OPERATIONS] },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of Oracle B2C Service email objects with address and addressTypeId string fields. Return ONLY the JSON array.',
        generationType: 'json-array',
      },
    },
    {
      id: 'name',
      title: 'Organization Name',
      type: 'short-input',
      condition: { field: 'operation', value: [...ORGANIZATION_WRITE_OPERATIONS] },
      required: { field: 'operation', value: 'create_organization' },
    },
    {
      id: 'parentOrganizationId',
      title: 'Parent Organization ID',
      type: 'short-input',
      condition: { field: 'operation', value: [...ORGANIZATION_WRITE_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'industryId',
      title: 'Industry ID',
      type: 'short-input',
      condition: { field: 'operation', value: [...ORGANIZATION_WRITE_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'numberOfEmployees',
      title: 'Number of Employees',
      type: 'short-input',
      condition: { field: 'operation', value: [...ORGANIZATION_WRITE_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'answerTypeId',
      title: 'Answer Type ID',
      type: 'short-input',
      condition: { field: 'operation', value: [...ANSWER_WRITE_OPERATIONS] },
      required: { field: 'operation', value: 'create_answer' },
    },
    {
      id: 'languageId',
      title: 'Language ID',
      type: 'short-input',
      condition: { field: 'operation', value: [...ANSWER_WRITE_OPERATIONS] },
      required: { field: 'operation', value: 'create_answer' },
    },
    {
      id: 'summary',
      title: 'Summary',
      type: 'short-input',
      condition: { field: 'operation', value: [...ANSWER_WRITE_OPERATIONS] },
      required: { field: 'operation', value: 'create_answer' },
    },
    {
      id: 'question',
      title: 'Question',
      type: 'long-input',
      condition: { field: 'operation', value: [...ANSWER_WRITE_OPERATIONS] },
    },
    {
      id: 'solution',
      title: 'Solution',
      type: 'long-input',
      condition: { field: 'operation', value: [...ANSWER_WRITE_OPERATIONS] },
    },
    {
      id: 'keywords',
      title: 'Keywords',
      type: 'short-input',
      condition: { field: 'operation', value: [...ANSWER_WRITE_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'publishOnDate',
      title: 'Publish On Date',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp',
      condition: { field: 'operation', value: [...ANSWER_WRITE_OPERATIONS] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: 'Generate an ISO 8601 timestamp. Return ONLY the timestamp.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'expiresDate',
      title: 'Expires Date',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp',
      condition: { field: 'operation', value: [...ANSWER_WRITE_OPERATIONS] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: 'Generate an ISO 8601 timestamp. Return ONLY the timestamp.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'customFields',
      title: 'Custom Fields',
      type: 'long-input',
      placeholder: '{"c":{"custom_field":"value"}}',
      condition: { field: 'operation', value: [...WRITE_OPERATIONS] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an Oracle B2C Service customFields JSON object using only field names and nesting supplied by the user. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
  ],
  tools: {
    access: [
      'oracle_b2c_service_list_incidents',
      'oracle_b2c_service_get_incident',
      'oracle_b2c_service_create_incident',
      'oracle_b2c_service_update_incident',
      'oracle_b2c_service_delete_incident',
      'oracle_b2c_service_create_incident_response',
      'oracle_b2c_service_list_contacts',
      'oracle_b2c_service_get_contact',
      'oracle_b2c_service_create_contact',
      'oracle_b2c_service_update_contact',
      'oracle_b2c_service_delete_contact',
      'oracle_b2c_service_list_organizations',
      'oracle_b2c_service_get_organization',
      'oracle_b2c_service_create_organization',
      'oracle_b2c_service_update_organization',
      'oracle_b2c_service_delete_organization',
      'oracle_b2c_service_list_answers',
      'oracle_b2c_service_get_answer',
      'oracle_b2c_service_create_answer',
      'oracle_b2c_service_update_answer',
      'oracle_b2c_service_delete_answer',
    ],
    config: {
      tool: (params) => `oracle_b2c_service_${params.operation}`,
      params: (params) => {
        const operation = typeof params.operation === 'string' ? params.operation : null
        if (!operation) {
          return {
            ...params,
            customFields: parseJson(params.customFields, 'custom fields'),
            emails: parseJson(params.emails, 'emails'),
            ccEmails: parseJson(params.ccEmails, 'CC emails'),
            bccEmails: parseJson(params.bccEmails, 'BCC emails'),
          }
        }

        const isList = LIST_OPERATIONS.includes(operation as (typeof LIST_OPERATIONS)[number])
        const isWrite = WRITE_OPERATIONS.includes(operation as (typeof WRITE_OPERATIONS)[number])
        const isContactWrite = CONTACT_WRITE_OPERATIONS.includes(
          operation as (typeof CONTACT_WRITE_OPERATIONS)[number]
        )
        const isIncidentResponse = operation === 'create_incident_response'
        const isGetIncident = operation === 'get_incident'

        return {
          ...params,
          operation: undefined,
          subject: isIncidentResponse ? params.responseSubject : params.subject,
          responseSubject: undefined,
          limit: isList ? toOptionalNumber(params.limit) : undefined,
          offset: isList ? toOptionalNumber(params.offset) : undefined,
          includeTotalResults: isList ? toOptionalBoolean(params.includeTotalResults) : undefined,
          includeThreads: isGetIncident ? toOptionalBoolean(params.includeThreads) : undefined,
          numberOfEmployees: ORGANIZATION_WRITE_OPERATIONS.includes(
            operation as (typeof ORGANIZATION_WRITE_OPERATIONS)[number]
          )
            ? toOptionalNumber(params.numberOfEmployees)
            : undefined,
          disabled: isContactWrite ? toOptionalBoolean(params.disabled) : undefined,
          useEmailSignature: isIncidentResponse
            ? toOptionalBoolean(params.useEmailSignature)
            : undefined,
          customFields: isWrite ? parseJson(params.customFields, 'custom fields') : undefined,
          emails: isContactWrite ? parseJson(params.emails, 'emails') : undefined,
          ccEmails: isIncidentResponse ? parseJson(params.ccEmails, 'CC emails') : undefined,
          bccEmails: isIncidentResponse ? parseJson(params.bccEmails, 'BCC emails') : undefined,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    siteUrl: { type: 'string', description: 'Oracle B2C Service REST Server origin' },
    username: { type: 'string', description: 'Oracle staff username' },
    password: { type: 'string', description: 'Oracle staff password' },
    applicationContext: { type: 'string', description: 'Oracle application context' },
    id: { type: 'string', description: 'Oracle resource ID' },
    includeThreads: { type: 'boolean', description: 'Whether to expand incident threads' },
    q: { type: 'string', description: 'Oracle collection filter' },
    orderBy: { type: 'string', description: 'Oracle collection sort expression' },
    limit: { type: 'number', description: 'Maximum items in one page' },
    offset: { type: 'number', description: 'Pagination offset' },
    includeTotalResults: { type: 'boolean', description: 'Request a total result count' },
    pageUrl: { type: 'string', description: 'Same-origin Oracle pagination URL' },
    subject: { type: 'string', description: 'Incident subject' },
    responseSubject: { type: 'string', description: 'Incident response subject' },
    primaryContactId: { type: 'string', description: 'Primary contact ID' },
    organizationId: { type: 'string', description: 'Organization ID' },
    queueId: { type: 'string', description: 'Queue ID' },
    severityId: { type: 'string', description: 'Severity ID' },
    categoryId: { type: 'string', description: 'Category ID' },
    productId: { type: 'string', description: 'Product ID' },
    statusId: { type: 'string', description: 'Status ID' },
    assignedAccountId: { type: 'string', description: 'Assigned staff account ID' },
    assignedStaffGroupId: { type: 'string', description: 'Assigned staff group ID' },
    incidentId: { type: 'string', description: 'Incident ID for a response' },
    text: { type: 'string', description: 'Incident response text' },
    ccEmails: { type: 'array', description: 'CC email addresses' },
    bccEmails: { type: 'array', description: 'BCC email addresses' },
    useEmailSignature: { type: 'boolean', description: 'Append the staff email signature' },
    firstName: { type: 'string', description: 'Contact first name' },
    lastName: { type: 'string', description: 'Contact last name' },
    title: { type: 'string', description: 'Contact title' },
    externalReference: { type: 'string', description: 'External-system reference' },
    disabled: { type: 'boolean', description: 'Whether the contact is disabled' },
    emails: { type: 'array', description: 'Contact email definitions' },
    name: { type: 'string', description: 'Organization name' },
    parentOrganizationId: { type: 'string', description: 'Parent organization ID' },
    industryId: { type: 'string', description: 'Industry ID' },
    numberOfEmployees: { type: 'number', description: 'Number of employees' },
    answerTypeId: { type: 'string', description: 'Answer type ID' },
    languageId: { type: 'string', description: 'Language ID' },
    summary: { type: 'string', description: 'Answer summary' },
    question: { type: 'string', description: 'Answer question' },
    solution: { type: 'string', description: 'Answer solution' },
    keywords: { type: 'string', description: 'Answer keywords' },
    publishOnDate: { type: 'string', description: 'Answer publication timestamp' },
    expiresDate: { type: 'string', description: 'Answer expiration timestamp' },
    customFields: { type: 'json', description: 'Tenant-defined custom fields' },
  },
  outputs: {
    resource: { type: 'json', description: 'Created or retrieved Oracle resource' },
    items: { type: 'array', description: 'One bounded Oracle collection page' },
    count: { type: 'number', description: 'Items in the returned page' },
    hasMore: { type: 'boolean', description: 'Whether Oracle reports another page' },
    totalResults: { type: 'number', description: 'Total matching resources when requested' },
    nextPageUrl: { type: 'string', description: 'URL for the next page' },
    previousPageUrl: { type: 'string', description: 'URL for the previous page' },
    id: { type: 'string', description: 'Updated or deleted resource ID' },
    updated: { type: 'boolean', description: 'Whether the resource was updated' },
    deleted: { type: 'boolean', description: 'Whether the resource was deleted' },
    incident: { type: 'json', description: 'Incident that received a response' },
    responseSent: { type: 'boolean', description: 'Whether the response was sent' },
  },
}

export const OracleB2CServiceBlockMeta = {
  tags: ['customer-support', 'ticketing', 'knowledge-base', 'automation'],
  url: 'https://www.oracle.com/cx/service/customer-service/',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Oracle B2C incident triage',
      prompt:
        'Build a scheduled workflow that lists recently updated Oracle B2C Service incidents, classifies urgency and topic, and sends agents a concise prioritized triage queue.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation', 'analysis'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Oracle B2C SLA risk alerts',
      prompt:
        'Create a scheduled workflow that filters Oracle B2C Service incidents nearing their response target and alerts the support lead in Slack with incident IDs and assignment references.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'monitoring', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Oracle B2C grounded incident response',
      prompt:
        'Build an agent workflow that retrieves an Oracle B2C Service incident, drafts a response from approved knowledge, and sends it with Create Incident Response after review.',
      modules: ['agent', 'knowledge-base', 'workflows'],
      category: 'support',
      tags: ['support', 'ai', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Oracle B2C weekly CX pulse',
      prompt:
        'Create a weekly workflow that pages through a bounded set of Oracle B2C Service incidents, summarizes recurring customer issues, and emails a CX pulse report.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'reporting', 'analysis'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Oracle B2C customer record sync',
      prompt:
        'Build a workflow that finds an Oracle B2C Service contact and organization by external reference, then creates or updates only the changed customer fields.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['sync', 'support', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Promote resolution to Oracle answer',
      prompt:
        'Create a workflow that retrieves a resolved Oracle B2C Service incident, drafts a reusable Classic Answer, and creates it with the chosen type and language for review.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['knowledge-base', 'support', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Oracle answer review queue',
      prompt:
        'Build a scheduled workflow that lists Oracle B2C Service Classic Answers due to expire, summarizes each one, and creates a bounded editorial review queue.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'support',
      tags: ['knowledge-base', 'analysis', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Oracle B2C account hygiene audit',
      prompt:
        'Create a scheduled workflow that lists disabled Oracle B2C Service contacts and organizations with missing external references, then reports records needing cleanup.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['support', 'analysis', 'automation'],
    },
  ],
  skills: [
    {
      name: 'triage-incidents',
      description: 'Build a bounded Oracle B2C Service incident triage queue.',
      content:
        '# Triage Incidents\n\nFind the incidents that need attention without loading an unbounded queue.\n\n## Steps\n1. Use List Incidents with a specific `q`, `orderBy`, and page size no larger than the number you can inspect.\n2. Read `hasMore` and `nextPageUrl`; fetch another page only when the task requires it.\n3. Use Get Incident for the small set that needs thread context.\n4. Rank by the documented status, severity, queue, assignment, and timestamps returned by the tools.\n\n## Output\nReturn incident IDs, subjects, priority rationale, and the next page URL when work remains.',
    },
    {
      name: 'respond-to-incident',
      description: 'Read an incident and send a deliberate customer-facing response.',
      content:
        '# Respond to an Incident\n\nSend a response only after reading the incident context.\n\n## Steps\n1. Use Get Incident with the exact incident ID and enable `includeThreads` to review its thread history.\n2. Draft a concise answer grounded in the available incident and approved knowledge.\n3. Use Create Incident Response with the incident ID and response text; add CC, BCC, subject, or the staff signature only when requested.\n4. Do not use Update Incident to simulate a customer response.\n\n## Output\nConfirm the returned incident ID and that `responseSent` is true, then summarize what was sent.',
    },
    {
      name: 'sync-customer-records',
      description: 'Create or update Oracle contacts and organizations without duplicating them.',
      content:
        '# Sync Customer Records\n\nKeep customer records aligned with an external system.\n\n## Steps\n1. Use List Organizations or List Contacts with a narrow `q` on the known external reference.\n2. If exactly one record matches, use the corresponding Update operation with only changed fields.\n3. If no record matches, create the organization first, then create the contact with its organization ID.\n4. Stop and report ambiguity if multiple records match.\n\n## Output\nReturn the affected contact and organization IDs and say whether each was created or updated.',
    },
    {
      name: 'curate-answers',
      description: 'Review and maintain Oracle B2C Service Classic Answers.',
      content:
        '# Curate Classic Answers\n\nMaintain a focused knowledge review queue.\n\n## Steps\n1. Use List Classic Answers with a bounded page, a targeted `q`, and an `orderBy` expression.\n2. Use Get Classic Answer before editing a candidate.\n3. Use Update Classic Answer only for supported fields such as summary, question, solution, keywords, status, and publication dates.\n4. Delete only when the user explicitly requests deletion.\n\n## Output\nList answer IDs, summaries, the action taken, and `nextPageUrl` when another review page exists.',
    },
    {
      name: 'promote-resolution-to-answer',
      description: 'Turn a resolved incident into a reusable Classic Answer draft.',
      content:
        '# Promote a Resolution to an Answer\n\nConvert a proven support resolution into reusable knowledge.\n\n## Steps\n1. Use Get Incident with `includeThreads` enabled and verify the thread history contains a resolved, reusable procedure.\n2. Draft a summary, question, and solution without including customer-specific data.\n3. Use Create Classic Answer with the required answer-type ID, language ID, and summary.\n4. Set status or publication dates only when the user provides the tenant-specific IDs and schedule.\n\n## Output\nReturn the created answer ID and a short account of which incident evidence it came from.',
    },
    {
      name: 'page-oracle-collections',
      description: 'Navigate Oracle collection pages safely and with bounded memory.',
      content:
        '# Page Oracle Collections\n\nNavigate list results one bounded page at a time.\n\n## Steps\n1. Start with one List operation and a page size between 1 and 1,000; use 100 unless the task needs another bound.\n2. Apply `q`, `orderBy`, `offset`, and total-results settings only on the first request.\n3. For the next or previous page, call the same List operation with only the returned `pageUrl` plus credentials.\n4. Never accumulate every page by default; process a page and stop when the task is satisfied.\n\n## Output\nReturn the processed page count, item count, `hasMore`, and the next page URL when relevant.',
    },
  ],
} as const satisfies BlockMeta
