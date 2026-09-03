import { NetSuiteIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import {
  parseOptionalBooleanInput,
  parseOptionalJsonInput,
  parseOptionalNumberInput,
} from '@/blocks/utils'
import type { EloquaResponse } from '@/tools/eloqua/types'

const APPLICATION_LIST_OPERATIONS = [
  'list_contacts',
  'list_accounts',
  'list_campaigns',
  'list_contact_lists',
  'list_segments',
  'list_emails',
  'list_forms',
] as const

const APPLICATION_GET_OPERATIONS = [
  'get_contact',
  'get_account',
  'get_campaign',
  'get_contact_list',
  'get_segment',
  'get_email',
  'get_form',
] as const

const BULK_PAGE_OPERATIONS = [
  'list_contact_fields',
  'list_bulk_syncs',
  'get_bulk_sync_data',
  'get_bulk_sync_logs',
  'get_bulk_sync_rejects',
] as const

const BULK_SEARCH_OPERATIONS = [
  'list_contact_fields',
  'list_bulk_syncs',
  'get_bulk_sync_logs',
  'get_bulk_sync_rejects',
] as const

const ELOQUA_TOOL_IDS = [
  'eloqua_list_contacts',
  'eloqua_get_contact',
  'eloqua_create_contact',
  'eloqua_update_contact',
  'eloqua_list_accounts',
  'eloqua_get_account',
  'eloqua_create_account',
  'eloqua_update_account',
  'eloqua_list_campaigns',
  'eloqua_get_campaign',
  'eloqua_activate_campaign',
  'eloqua_deactivate_campaign',
  'eloqua_list_contact_lists',
  'eloqua_get_contact_list',
  'eloqua_list_segments',
  'eloqua_get_segment',
  'eloqua_list_emails',
  'eloqua_get_email',
  'eloqua_list_forms',
  'eloqua_get_form',
  'eloqua_list_contact_fields',
  'eloqua_create_contact_import',
  'eloqua_upload_contact_import_data',
  'eloqua_create_contact_export',
  'eloqua_list_bulk_syncs',
  'eloqua_start_bulk_sync',
  'eloqua_get_bulk_sync',
  'eloqua_get_bulk_sync_data',
  'eloqua_get_bulk_sync_logs',
  'eloqua_get_bulk_sync_rejects',
] as const

const ELOQUA_OPERATIONS = new Set(ELOQUA_TOOL_IDS.map((id) => id.slice('eloqua_'.length)))

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required.`)
  }
  return value.trim()
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function requiredJsonObject(value: unknown, label: string): Record<string, unknown> {
  const parsed = parseOptionalJsonInput<unknown>(value, label)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`)
  }
  return parsed as Record<string, unknown>
}

function requiredJsonObjectArray(value: unknown, label: string): Array<Record<string, unknown>> {
  const parsed = parseOptionalJsonInput<unknown>(value, label)
  if (
    !Array.isArray(parsed) ||
    !parsed.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item))
  ) {
    throw new Error(`${label} must be a JSON array of objects.`)
  }
  return parsed as Array<Record<string, unknown>>
}

function optionalInteger(
  value: unknown,
  label: string,
  options: { min?: number; max?: number } = {}
): number | undefined {
  return parseOptionalNumberInput(value, label, { integer: true, ...options })
}

function commonParams(params: Record<string, unknown>) {
  return { oauthCredential: requiredString(params.oauthCredential, 'Oracle Eloqua account') }
}

function applicationListParams(params: Record<string, unknown>) {
  return {
    ...(optionalString(params.depth) && { depth: optionalString(params.depth) }),
    ...(optionalInteger(params.count, 'Count', { min: 1, max: 1000 }) !== undefined && {
      count: optionalInteger(params.count, 'Count', { min: 1, max: 1000 }),
    }),
    ...(optionalInteger(params.page, 'Page', { min: 1 }) !== undefined && {
      page: optionalInteger(params.page, 'Page', { min: 1 }),
    }),
    ...(optionalString(params.search) && { search: optionalString(params.search) }),
    ...(optionalString(params.orderBy) && { orderBy: optionalString(params.orderBy) }),
    ...(optionalInteger(params.lastUpdatedAt, 'Last updated at', { min: 0 }) !== undefined && {
      lastUpdatedAt: optionalInteger(params.lastUpdatedAt, 'Last updated at', { min: 0 }),
    }),
  }
}

function optionalCampaignSchedule(value: unknown): string | undefined {
  const scheduledFor = optionalString(value)
  if (scheduledFor && scheduledFor !== 'now' && !/^\d+$/.test(scheduledFor)) {
    throw new Error('Scheduled for must be a Unix timestamp or the literal "now".')
  }
  return scheduledFor
}

function bulkPageParams(
  params: Record<string, unknown>,
  includeSearch: boolean,
  maxLimit: 1_000 | 50_000
) {
  const totalResults = parseOptionalBooleanInput(params.totalResults)
  return {
    ...(optionalInteger(params.limit, 'Limit', { min: 1, max: maxLimit }) !== undefined && {
      limit: optionalInteger(params.limit, 'Limit', { min: 1, max: maxLimit }),
    }),
    ...(optionalInteger(params.offset, 'Offset', { min: 0 }) !== undefined && {
      offset: optionalInteger(params.offset, 'Offset', { min: 0 }),
    }),
    ...(includeSearch && optionalString(params.q) ? { q: optionalString(params.q) } : {}),
    ...(includeSearch && optionalString(params.bulkOrderBy)
      ? { orderBy: optionalString(params.bulkOrderBy) }
      : {}),
    ...(totalResults !== undefined ? { totalResults } : {}),
  }
}

export const EloquaBlock: BlockConfig<EloquaResponse> = {
  type: 'eloqua',
  name: 'Oracle Eloqua',
  description: 'Manage Eloqua contacts, accounts, marketing assets, and Bulk API syncs',
  authMode: AuthMode.OAuth,
  longDescription:
    'Connect Oracle Eloqua to list and manage contacts and accounts, inspect campaigns and marketing assets, activate campaigns, and run explicit Bulk API import and export lifecycles. Results are returned one bounded page at a time. Contact and account updates use Eloqua full-representation PUT semantics, so retrieve and preserve fields before updating. Bulk jobs remain explicit: create a definition, upload import data when applicable, start a sync, inspect its status, and retrieve results, logs, or rejects.',
  docsLink: 'https://docs.sim.ai/integrations/eloqua',
  category: 'tools',
  integrationType: IntegrationType.Marketing,
  bgColor: '#FFFFFF',
  icon: NetSuiteIcon,
  canvasPresentation: {
    defaultTitle: 'Oracle Eloqua',
    sentences: {
      byOperation: {
        list_contacts: ['List Eloqua contacts', { text: ', matching', field: 'search' }],
        get_contact: [{ text: 'Read Eloqua contact', field: 'contactId', core: true }],
        create_contact: ['Create an Eloqua contact'],
        update_contact: [{ text: 'Update Eloqua contact', field: 'contactId', core: true }],
        list_accounts: ['List Eloqua accounts', { text: ', matching', field: 'search' }],
        get_account: [{ text: 'Read Eloqua account', field: 'accountId', core: true }],
        create_account: ['Create an Eloqua account'],
        update_account: [{ text: 'Update Eloqua account', field: 'accountId', core: true }],
        list_campaigns: ['List Eloqua campaigns', { text: ', matching', field: 'search' }],
        get_campaign: ['Read an Eloqua campaign'],
        activate_campaign: ['Activate an Eloqua campaign'],
        deactivate_campaign: ['Deactivate an Eloqua campaign'],
        list_contact_lists: ['List Eloqua contact lists', { text: ', matching', field: 'search' }],
        get_contact_list: ['Read an Eloqua contact list'],
        list_segments: ['List Eloqua segments', { text: ', matching', field: 'search' }],
        get_segment: ['Read an Eloqua segment'],
        list_emails: ['List Eloqua emails', { text: ', matching', field: 'search' }],
        get_email: ['Read an Eloqua email'],
        list_forms: ['List Eloqua forms', { text: ', matching', field: 'search' }],
        get_form: ['Read an Eloqua form'],
        list_contact_fields: ['List Eloqua Bulk contact fields'],
        create_contact_import: ['Create an Eloqua contact import definition'],
        upload_contact_import_data: [
          { text: 'Upload data to Eloqua import', field: 'importId', core: true },
        ],
        create_contact_export: ['Create an Eloqua contact export definition'],
        list_bulk_syncs: ['List Eloqua Bulk syncs'],
        start_bulk_sync: [
          { text: 'Start Eloqua Bulk sync for', field: 'syncedInstanceUri', core: true },
        ],
        get_bulk_sync: [{ text: 'Read Eloqua Bulk sync', field: 'syncId', core: true }],
        get_bulk_sync_data: [
          { text: 'Read data from Eloqua Bulk sync', field: 'syncId', core: true },
        ],
        get_bulk_sync_logs: [
          { text: 'Read logs from Eloqua Bulk sync', field: 'syncId', core: true },
        ],
        get_bulk_sync_rejects: [
          { text: 'Read rejects from Eloqua Bulk sync', field: 'syncId', core: true },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Contacts', id: 'list_contacts' },
        { label: 'Get Contact', id: 'get_contact' },
        { label: 'Create Contact', id: 'create_contact' },
        { label: 'Update Contact', id: 'update_contact' },
        { label: 'List Accounts', id: 'list_accounts' },
        { label: 'Get Account', id: 'get_account' },
        { label: 'Create Account', id: 'create_account' },
        { label: 'Update Account', id: 'update_account' },
        { label: 'List Campaigns', id: 'list_campaigns' },
        { label: 'Get Campaign', id: 'get_campaign' },
        { label: 'Activate Campaign', id: 'activate_campaign' },
        { label: 'Deactivate Campaign', id: 'deactivate_campaign' },
        { label: 'List Contact Lists', id: 'list_contact_lists' },
        { label: 'Get Contact List', id: 'get_contact_list' },
        { label: 'List Segments', id: 'list_segments' },
        { label: 'Get Segment', id: 'get_segment' },
        { label: 'List Emails', id: 'list_emails' },
        { label: 'Get Email', id: 'get_email' },
        { label: 'List Forms', id: 'list_forms' },
        { label: 'Get Form', id: 'get_form' },
        { label: 'List Contact Fields (Bulk)', id: 'list_contact_fields' },
        { label: 'Create Contact Import (Bulk)', id: 'create_contact_import' },
        { label: 'Upload Contact Import Data (Bulk)', id: 'upload_contact_import_data' },
        { label: 'Create Contact Export (Bulk)', id: 'create_contact_export' },
        { label: 'List Syncs (Bulk)', id: 'list_bulk_syncs' },
        { label: 'Start Sync (Bulk)', id: 'start_bulk_sync' },
        { label: 'Get Sync (Bulk)', id: 'get_bulk_sync' },
        { label: 'Get Sync Data (Bulk)', id: 'get_bulk_sync_data' },
        { label: 'Get Sync Logs (Bulk)', id: 'get_bulk_sync_logs' },
        { label: 'Get Sync Rejects (Bulk)', id: 'get_bulk_sync_rejects' },
      ],
      value: () => 'list_contacts',
    },
    {
      id: 'credential',
      title: 'Oracle Eloqua Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      serviceId: 'eloqua',
      requiredScopes: getScopesForService('eloqua'),
      placeholder: 'Select Oracle Eloqua account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Oracle Eloqua Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'contactId',
      title: 'Contact ID',
      type: 'short-input',
      placeholder: 'Enter numeric contact ID',
      condition: { field: 'operation', value: ['get_contact', 'update_contact'] },
      required: { field: 'operation', value: ['get_contact', 'update_contact'] },
    },
    {
      id: 'accountId',
      title: 'Account ID',
      type: 'short-input',
      placeholder: 'Enter numeric account ID',
      condition: { field: 'operation', value: ['get_account', 'update_account'] },
      required: { field: 'operation', value: ['get_account', 'update_account'] },
    },
    {
      id: 'campaignSelector',
      title: 'Campaign',
      type: 'project-selector',
      canonicalParamId: 'campaignId',
      serviceId: 'eloqua',
      selectorKey: 'eloqua.campaigns',
      dependsOn: ['credential'],
      mode: 'basic',
      placeholder: 'Select campaign',
      condition: {
        field: 'operation',
        value: ['get_campaign', 'activate_campaign', 'deactivate_campaign'],
      },
      required: {
        field: 'operation',
        value: ['get_campaign', 'activate_campaign', 'deactivate_campaign'],
      },
    },
    {
      id: 'campaignIdInput',
      title: 'Campaign ID',
      type: 'short-input',
      canonicalParamId: 'campaignId',
      mode: 'advanced',
      placeholder: 'Enter numeric campaign ID',
      condition: {
        field: 'operation',
        value: ['get_campaign', 'activate_campaign', 'deactivate_campaign'],
      },
      required: {
        field: 'operation',
        value: ['get_campaign', 'activate_campaign', 'deactivate_campaign'],
      },
    },
    {
      id: 'contactListSelector',
      title: 'Contact List',
      type: 'project-selector',
      canonicalParamId: 'contactListId',
      serviceId: 'eloqua',
      selectorKey: 'eloqua.contactLists',
      dependsOn: ['credential'],
      mode: 'basic',
      placeholder: 'Select contact list',
      condition: { field: 'operation', value: 'get_contact_list' },
      required: { field: 'operation', value: 'get_contact_list' },
    },
    {
      id: 'contactListIdInput',
      title: 'Contact List ID',
      type: 'short-input',
      canonicalParamId: 'contactListId',
      mode: 'advanced',
      placeholder: 'Enter numeric contact list ID',
      condition: { field: 'operation', value: 'get_contact_list' },
      required: { field: 'operation', value: 'get_contact_list' },
    },
    {
      id: 'segmentSelector',
      title: 'Segment',
      type: 'project-selector',
      canonicalParamId: 'segmentId',
      serviceId: 'eloqua',
      selectorKey: 'eloqua.segments',
      dependsOn: ['credential'],
      mode: 'basic',
      placeholder: 'Select segment',
      condition: { field: 'operation', value: 'get_segment' },
      required: { field: 'operation', value: 'get_segment' },
    },
    {
      id: 'segmentIdInput',
      title: 'Segment ID',
      type: 'short-input',
      canonicalParamId: 'segmentId',
      mode: 'advanced',
      placeholder: 'Enter numeric segment ID',
      condition: { field: 'operation', value: 'get_segment' },
      required: { field: 'operation', value: 'get_segment' },
    },
    {
      id: 'emailSelector',
      title: 'Email',
      type: 'project-selector',
      canonicalParamId: 'emailId',
      serviceId: 'eloqua',
      selectorKey: 'eloqua.emails',
      dependsOn: ['credential'],
      mode: 'basic',
      placeholder: 'Select email',
      condition: { field: 'operation', value: 'get_email' },
      required: { field: 'operation', value: 'get_email' },
    },
    {
      id: 'emailIdInput',
      title: 'Email ID',
      type: 'short-input',
      canonicalParamId: 'emailId',
      mode: 'advanced',
      placeholder: 'Enter numeric email ID',
      condition: { field: 'operation', value: 'get_email' },
      required: { field: 'operation', value: 'get_email' },
    },
    {
      id: 'formSelector',
      title: 'Form',
      type: 'project-selector',
      canonicalParamId: 'formId',
      serviceId: 'eloqua',
      selectorKey: 'eloqua.forms',
      dependsOn: ['credential'],
      mode: 'basic',
      placeholder: 'Select form',
      condition: { field: 'operation', value: 'get_form' },
      required: { field: 'operation', value: 'get_form' },
    },
    {
      id: 'formIdInput',
      title: 'Form ID',
      type: 'short-input',
      canonicalParamId: 'formId',
      mode: 'advanced',
      placeholder: 'Enter numeric form ID',
      condition: { field: 'operation', value: 'get_form' },
      required: { field: 'operation', value: 'get_form' },
    },
    {
      id: 'entity',
      title: 'Entity',
      type: 'long-input',
      placeholder: 'JSON object using documented Eloqua fields',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact', 'create_account', 'update_account'],
      },
      required: {
        field: 'operation',
        value: ['create_contact', 'update_contact', 'create_account', 'update_account'],
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a valid JSON object using only documented Oracle Eloqua Contact or Account fields supplied by the user. For updates, preserve the complete retrieved representation because Eloqua PUT is full-representation. Return ONLY the paste-ready JSON object with no markdown or explanation.',
        placeholder: 'Describe the contact or account fields to set...',
        generationType: 'json-object',
      },
    },
    {
      id: 'depth',
      title: 'Response Depth',
      type: 'dropdown',
      options: [
        { label: 'Provider Default', id: '' },
        { label: 'Minimal', id: 'minimal' },
        { label: 'Partial', id: 'partial' },
        { label: 'Complete', id: 'complete' },
      ],
      value: () => '',
      condition: {
        field: 'operation',
        value: [...APPLICATION_LIST_OPERATIONS, ...APPLICATION_GET_OPERATIONS],
      },
      mode: 'advanced',
    },
    {
      id: 'count',
      title: 'Results Per Page',
      type: 'short-input',
      placeholder: '1-1000',
      condition: { field: 'operation', value: [...APPLICATION_LIST_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: 'One-based page number',
      condition: { field: 'operation', value: [...APPLICATION_LIST_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'search',
      title: 'Search',
      type: 'short-input',
      placeholder: "name='Welcome*'",
      description: 'Eloqua search expression. Escape an apostrophe inside a value by doubling it.',
      condition: { field: 'operation', value: [...APPLICATION_LIST_OPERATIONS] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          "Generate an Oracle Eloqua Application API search expression. Use field='value' clauses, double apostrophes inside quoted values, and use a trailing wildcard only when prefix matching is requested. Return ONLY the paste-ready search expression with no markdown or explanation.",
        placeholder: 'Describe the Eloqua records to find...',
      },
    },
    {
      id: 'orderBy',
      title: 'Order By',
      type: 'short-input',
      placeholder: 'name ASC',
      condition: { field: 'operation', value: [...APPLICATION_LIST_OPERATIONS] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an Oracle Eloqua Application API orderBy expression such as name ASC using the requested field and direction. Return ONLY the paste-ready orderBy expression with no markdown or explanation.',
        placeholder: 'Describe how to order this page...',
      },
    },
    {
      id: 'lastUpdatedAt',
      title: 'Last Updated At',
      type: 'short-input',
      placeholder: 'Unix timestamp',
      condition: { field: 'operation', value: [...APPLICATION_LIST_OPERATIONS] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Convert the requested time to a Unix timestamp in seconds. Return ONLY the integer with no explanation.',
        placeholder: 'Describe the earliest update time...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'viewId',
      title: 'View ID',
      type: 'short-input',
      placeholder: 'Contact or account view ID',
      condition: {
        field: 'operation',
        value: ['list_contacts', 'get_contact', 'list_accounts', 'get_account'],
      },
      mode: 'advanced',
    },
    {
      id: 'ownedByUserId',
      title: 'Owned By User ID',
      type: 'short-input',
      placeholder: 'Eloqua user ID',
      condition: { field: 'operation', value: 'list_accounts' },
      mode: 'advanced',
    },
    {
      id: 'externalSystemId',
      title: 'External System ID',
      type: 'short-input',
      placeholder: 'CRM external system ID',
      condition: { field: 'operation', value: ['list_campaigns', 'get_campaign'] },
      mode: 'advanced',
    },
    {
      id: 'includeCrmIdsMapping',
      title: 'Include CRM ID Mapping',
      type: 'switch',
      condition: { field: 'operation', value: ['list_campaigns', 'get_campaign'] },
      mode: 'advanced',
    },
    {
      id: 'includeAvailable',
      title: 'Include Available Assets',
      type: 'switch',
      condition: { field: 'operation', value: ['list_emails', 'list_forms'] },
      mode: 'advanced',
    },
    {
      id: 'includeArchived',
      title: 'Include Archived Assets',
      type: 'switch',
      condition: { field: 'operation', value: ['list_emails', 'list_forms'] },
      mode: 'advanced',
    },
    {
      id: 'preMerge',
      title: 'Pre-Merge Email',
      type: 'switch',
      condition: { field: 'operation', value: 'get_email' },
      mode: 'advanced',
    },
    {
      id: 'noMergeContent',
      title: 'Exclude Merge Content',
      type: 'switch',
      condition: { field: 'operation', value: 'get_email' },
      mode: 'advanced',
    },
    {
      id: 'scheduledFor',
      title: 'Scheduled For',
      type: 'short-input',
      placeholder: 'Unix timestamp or now',
      condition: { field: 'operation', value: 'activate_campaign' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Convert the requested campaign activation time to a Unix timestamp in seconds, or use the literal now for immediate activation. Return ONLY the timestamp or now with no explanation.',
        placeholder: 'Describe when the campaign should activate...',
      },
    },
    {
      id: 'runAsUserId',
      title: 'Run As User ID',
      type: 'short-input',
      placeholder: 'Eloqua user ID',
      condition: { field: 'operation', value: 'activate_campaign' },
      mode: 'advanced',
    },
    {
      id: 'activateNow',
      title: 'Activate Now',
      type: 'switch',
      condition: { field: 'operation', value: 'activate_campaign' },
      mode: 'advanced',
    },
    {
      id: 'definition',
      title: 'Bulk Definition',
      type: 'long-input',
      placeholder: 'JSON definition with name, fields, and import/export settings',
      condition: {
        field: 'operation',
        value: ['create_contact_import', 'create_contact_export'],
      },
      required: {
        field: 'operation',
        value: ['create_contact_import', 'create_contact_export'],
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an Oracle Eloqua Bulk API 2.0 contact import or export definition from the supplied aliases and field statements. Do not invent field statements. Return ONLY the paste-ready JSON object with no markdown or explanation.',
        placeholder: 'Describe the Bulk aliases, fields, and import or export behavior...',
        generationType: 'json-object',
      },
    },
    {
      id: 'importId',
      title: 'Import Definition ID',
      type: 'short-input',
      placeholder: 'Numeric import definition ID',
      condition: { field: 'operation', value: 'upload_contact_import_data' },
      required: { field: 'operation', value: 'upload_contact_import_data' },
    },
    {
      id: 'data',
      title: 'Import Data',
      type: 'long-input',
      placeholder: 'JSON array keyed by the definition aliases (maximum 10 MiB)',
      condition: { field: 'operation', value: 'upload_contact_import_data' },
      required: { field: 'operation', value: 'upload_contact_import_data' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of Oracle Eloqua import rows using exactly the field aliases supplied by the user. Return ONLY the paste-ready JSON array with no markdown or explanation.',
        placeholder: 'Describe the rows to upload using the definition aliases...',
        generationType: 'json-array',
      },
    },
    {
      id: 'syncedInstanceUri',
      title: 'Definition URI',
      type: 'short-input',
      placeholder: '/contacts/imports/123 or /contacts/exports/123',
      condition: { field: 'operation', value: 'start_bulk_sync' },
      required: { field: 'operation', value: 'start_bulk_sync' },
    },
    {
      id: 'callbackUrl',
      title: 'Callback URL',
      type: 'short-input',
      placeholder: 'https://example.com/eloqua/callback',
      condition: { field: 'operation', value: 'start_bulk_sync' },
      mode: 'advanced',
    },
    {
      id: 'syncId',
      title: 'Sync ID',
      type: 'short-input',
      placeholder: 'Numeric sync ID',
      condition: {
        field: 'operation',
        value: [
          'get_bulk_sync',
          'get_bulk_sync_data',
          'get_bulk_sync_logs',
          'get_bulk_sync_rejects',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_bulk_sync',
          'get_bulk_sync_data',
          'get_bulk_sync_logs',
          'get_bulk_sync_rejects',
        ],
      },
    },
    {
      id: 'limit',
      title: 'Bulk Page Limit',
      type: 'short-input',
      placeholder: '1-1000 (sync data: up to 50000)',
      condition: { field: 'operation', value: [...BULK_PAGE_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'offset',
      title: 'Bulk Page Offset',
      type: 'short-input',
      placeholder: 'Zero-based offset',
      condition: { field: 'operation', value: [...BULK_PAGE_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'q',
      title: 'Bulk Search',
      type: 'short-input',
      placeholder: 'Bulk API search expression',
      condition: { field: 'operation', value: [...BULK_SEARCH_OPERATIONS] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an Oracle Eloqua Bulk API search expression using only fields and values supplied by the user. Quote string values and keep the expression narrowly scoped. Return ONLY the paste-ready search expression with no markdown or explanation.',
        placeholder: 'Describe which Bulk results to find...',
      },
    },
    {
      id: 'bulkOrderBy',
      title: 'Bulk Order By',
      type: 'short-input',
      placeholder: 'createdAt DESC',
      condition: { field: 'operation', value: [...BULK_SEARCH_OPERATIONS] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an Oracle Eloqua Bulk API orderBy expression such as createdAt DESC using the requested field and direction. Return ONLY the paste-ready orderBy expression with no markdown or explanation.',
        placeholder: 'Describe how to order the Bulk results...',
      },
    },
    {
      id: 'totalResults',
      title: 'Include Total Results',
      type: 'switch',
      condition: { field: 'operation', value: [...BULK_PAGE_OPERATIONS] },
      mode: 'advanced',
    },
  ],
  tools: {
    access: [...ELOQUA_TOOL_IDS],
    config: {
      tool: (params) => {
        const operation = requiredString(params.operation, 'Operation')
        if (!ELOQUA_OPERATIONS.has(operation)) {
          throw new Error(`Unsupported Oracle Eloqua operation: ${operation}`)
        }
        return `eloqua_${operation}`
      },
      params: (params) => {
        const operation = requiredString(params.operation, 'Operation')
        const common = commonParams(params)
        const detail = {
          ...(optionalString(params.depth) && { depth: optionalString(params.depth) }),
        }

        switch (operation) {
          case 'list_contacts':
            return {
              ...common,
              ...applicationListParams(params),
              ...(optionalInteger(params.viewId, 'View ID', { min: 1 }) !== undefined && {
                viewId: optionalInteger(params.viewId, 'View ID', { min: 1 }),
              }),
            }
          case 'list_accounts':
            return {
              ...common,
              ...applicationListParams(params),
              ...(optionalInteger(params.viewId, 'View ID', { min: 1 }) !== undefined && {
                viewId: optionalInteger(params.viewId, 'View ID', { min: 1 }),
              }),
              ...(optionalInteger(params.ownedByUserId, 'Owned by user ID', { min: 1 }) !==
                undefined && {
                ownedByUserId: optionalInteger(params.ownedByUserId, 'Owned by user ID', {
                  min: 1,
                }),
              }),
            }
          case 'list_campaigns':
            return {
              ...common,
              ...applicationListParams(params),
              ...(optionalInteger(params.externalSystemId, 'External system ID', { min: 1 }) !==
                undefined && {
                externalSystemId: optionalInteger(params.externalSystemId, 'External system ID', {
                  min: 1,
                }),
              }),
              ...(parseOptionalBooleanInput(params.includeCrmIdsMapping) !== undefined && {
                includeCrmIdsMapping: parseOptionalBooleanInput(params.includeCrmIdsMapping),
              }),
            }
          case 'list_emails':
          case 'list_forms':
            return {
              ...common,
              ...applicationListParams(params),
              ...(parseOptionalBooleanInput(params.includeAvailable) !== undefined && {
                includeAvailable: parseOptionalBooleanInput(params.includeAvailable),
              }),
              ...(parseOptionalBooleanInput(params.includeArchived) !== undefined && {
                includeArchived: parseOptionalBooleanInput(params.includeArchived),
              }),
            }
          case 'list_contact_lists':
          case 'list_segments':
            return { ...common, ...applicationListParams(params) }
          case 'get_contact':
            return {
              ...common,
              ...detail,
              id: requiredString(params.contactId, 'Contact ID'),
              ...(optionalInteger(params.viewId, 'View ID', { min: 1 }) !== undefined && {
                viewId: optionalInteger(params.viewId, 'View ID', { min: 1 }),
              }),
            }
          case 'get_account':
            return {
              ...common,
              ...detail,
              id: requiredString(params.accountId, 'Account ID'),
              ...(optionalInteger(params.viewId, 'View ID', { min: 1 }) !== undefined && {
                viewId: optionalInteger(params.viewId, 'View ID', { min: 1 }),
              }),
            }
          case 'get_campaign':
            return {
              ...common,
              ...detail,
              id: requiredString(params.campaignId, 'Campaign ID'),
              ...(optionalInteger(params.externalSystemId, 'External system ID', { min: 1 }) !==
                undefined && {
                externalSystemId: optionalInteger(params.externalSystemId, 'External system ID', {
                  min: 1,
                }),
              }),
              ...(parseOptionalBooleanInput(params.includeCrmIdsMapping) !== undefined && {
                includeCrmIdsMapping: parseOptionalBooleanInput(params.includeCrmIdsMapping),
              }),
            }
          case 'get_contact_list':
            return {
              ...common,
              ...detail,
              id: requiredString(params.contactListId, 'Contact list ID'),
            }
          case 'get_segment':
            return {
              ...common,
              ...detail,
              id: requiredString(params.segmentId, 'Segment ID'),
            }
          case 'get_email':
            return {
              ...common,
              ...detail,
              id: requiredString(params.emailId, 'Email ID'),
              ...(parseOptionalBooleanInput(params.preMerge) !== undefined && {
                preMerge: parseOptionalBooleanInput(params.preMerge),
              }),
              ...(parseOptionalBooleanInput(params.noMergeContent) !== undefined && {
                noMergeContent: parseOptionalBooleanInput(params.noMergeContent),
              }),
            }
          case 'get_form':
            return {
              ...common,
              ...detail,
              id: requiredString(params.formId, 'Form ID'),
            }
          case 'create_contact':
          case 'create_account':
            return { ...common, entity: requiredJsonObject(params.entity, 'Entity') }
          case 'update_contact':
            return {
              ...common,
              id: requiredString(params.contactId, 'Contact ID'),
              entity: requiredJsonObject(params.entity, 'Entity'),
            }
          case 'update_account':
            return {
              ...common,
              id: requiredString(params.accountId, 'Account ID'),
              entity: requiredJsonObject(params.entity, 'Entity'),
            }
          case 'activate_campaign':
            return {
              ...common,
              id: requiredString(params.campaignId, 'Campaign ID'),
              ...(optionalCampaignSchedule(params.scheduledFor) && {
                scheduledFor: optionalCampaignSchedule(params.scheduledFor),
              }),
              ...(optionalInteger(params.runAsUserId, 'Run as user ID', { min: 1 }) !==
                undefined && {
                runAsUserId: optionalInteger(params.runAsUserId, 'Run as user ID', { min: 1 }),
              }),
              ...(parseOptionalBooleanInput(params.activateNow) !== undefined && {
                activateNow: parseOptionalBooleanInput(params.activateNow),
              }),
            }
          case 'deactivate_campaign':
            return { ...common, id: requiredString(params.campaignId, 'Campaign ID') }
          case 'create_contact_import':
          case 'create_contact_export':
            return {
              ...common,
              definition: requiredJsonObject(params.definition, 'Bulk definition'),
            }
          case 'upload_contact_import_data':
            return {
              ...common,
              id: requiredString(params.importId, 'Import definition ID'),
              data: requiredJsonObjectArray(params.data, 'Import data'),
            }
          case 'list_contact_fields':
          case 'list_bulk_syncs':
            return { ...common, ...bulkPageParams(params, true, 1_000) }
          case 'start_bulk_sync':
            return {
              ...common,
              syncedInstanceUri: requiredString(params.syncedInstanceUri, 'Definition URI'),
              ...(optionalString(params.callbackUrl) && {
                callbackUrl: optionalString(params.callbackUrl),
              }),
            }
          case 'get_bulk_sync':
            return { ...common, id: requiredString(params.syncId, 'Sync ID') }
          case 'get_bulk_sync_data':
            return {
              ...common,
              id: requiredString(params.syncId, 'Sync ID'),
              ...bulkPageParams(params, false, 50_000),
            }
          case 'get_bulk_sync_logs':
          case 'get_bulk_sync_rejects':
            return {
              ...common,
              id: requiredString(params.syncId, 'Sync ID'),
              ...bulkPageParams(params, true, 1_000),
            }
          default:
            throw new Error(`Unsupported Oracle Eloqua operation: ${operation}`)
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Oracle Eloqua operation to perform' },
    oauthCredential: { type: 'string', description: 'Oracle Eloqua OAuth credential' },
    contactId: { type: 'string', description: 'Contact ID' },
    accountId: { type: 'string', description: 'Account ID' },
    campaignId: { type: 'string', description: 'Campaign ID' },
    contactListId: { type: 'string', description: 'Contact list ID' },
    segmentId: { type: 'string', description: 'Contact segment ID' },
    emailId: { type: 'string', description: 'Email asset ID' },
    formId: { type: 'string', description: 'Form asset ID' },
    entity: { type: 'json', description: 'Contact or account representation' },
    depth: { type: 'string', description: 'Response depth' },
    count: { type: 'number', description: 'Application API page size' },
    page: { type: 'number', description: 'Application API page number' },
    search: { type: 'string', description: 'Application API search expression' },
    orderBy: { type: 'string', description: 'Application API ordering expression' },
    lastUpdatedAt: { type: 'number', description: 'Last-update Unix timestamp' },
    viewId: { type: 'number', description: 'Contact or account view ID' },
    ownedByUserId: { type: 'number', description: 'Account owner user ID' },
    externalSystemId: { type: 'number', description: 'CRM external system ID' },
    includeCrmIdsMapping: { type: 'boolean', description: 'Include CRM ID mappings' },
    includeAvailable: { type: 'boolean', description: 'Include available assets' },
    includeArchived: { type: 'boolean', description: 'Include archived assets' },
    preMerge: { type: 'boolean', description: 'Pre-merge email fields' },
    noMergeContent: { type: 'boolean', description: 'Exclude merged email content' },
    scheduledFor: {
      type: 'string',
      description: 'Campaign activation Unix timestamp or literal now',
    },
    runAsUserId: { type: 'number', description: 'Campaign execution user ID' },
    activateNow: { type: 'boolean', description: 'Activate campaign immediately' },
    definition: { type: 'json', description: 'Bulk import or export definition' },
    importId: { type: 'string', description: 'Bulk import definition ID' },
    data: { type: 'json', description: 'Bulk import rows' },
    syncedInstanceUri: { type: 'string', description: 'Bulk import or export definition URI' },
    callbackUrl: { type: 'string', description: 'Bulk completion callback URL' },
    syncId: { type: 'string', description: 'Bulk synchronization ID' },
    limit: { type: 'number', description: 'Bulk page size' },
    offset: { type: 'number', description: 'Bulk result offset' },
    q: { type: 'string', description: 'Bulk search expression' },
    bulkOrderBy: { type: 'string', description: 'Bulk ordering expression' },
    totalResults: { type: 'boolean', description: 'Include Bulk total result count' },
  },
  outputs: {
    items: {
      type: 'json',
      description:
        'One bounded page of contacts, accounts, marketing assets, contact fields, syncs, sync data, logs, or rejects for the selected operation',
    },
    item: {
      type: 'json',
      description:
        'Typed contact, account, campaign, contact list, segment, email, or form returned by the selected Application API operation',
    },
    page: { type: 'number', description: 'Application API page number' },
    pageSize: { type: 'number', description: 'Application API page size' },
    total: { type: 'number', description: 'Application API total results' },
    type: { type: 'string', description: 'Application API query result type' },
    count: { type: 'number', description: 'Bulk results returned in this page' },
    hasMore: { type: 'boolean', description: 'Whether another Bulk page is available' },
    limit: { type: 'number', description: 'Bulk page size' },
    offset: { type: 'number', description: 'Bulk result offset' },
    totalResults: { type: 'number', description: 'Bulk total matching results when requested' },
    definition: {
      type: 'json',
      description:
        'Created Bulk import or export definition, including its URI and dynamic alias-to-field mapping',
    },
    sync: {
      type: 'json',
      description:
        'Bulk synchronization status, definition URI, callback, and provider timestamps when available',
    },
    accepted: { type: 'boolean', description: 'Whether import data was accepted' },
    success: { type: 'boolean', description: 'Whether the selected operation succeeded' },
  },
}

export const EloquaBlockMeta = {
  tags: ['marketing', 'automation', 'email-marketing', 'forms'],
  url: 'https://www.oracle.com/cx/marketing/automation/',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Eloqua contact intake',
      prompt:
        'Build a workflow that receives a new prospect, searches a bounded page of Oracle Eloqua contacts, creates the contact when no match exists, and records the resulting contact ID.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
      featured: true,
    },
    {
      icon: NetSuiteIcon,
      title: 'Eloqua account enrichment',
      prompt:
        'Create a workflow that finds an Oracle Eloqua account, retrieves its complete representation, applies approved enrichment fields, and updates the complete account without clearing existing values.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'enrichment'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Eloqua campaign launch review',
      prompt:
        'Build an approval workflow that selects an Oracle Eloqua campaign, retrieves its current configuration, summarizes it for review, and activates it only after approval.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
      featured: true,
    },
    {
      icon: NetSuiteIcon,
      title: 'Eloqua asset inventory',
      prompt:
        'Create a scheduled workflow that lists bounded pages of Oracle Eloqua campaigns, segments, emails, and forms and writes the current-page inventory to a Sim table.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'email-marketing', 'forms'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Eloqua contact bulk import',
      prompt:
        'Build a workflow that creates an Oracle Eloqua Bulk contact import definition, uploads one JSON batch under 10 MiB, starts the sync, and retrieves its status, logs, and rejects.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['marketing', 'automation'],
      featured: true,
    },
    {
      icon: NetSuiteIcon,
      title: 'Eloqua contact export',
      prompt:
        'Create a workflow that defines an Oracle Eloqua Bulk contact export with explicit field aliases and a filter, starts the sync, checks completion, and retrieves bounded result pages.',
      modules: ['agent', 'tables', 'workflows'],
      category: 'operations',
      tags: ['marketing', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Eloqua sync failure review',
      prompt:
        'Build a scheduled workflow that lists recent Oracle Eloqua Bulk syncs, retrieves warning or error syncs, reviews bounded log and reject pages, and sends a concise operations alert.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['marketing', 'automation'],
    },
  ],
  skills: [
    {
      name: 'find-eloqua-marketing-asset',
      description: 'Find and retrieve an Eloqua campaign, contact list, segment, email, or form.',
      content:
        '# Find an Eloqua Marketing Asset\n\n## Steps\n\n1. Choose the matching list operation and use a prefix-oriented Eloqua search expression.\n2. Inspect only the returned page and report when more pages may exist.\n3. Use the selected numeric ID with the matching get operation.\n4. Ask the user to choose when multiple assets remain plausible.\n\n## Output\n\nReturn the selected asset ID, name, type, and requested current details.',
    },
    {
      name: 'maintain-eloqua-contact',
      description: 'Create or safely update an Eloqua contact.',
      content:
        '# Maintain an Eloqua Contact\n\n## Steps\n\n1. Search for an existing contact before creating a possible duplicate.\n2. For creation, submit only documented Contact fields and known custom field values.\n3. For update, retrieve the contact at complete depth and preserve the full representation because Eloqua PUT can clear omitted fields.\n4. Submit the update once and do not automatically retry it.\n\n## Output\n\nReturn the provider-reported contact.',
    },
    {
      name: 'maintain-eloqua-account',
      description: 'Create or safely update an Eloqua account.',
      content:
        '# Maintain an Eloqua Account\n\n## Steps\n\n1. Search for an existing account before creating a possible duplicate.\n2. Use documented Account fields and known custom field values.\n3. Before an update, retrieve the complete account and preserve fields that must not be cleared by full-representation PUT.\n4. Submit the mutation once and surface provider validation errors.\n\n## Output\n\nReturn the provider-reported account.',
    },
    {
      name: 'activate-eloqua-campaign',
      description: 'Review and activate or schedule an Eloqua campaign.',
      content:
        '# Activate an Eloqua Campaign\n\n## Steps\n\n1. Select and retrieve the intended campaign.\n2. Confirm the campaign ID and whether activation is immediate or scheduled.\n3. Require approval before activation.\n4. Call Activate Campaign once; do not automatically retry.\n\n## Output\n\nReturn the campaign state reported by Eloqua.',
    },
    {
      name: 'run-eloqua-contact-import',
      description: 'Run the explicit Eloqua Bulk contact import lifecycle.',
      content:
        '# Run an Eloqua Contact Import\n\n## Steps\n\n1. List contact field definitions and establish explicit aliases.\n2. Create a contact import definition with no more than 100 fields.\n3. Upload one JSON batch whose serialized body is at most 10 MiB.\n4. Start a sync unless the definition intentionally triggers it on upload.\n5. Inspect the sync and retrieve bounded logs and rejects.\n\n## Output\n\nReturn definition and sync URIs plus the current status.',
    },
    {
      name: 'run-eloqua-contact-export',
      description: 'Run the explicit Eloqua Bulk contact export lifecycle.',
      content:
        '# Run an Eloqua Contact Export\n\n## Steps\n\n1. Establish explicit field aliases and an optional documented filter.\n2. Create the export definition and keep its returned URI.\n3. Start one sync for that URI.\n4. Inspect status until the surrounding workflow decides to check again; do not auto-poll.\n5. After success or warning, retrieve one bounded data page at a time and inspect logs when needed.\n\n## Output\n\nReturn the current page, pagination metadata, and sync status.',
    },
  ],
} as const satisfies BlockMeta
