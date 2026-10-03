import { SailPointIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import {
  normalizeFileInput,
  parseOptionalJsonInput,
  parseOptionalNumberInput,
} from '@/blocks/utils'

const SAILPOINT_OPERATIONS = [
  'sailpoint_approve_access_request',
  'sailpoint_cancel_access_request',
  'sailpoint_decide_certification_review_items',
  'sailpoint_get_access_profile',
  'sailpoint_get_access_profile_entitlements',
  'sailpoint_get_access_request_config',
  'sailpoint_get_access_request_status',
  'sailpoint_get_account',
  'sailpoint_get_account_activity',
  'sailpoint_get_account_entitlements',
  'sailpoint_get_account_selections',
  'sailpoint_get_campaign',
  'sailpoint_get_certification',
  'sailpoint_get_entitlement',
  'sailpoint_get_entitlement_request_config',
  'sailpoint_get_identity',
  'sailpoint_get_role',
  'sailpoint_get_role_entitlements',
  'sailpoint_get_source',
  'sailpoint_get_task_status',
  'sailpoint_list_access_profiles',
  'sailpoint_list_account_activities',
  'sailpoint_list_accounts',
  'sailpoint_list_campaigns',
  'sailpoint_list_certification_review_items',
  'sailpoint_list_certifications',
  'sailpoint_list_entitlements',
  'sailpoint_list_identities',
  'sailpoint_list_identity_entitlements',
  'sailpoint_list_pending_access_request_approvals',
  'sailpoint_list_roles',
  'sailpoint_list_sources',
  'sailpoint_load_accounts',
  'sailpoint_load_entitlements',
  'sailpoint_reject_access_request',
  'sailpoint_request_access',
  'sailpoint_search',
  'sailpoint_search_aggregate',
  'sailpoint_search_count',
  'sailpoint_sign_off_certification',
] as const

type SailPointOperation = (typeof SAILPOINT_OPERATIONS)[number]

const SAILPOINT_OPERATION_SET: ReadonlySet<string> = new Set(SAILPOINT_OPERATIONS)

const ID_OPERATIONS = [
  'sailpoint_get_identity',
  'sailpoint_get_account',
  'sailpoint_get_account_entitlements',
  'sailpoint_get_entitlement',
  'sailpoint_get_entitlement_request_config',
  'sailpoint_list_identity_entitlements',
  'sailpoint_get_role',
  'sailpoint_get_role_entitlements',
  'sailpoint_get_access_profile',
  'sailpoint_get_access_profile_entitlements',
  'sailpoint_get_source',
  'sailpoint_get_account_activity',
  'sailpoint_get_campaign',
  'sailpoint_get_certification',
  'sailpoint_list_certification_review_items',
  'sailpoint_decide_certification_review_items',
  'sailpoint_sign_off_certification',
  'sailpoint_get_task_status',
]

const SEARCH_OPERATIONS = [
  'sailpoint_search',
  'sailpoint_search_count',
  'sailpoint_search_aggregate',
]

/** List operations that accept `filters` and `sorters`. */
const FILTER_OPERATIONS = [
  'sailpoint_list_identities',
  'sailpoint_list_accounts',
  'sailpoint_list_entitlements',
  'sailpoint_list_roles',
  'sailpoint_list_access_profiles',
  'sailpoint_get_role_entitlements',
  'sailpoint_get_access_profile_entitlements',
  'sailpoint_list_sources',
  'sailpoint_list_account_activities',
  'sailpoint_list_campaigns',
  'sailpoint_list_certifications',
  'sailpoint_list_certification_review_items',
  'sailpoint_get_access_request_status',
  'sailpoint_list_pending_access_request_approvals',
]

/** Operations that accept `limit`/`offset` pagination. */
const LIMIT_OPERATIONS = [
  ...FILTER_OPERATIONS,
  'sailpoint_search',
  'sailpoint_search_aggregate',
  'sailpoint_get_account_entitlements',
  'sailpoint_list_identity_entitlements',
]

const ACCESS_REQUEST_BODY_OPERATIONS = [
  'sailpoint_request_access',
  'sailpoint_get_account_selections',
]

/** Operations that scope by an identity (`requested-for` / `requested-by` / `regarding-identity`). */
const IDENTITY_SCOPE_OPERATIONS = [
  'sailpoint_list_account_activities',
  'sailpoint_get_access_request_status',
]

const LIST_OUTPUT_OPERATIONS = [
  ...FILTER_OPERATIONS,
  'sailpoint_get_account_entitlements',
  'sailpoint_list_identity_entitlements',
]

const ACCEPTED_OUTPUT_OPERATIONS = [
  'sailpoint_request_access',
  'sailpoint_cancel_access_request',
  'sailpoint_approve_access_request',
  'sailpoint_reject_access_request',
]

export const SailPointBlock: BlockConfig = {
  type: 'sailpoint',
  name: 'SailPoint',
  description: 'Govern identities and access in SailPoint Identity Security Cloud',
  longDescription:
    'Connect SailPoint Identity Security Cloud with a Personal Access Token to search identity-governance data, manage access requests and approvals, review certifications, and import source data. The token owner and scopes determine the operations available to the integration.',
  docsLink: 'https://docs.sim.ai/integrations/sailpoint',
  category: 'tools',
  integrationType: IntegrationType.Security,
  bgColor: '#FFFFFF',
  icon: SailPointIcon,
  authMode: AuthMode.ApiKey,
  canvasPresentation: {
    defaultTitle: 'SailPoint',
    sentences: {
      byOperation: {
        sailpoint_search: ['Search SailPoint documents'],
        sailpoint_search_count: ['Count matching SailPoint documents'],
        sailpoint_search_aggregate: ['Aggregate SailPoint search results'],
        sailpoint_list_identities: ['List SailPoint identities'],
        sailpoint_get_identity: ['Read a SailPoint identity'],
        sailpoint_list_accounts: ['List SailPoint accounts'],
        sailpoint_get_account: ['Read a SailPoint account'],
        sailpoint_get_account_entitlements: ['List entitlements on a SailPoint account'],
        sailpoint_get_account_selections: ['Resolve eligible SailPoint accounts for a request'],
        sailpoint_list_entitlements: ['List SailPoint entitlements'],
        sailpoint_get_entitlement: ['Read a SailPoint entitlement'],
        sailpoint_get_entitlement_request_config: [
          'Read SailPoint entitlement request configuration',
        ],
        sailpoint_list_identity_entitlements: ['List entitlements held by an identity'],
        sailpoint_list_roles: ['List SailPoint roles'],
        sailpoint_get_role: ['Read a SailPoint role'],
        sailpoint_get_role_entitlements: ['List entitlements granted by a role'],
        sailpoint_list_access_profiles: ['List SailPoint access profiles'],
        sailpoint_get_access_profile: ['Read a SailPoint access profile'],
        sailpoint_get_access_profile_entitlements: [
          'List entitlements granted by an access profile',
        ],
        sailpoint_get_access_request_config: ['Read SailPoint access-request configuration'],
        sailpoint_list_sources: ['List SailPoint sources'],
        sailpoint_get_source: ['Read a SailPoint source'],
        sailpoint_list_account_activities: ['List SailPoint account activities'],
        sailpoint_get_account_activity: ['Read a SailPoint account activity'],
        sailpoint_list_campaigns: ['List SailPoint campaigns'],
        sailpoint_get_campaign: ['Read a SailPoint campaign'],
        sailpoint_list_certifications: ['List SailPoint certifications'],
        sailpoint_get_certification: ['Read a SailPoint certification'],
        sailpoint_list_certification_review_items: ['List certification review items'],
        sailpoint_decide_certification_review_items: ['Decide certification review items'],
        sailpoint_sign_off_certification: ['Sign off a SailPoint certification'],
        sailpoint_request_access: ['Submit a SailPoint access request'],
        sailpoint_cancel_access_request: ['Cancel a SailPoint access request'],
        sailpoint_get_access_request_status: ['List SailPoint access-request status records'],
        sailpoint_list_pending_access_request_approvals: ['List pending access-request approvals'],
        sailpoint_approve_access_request: ['Approve a SailPoint access request'],
        sailpoint_reject_access_request: ['Reject a SailPoint access request'],
        sailpoint_load_accounts: ['Start a SailPoint account aggregation'],
        sailpoint_load_entitlements: ['Start a SailPoint entitlement aggregation'],
        sailpoint_get_task_status: ['Read a SailPoint task status'],
      },
    },
  },

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Search', id: 'sailpoint_search' },
        { label: 'Search Count', id: 'sailpoint_search_count' },
        { label: 'Search Aggregate', id: 'sailpoint_search_aggregate' },
        { label: 'List Identities', id: 'sailpoint_list_identities' },
        { label: 'Get Identity', id: 'sailpoint_get_identity' },
        { label: 'List Accounts', id: 'sailpoint_list_accounts' },
        { label: 'Get Account', id: 'sailpoint_get_account' },
        { label: 'Get Account Entitlements', id: 'sailpoint_get_account_entitlements' },
        { label: 'Get Account Selections', id: 'sailpoint_get_account_selections' },
        { label: 'List Entitlements', id: 'sailpoint_list_entitlements' },
        { label: 'Get Entitlement', id: 'sailpoint_get_entitlement' },
        {
          label: 'Get Entitlement Request Config',
          id: 'sailpoint_get_entitlement_request_config',
        },
        { label: 'List Identity Entitlements', id: 'sailpoint_list_identity_entitlements' },
        { label: 'List Roles', id: 'sailpoint_list_roles' },
        { label: 'Get Role', id: 'sailpoint_get_role' },
        { label: 'Get Role Entitlements', id: 'sailpoint_get_role_entitlements' },
        { label: 'List Access Profiles', id: 'sailpoint_list_access_profiles' },
        { label: 'Get Access Profile', id: 'sailpoint_get_access_profile' },
        {
          label: 'Get Access Profile Entitlements',
          id: 'sailpoint_get_access_profile_entitlements',
        },
        { label: 'Get Access Request Config', id: 'sailpoint_get_access_request_config' },
        { label: 'List Sources', id: 'sailpoint_list_sources' },
        { label: 'Get Source', id: 'sailpoint_get_source' },
        { label: 'List Account Activities', id: 'sailpoint_list_account_activities' },
        { label: 'Get Account Activity', id: 'sailpoint_get_account_activity' },
        { label: 'List Campaigns', id: 'sailpoint_list_campaigns' },
        { label: 'Get Campaign', id: 'sailpoint_get_campaign' },
        { label: 'List Certifications', id: 'sailpoint_list_certifications' },
        { label: 'Get Certification', id: 'sailpoint_get_certification' },
        {
          label: 'List Certification Review Items',
          id: 'sailpoint_list_certification_review_items',
        },
        {
          label: 'Decide Certification Review Items',
          id: 'sailpoint_decide_certification_review_items',
        },
        { label: 'Sign Off Certification', id: 'sailpoint_sign_off_certification' },
        { label: 'Request Access', id: 'sailpoint_request_access' },
        { label: 'Cancel Access Request', id: 'sailpoint_cancel_access_request' },
        { label: 'Get Access Request Status', id: 'sailpoint_get_access_request_status' },
        {
          label: 'List Pending Access Request Approvals',
          id: 'sailpoint_list_pending_access_request_approvals',
        },
        { label: 'Approve Access Request', id: 'sailpoint_approve_access_request' },
        { label: 'Reject Access Request', id: 'sailpoint_reject_access_request' },
        { label: 'Load Accounts (CSV)', id: 'sailpoint_load_accounts' },
        { label: 'Load Entitlements (CSV)', id: 'sailpoint_load_entitlements' },
        { label: 'Get Task Status', id: 'sailpoint_get_task_status' },
      ],
      value: () => 'sailpoint_search',
      required: true,
    },
    {
      id: 'tenant',
      title: 'Tenant',
      type: 'short-input',
      placeholder: 'acme (subdomain of api.identitynow.com)',
      required: true,
    },
    {
      id: 'clientId',
      title: 'Client ID',
      type: 'short-input',
      placeholder: 'PAT client ID',
      required: true,
    },
    {
      id: 'clientSecret',
      title: 'Client Secret',
      type: 'short-input',
      password: true,
      placeholder: 'PAT client secret',
      required: true,
    },
    {
      id: 'apiVersion',
      title: 'Legacy API Version',
      type: 'short-input',
      condition: { field: 'operation', value: '__removed_api_version__' },
      mode: 'advanced',
    },
    {
      id: 'id',
      title: 'ID',
      type: 'short-input',
      placeholder: 'Resource ID',
      condition: { field: 'operation', value: ID_OPERATIONS },
      required: { field: 'operation', value: ID_OPERATIONS },
    },
    {
      id: 'indices',
      title: 'Indices',
      type: 'code',
      language: 'json',
      placeholder: '["identities", "roles"]',
      condition: { field: 'operation', value: SEARCH_OPERATIONS },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array containing only SailPoint search indices: accessprofiles, accountactivities, entitlements, events, identities, roles, or *. Omit the field to search all indices. Return ONLY the JSON array - no explanations, no extra text.',
        placeholder: 'Describe which SailPoint indices to search...',
      },
    },
    {
      id: 'queryType',
      title: 'Query Type',
      type: 'dropdown',
      options: [
        { label: 'No query (Search Aggregate only)', id: '' },
        { label: 'SailPoint query', id: 'SAILPOINT' },
        { label: 'Elasticsearch DSL', id: 'DSL' },
        { label: 'Text query', id: 'TEXT' },
        { label: 'Type-ahead query', id: 'TYPEAHEAD' },
      ],
      value: (params) => (params.operation === 'sailpoint_search_aggregate' ? '' : 'SAILPOINT'),
      condition: { field: 'operation', value: SEARCH_OPERATIONS },
      required: {
        field: 'operation',
        value: ['sailpoint_search', 'sailpoint_search_count'],
      },
    },
    {
      id: 'query',
      title: 'Query',
      type: 'code',
      language: 'json',
      placeholder:
        '{ "query": "attributes.department:Engineering", "fields": "name,email", "timeZone": "America/Los_Angeles" }',
      condition: {
        field: 'operation',
        value: SEARCH_OPERATIONS,
        and: { field: 'queryType', value: 'SAILPOINT' },
      },
      required: { field: 'queryType', value: 'SAILPOINT' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a SailPoint search query object with query and optional fields, timeZone, and innerHit. The query value uses SailPoint Elasticsearch query-string syntax. Return ONLY the JSON object - no explanations, no extra text.',
        placeholder:
          'Describe what to search for, e.g. "active identities in the Finance department"...',
        generationType: 'json-object',
      },
    },
    {
      id: 'queryDsl',
      title: 'Query DSL',
      type: 'code',
      language: 'json',
      placeholder: '{ "match": { "name": "john.doe" } }',
      condition: {
        field: 'operation',
        value: SEARCH_OPERATIONS,
        and: { field: 'queryType', value: 'DSL' },
      },
      required: { field: 'queryType', value: 'DSL' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an Elasticsearch Query DSL object supported by SailPoint Search. Return ONLY the JSON object - no explanations, no extra text.',
        placeholder: 'Describe the Elasticsearch DSL query...',
        generationType: 'json-object',
      },
    },
    {
      id: 'textQuery',
      title: 'Text Query',
      type: 'code',
      language: 'json',
      placeholder:
        '{ "terms": ["privileged access"], "fields": ["name", "description"], "matchAny": true, "contains": true }',
      condition: {
        field: 'operation',
        value: SEARCH_OPERATIONS,
        and: { field: 'queryType', value: 'TEXT' },
      },
      required: { field: 'queryType', value: 'TEXT' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a SailPoint textQuery object with required string arrays terms and fields and optional booleans matchAny and contains. Return ONLY the JSON object - no explanations, no extra text.',
        placeholder: 'Describe the terms and fields for the text query...',
        generationType: 'json-object',
      },
    },
    {
      id: 'typeAheadQuery',
      title: 'Type-Ahead Query',
      type: 'code',
      language: 'json',
      placeholder:
        '{ "query": "Work", "field": "source.name", "nestedType": "access", "maxExpansions": 10, "size": 100 }',
      condition: {
        field: 'operation',
        value: SEARCH_OPERATIONS,
        and: { field: 'queryType', value: 'TYPEAHEAD' },
      },
      required: { field: 'queryType', value: 'TYPEAHEAD' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a SailPoint typeAheadQuery object with required query and field and optional nestedType, maxExpansions, size, sort, and sortByValue. Return ONLY the JSON object - no explanations, no extra text.',
        placeholder: 'Describe the prefix and field to search...',
        generationType: 'json-object',
      },
    },
    {
      id: 'queryVersion',
      title: 'Query Version',
      type: 'short-input',
      placeholder: '5.2 (omit to use the service default)',
      condition: { field: 'operation', value: SEARCH_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'includeNested',
      title: 'Include Nested Objects',
      type: 'dropdown',
      options: [
        { label: 'Provider default (true)', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: SEARCH_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'queryResultFilter',
      title: 'Result Field Filter',
      type: 'code',
      language: 'json',
      placeholder: '{ "includes": ["id", "name"], "excludes": ["stacktrace"] }',
      condition: { field: 'operation', value: SEARCH_OPERATIONS },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a SailPoint queryResultFilter object with optional includes and excludes string arrays. Return ONLY the JSON object - no explanations, no extra text.',
        placeholder: 'Describe which fields to include or exclude...',
        generationType: 'json-object',
      },
    },
    {
      id: 'searchFilters',
      title: 'Structured Search Filters',
      type: 'code',
      language: 'json',
      placeholder: '{ "attributes.department": { "type": "TERMS", "terms": ["Finance"] } }',
      condition: { field: 'operation', value: SEARCH_OPERATIONS },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate the SailPoint Search filters object keyed by searchable field, with each value using a documented filter structure. Return ONLY the JSON object - no explanations, no extra text.',
        placeholder: 'Describe the structured filters...',
        generationType: 'json-object',
      },
    },
    {
      id: 'sort',
      title: 'Sort',
      type: 'code',
      language: 'json',
      placeholder: '["displayName", "+id"]',
      condition: { field: 'operation', value: SEARCH_OPERATIONS },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of SailPoint Search sort fields. Prefix a field with + for ascending or - for descending. Return ONLY the JSON array - no explanations, no extra text.',
        placeholder: 'Describe the desired sort order...',
      },
    },
    {
      id: 'searchAfter',
      title: 'Search After',
      type: 'code',
      language: 'json',
      placeholder: '["John Doe", "2c9180...id"]',
      condition: { field: 'operation', value: SEARCH_OPERATIONS },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate the JSON string array of last sort values used as a SailPoint Search searchAfter cursor. Return ONLY the JSON array - no explanations, no extra text.',
        placeholder: 'Provide the last values from the previous sorted result...',
      },
    },
    {
      id: 'aggregationType',
      title: 'Aggregation Type',
      type: 'dropdown',
      options: [
        { label: 'Elasticsearch DSL (default)', id: 'DSL' },
        { label: 'SailPoint aggregation', id: 'SAILPOINT' },
      ],
      value: () => 'DSL',
      condition: { field: 'operation', value: SEARCH_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'aggregationsVersion',
      title: 'Aggregations Version',
      type: 'short-input',
      placeholder: '5.2 (omit to use the service default)',
      condition: { field: 'operation', value: SEARCH_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'aggregationsDsl',
      title: 'Aggregations DSL',
      type: 'code',
      language: 'json',
      placeholder: '{ "department": { "terms": { "field": "attributes.department" } } }',
      condition: {
        field: 'operation',
        value: SEARCH_OPERATIONS,
        and: { field: 'aggregationType', value: 'DSL' },
      },
      required: {
        field: 'operation',
        value: 'sailpoint_search_aggregate',
        and: { field: 'aggregationType', value: 'DSL' },
      },
      mode: 'basic',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an Elasticsearch aggregations DSL object supported by SailPoint Search. Return ONLY the JSON object - no explanations, no extra text.',
        placeholder: 'Describe the aggregation, e.g. "count identities grouped by department"...',
        generationType: 'json-object',
      },
    },
    {
      id: 'aggregations',
      title: 'SailPoint Aggregation',
      type: 'code',
      language: 'json',
      placeholder: '{ "name": "department", "type": "TERMS", "field": "attributes.department" }',
      condition: {
        field: 'operation',
        value: SEARCH_OPERATIONS,
        and: { field: 'aggregationType', value: 'SAILPOINT' },
      },
      required: {
        field: 'operation',
        value: 'sailpoint_search_aggregate',
        and: { field: 'aggregationType', value: 'SAILPOINT' },
      },
      mode: 'basic',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a SailPoint search aggregation specification object, including any supported subAggregation. Return ONLY the JSON object - no explanations, no extra text.',
        placeholder: 'Describe the SailPoint aggregation grouping or calculation...',
        generationType: 'json-object',
      },
    },
    {
      id: 'filters',
      title: 'Filters',
      type: 'short-input',
      placeholder: 'name sw "A" and cloudStatus eq "ACTIVE"',
      condition: { field: 'operation', value: FILTER_OPERATIONS },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a SailPoint collection filter expression (e.g. name sw "A", cloudStatus eq "ACTIVE", and/or). Use only fields and operators supported by the selected operation. Return ONLY the filter string - no explanations, no extra text.',
        placeholder:
          'Describe the records to filter, e.g. "identities whose email ends with @acme.com"...',
      },
    },
    {
      id: 'sorters',
      title: 'Sorters',
      type: 'short-input',
      placeholder: 'name,-created',
      condition: { field: 'operation', value: FILTER_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '250',
      condition: { field: 'operation', value: LIMIT_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: LIMIT_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'count',
      title: 'Include Total Count',
      type: 'dropdown',
      options: [
        { label: 'No (default)', id: '' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => '',
      condition: { field: 'operation', value: LIMIT_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'defaultFilter',
      title: 'Default Filter',
      type: 'dropdown',
      options: [
        { label: 'Correlated only (default)', id: '' },
        { label: 'All identities', id: 'NONE' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'sailpoint_list_identities' },
      mode: 'advanced',
    },
    {
      id: 'detailLevel',
      title: 'Detail Level',
      type: 'dropdown',
      options: [
        { label: 'Full (default)', id: '' },
        { label: 'Slim', id: 'SLIM' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'sailpoint_list_accounts' },
      mode: 'advanced',
    },
    {
      id: 'detail',
      title: 'Detail',
      type: 'dropdown',
      options: [
        { label: 'Slim (default)', id: '' },
        { label: 'Full', id: 'FULL' },
      ],
      value: () => '',
      condition: {
        field: 'operation',
        value: ['sailpoint_list_campaigns', 'sailpoint_get_campaign'],
      },
      mode: 'advanced',
    },
    {
      id: 'accountId',
      title: 'Legacy Account ID',
      type: 'short-input',
      condition: { field: 'operation', value: '__removed_account_filter__' },
      mode: 'advanced',
    },
    {
      id: 'entitlementSegmentationMode',
      title: 'Entitlement Segmentation',
      type: 'dropdown',
      options: [
        { label: 'No segmentation filter', id: '' },
        { label: 'Visible to an identity', id: 'identity' },
        { label: 'Assigned to segment IDs', id: 'segments' },
        { label: 'Visible to an identity and assigned to segment IDs', id: 'identityAndSegments' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'sailpoint_list_entitlements' },
      mode: 'advanced',
    },
    {
      id: 'segmentedForIdentity',
      title: 'Segmented For Identity',
      type: 'short-input',
      placeholder: 'Identity ID to apply entitlement segmentation for',
      condition: {
        field: 'operation',
        value: 'sailpoint_list_entitlements',
        and: {
          field: 'entitlementSegmentationMode',
          value: ['identity', 'identityAndSegments'],
        },
      },
      mode: 'advanced',
    },
    {
      id: 'entitlementForSegmentIds',
      title: 'For Segment IDs',
      type: 'short-input',
      placeholder: 'Comma-separated segment IDs',
      condition: {
        field: 'operation',
        value: 'sailpoint_list_entitlements',
        and: {
          field: 'entitlementSegmentationMode',
          value: ['segments', 'identityAndSegments'],
        },
      },
      mode: 'advanced',
    },
    {
      id: 'entitlementIncludeUnsegmented',
      title: 'Include Unsegmented',
      type: 'dropdown',
      options: [
        { label: 'Provider default (true)', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: {
        field: 'operation',
        value: 'sailpoint_list_entitlements',
        and: {
          field: 'entitlementSegmentationMode',
          value: ['identity', 'segments', 'identityAndSegments'],
        },
      },
      mode: 'advanced',
    },
    {
      id: 'accessModelSegmentationMode',
      title: 'Access Model Segmentation',
      type: 'dropdown',
      options: [
        { label: 'No segmentation filter', id: '' },
        { label: 'Assigned to segment IDs', id: 'segments' },
      ],
      value: () => '',
      condition: {
        field: 'operation',
        value: ['sailpoint_list_roles', 'sailpoint_list_access_profiles'],
      },
      mode: 'advanced',
    },
    {
      id: 'forSegmentIds',
      title: 'For Segment IDs',
      type: 'short-input',
      placeholder: 'Comma-separated segment IDs',
      condition: {
        field: 'operation',
        value: ['sailpoint_list_roles', 'sailpoint_list_access_profiles'],
        and: { field: 'accessModelSegmentationMode', value: 'segments' },
      },
      mode: 'advanced',
    },
    {
      id: 'includeUnsegmented',
      title: 'Include Unsegmented',
      type: 'dropdown',
      options: [
        { label: 'Provider default (true)', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: {
        field: 'operation',
        value: ['sailpoint_list_roles', 'sailpoint_list_access_profiles'],
        and: { field: 'accessModelSegmentationMode', value: 'segments' },
      },
      mode: 'advanced',
    },
    {
      id: 'entitlementSearchAfter',
      title: 'Search After',
      type: 'short-input',
      placeholder: 'Account Payable,2c918083... (must match sorters)',
      condition: { field: 'operation', value: 'sailpoint_list_entitlements' },
      mode: 'advanced',
    },
    {
      id: 'forSubadmin',
      title: 'For Subadmin',
      type: 'short-input',
      placeholder: 'Subadmin identity ID or me',
      condition: {
        field: 'operation',
        value: ['sailpoint_list_sources', 'sailpoint_list_roles', 'sailpoint_list_access_profiles'],
      },
      mode: 'advanced',
    },
    {
      id: 'includeIDNSource',
      title: 'Include IDN Source',
      type: 'dropdown',
      options: [
        { label: 'No (default)', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'sailpoint_list_sources' },
      mode: 'advanced',
    },
    {
      id: 'identityScopeType',
      title: 'Identity Scope',
      type: 'dropdown',
      options: [
        { label: 'No identity scope', id: '' },
        { label: 'Requested for', id: 'requestedFor' },
        { label: 'Requested by', id: 'requestedBy' },
        { label: 'Requester or target', id: 'regardingIdentity' },
      ],
      value: () => '',
      condition: { field: 'operation', value: IDENTITY_SCOPE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'requestedForFilter',
      title: 'Requested For',
      type: 'short-input',
      placeholder: 'Identity ID or "me"',
      condition: {
        field: 'operation',
        value: IDENTITY_SCOPE_OPERATIONS,
        and: { field: 'identityScopeType', value: 'requestedFor' },
      },
      mode: 'advanced',
    },
    {
      id: 'requestedBy',
      title: 'Requested By',
      type: 'short-input',
      placeholder: 'Identity ID or "me"',
      condition: {
        field: 'operation',
        value: IDENTITY_SCOPE_OPERATIONS,
        and: { field: 'identityScopeType', value: 'requestedBy' },
      },
      mode: 'advanced',
    },
    {
      id: 'regardingIdentity',
      title: 'Regarding Identity',
      type: 'short-input',
      placeholder: 'Identity ID (requester or target)',
      condition: {
        field: 'operation',
        value: IDENTITY_SCOPE_OPERATIONS,
        and: { field: 'identityScopeType', value: 'regardingIdentity' },
      },
      mode: 'advanced',
    },
    {
      id: 'assignedTo',
      title: 'Assigned To',
      type: 'short-input',
      placeholder: 'Work item owner identity ID',
      condition: { field: 'operation', value: 'sailpoint_get_access_request_status' },
      mode: 'advanced',
    },
    {
      id: 'requestState',
      title: 'Request State',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Executing', id: 'EXECUTING' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'sailpoint_get_access_request_status' },
      mode: 'advanced',
    },
    {
      id: 'reviewerIdentity',
      title: 'Reviewer Identity',
      type: 'short-input',
      placeholder: 'Reviewer identity ID or "me"',
      condition: { field: 'operation', value: 'sailpoint_list_certifications' },
    },
    {
      id: 'reviewItemFilterType',
      title: 'Review Item Type Filter',
      type: 'dropdown',
      options: [
        { label: 'All review items', id: '' },
        { label: 'Entitlements', id: 'entitlements' },
        { label: 'Access profiles', id: 'accessProfiles' },
        { label: 'Roles', id: 'roles' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'sailpoint_list_certification_review_items' },
      mode: 'advanced',
    },
    {
      id: 'entitlements',
      title: 'Entitlement IDs',
      type: 'short-input',
      placeholder: 'Comma-separated entitlement IDs to filter by',
      condition: {
        field: 'operation',
        value: 'sailpoint_list_certification_review_items',
        and: { field: 'reviewItemFilterType', value: 'entitlements' },
      },
      mode: 'advanced',
    },
    {
      id: 'accessProfiles',
      title: 'Access Profile IDs',
      type: 'short-input',
      placeholder: 'Comma-separated access profile IDs to filter by',
      condition: {
        field: 'operation',
        value: 'sailpoint_list_certification_review_items',
        and: { field: 'reviewItemFilterType', value: 'accessProfiles' },
      },
      mode: 'advanced',
    },
    {
      id: 'roles',
      title: 'Role IDs',
      type: 'short-input',
      placeholder: 'Comma-separated role IDs to filter by',
      condition: {
        field: 'operation',
        value: 'sailpoint_list_certification_review_items',
        and: { field: 'reviewItemFilterType', value: 'roles' },
      },
      mode: 'advanced',
    },
    {
      id: 'decisions',
      title: 'Review Decisions',
      type: 'code',
      language: 'json',
      placeholder:
        '[{ "id": "review-item-id", "decision": "APPROVE", "bulk": false, "comments": "Access is still required" }]',
      condition: {
        field: 'operation',
        value: 'sailpoint_decide_certification_review_items',
      },
      required: {
        field: 'operation',
        value: 'sailpoint_decide_certification_review_items',
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of 1 to 250 SailPoint certification review decisions. Each decision requires id, decision (APPROVE or REVOKE), and bulk; optional fields are proposedEndDate, recommendation, and comments. Return ONLY the JSON array - no explanations, no extra text.',
        placeholder: 'Describe the review-item decisions to record...',
      },
    },
    {
      id: 'requestPayloadShape',
      title: 'Recipient and Item Shape',
      type: 'dropdown',
      options: [
        { label: 'Human identities (flat)', id: 'flat' },
        { label: 'Per-identity items or machine identities', id: 'structured' },
      ],
      value: () => 'flat',
      condition: { field: 'operation', value: ACCESS_REQUEST_BODY_OPERATIONS },
    },
    {
      id: 'requestedIdentities',
      title: 'Requested For (Identities)',
      type: 'code',
      language: 'json',
      placeholder: '["2c9180857c1a...","2c9180857c1b..."]',
      condition: {
        field: 'operation',
        value: ACCESS_REQUEST_BODY_OPERATIONS,
        and: { field: 'requestPayloadShape', value: 'flat' },
      },
      required: {
        field: 'operation',
        value: ACCESS_REQUEST_BODY_OPERATIONS,
        and: { field: 'requestPayloadShape', value: 'flat' },
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of SailPoint human identity IDs. REVOKE_ACCESS permits exactly one human identity. Return ONLY the JSON array - no explanations, no extra text.',
        placeholder: 'Describe or provide the human identity IDs...',
      },
    },
    {
      id: 'requestedItems',
      title: 'Requested Items',
      type: 'code',
      language: 'json',
      placeholder: '[{ "type": "ENTITLEMENT", "id": "2c918...", "comment": "New hire" }]',
      condition: {
        field: 'operation',
        value: ACCESS_REQUEST_BODY_OPERATIONS,
        and: { field: 'requestPayloadShape', value: 'flat' },
      },
      required: {
        field: 'operation',
        value: ACCESS_REQUEST_BODY_OPERATIONS,
        and: { field: 'requestPayloadShape', value: 'flat' },
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of SailPoint human access-request items. Each item requires type (ACCESS_PROFILE, ROLE, or ENTITLEMENT) and id; optional fields are comment, startDate, removeDate, assignmentId, nativeIdentity, formInstanceId, and clientMetadata. REVOKE_ACCESS requires a comment, forbids startDate, and permits only one item when revoking an entitlement; role and access-profile revocations are not subject to that entitlement-only limit. Return ONLY the JSON array - no explanations, no extra text.',
        placeholder: 'Describe the access to request or revoke...',
      },
    },
    {
      id: 'requestedForWithRequestedItems',
      title: 'Recipients With Requested Items',
      type: 'code',
      language: 'json',
      placeholder:
        '[{ "identityId": "2c918...", "identityType": "HUMAN", "requestedItems": [{ "type": "ENTITLEMENT", "id": "2c918...", "accountSelection": [] }] }]',
      condition: {
        field: 'operation',
        value: ACCESS_REQUEST_BODY_OPERATIONS,
        and: { field: 'requestPayloadShape', value: 'structured' },
      },
      required: {
        field: 'operation',
        value: ACCESS_REQUEST_BODY_OPERATIONS,
        and: { field: 'requestPayloadShape', value: 'structured' },
      },
      wandConfig: {
        enabled: true,
        prompt:
          "Generate the requestedForWithRequestedItems JSON array for SailPoint. Each entry requires identityId and requestedItems and may set identityType HUMAN or MACHINE. Machine requests must use MACHINE for every entry and support ENTITLEMENT items only. For Request Access, machine grants or modifications require the exact accountSelection returned by Get Account Selections; omit accountSelection when running Get Account Selections itself. Machine revokes omit accountSelection and normally include nativeIdentity; nativeIdentity may be omitted only when SailPoint can auto-resolve the machine's sole account on the entitlement source. Human revoke requests must use the flat payload instead. Items may include comment, startDate, removeDate, accountSelection, nativeIdentity, formInstanceId, and clientMetadata where supported. Return ONLY the JSON array - no explanations, no extra text.",
        placeholder: 'Describe recipients, items, and account selections...',
      },
    },
    {
      id: 'requestType',
      title: 'Request Type',
      type: 'dropdown',
      options: [
        { label: 'Grant Access (default)', id: 'GRANT_ACCESS' },
        { label: 'Revoke Access', id: 'REVOKE_ACCESS' },
        { label: 'Modify Access', id: 'MODIFY_ACCESS' },
      ],
      value: () => 'GRANT_ACCESS',
      condition: { field: 'operation', value: ACCESS_REQUEST_BODY_OPERATIONS },
    },
    {
      id: 'clientMetadata',
      title: 'Client Metadata',
      type: 'code',
      language: 'json',
      placeholder: '{ "requestedByEmail": "manager@acme.com" }',
      condition: { field: 'operation', value: ACCESS_REQUEST_BODY_OPERATIONS },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object whose values are strings for correlating a SailPoint access request with external context. Return ONLY the JSON object - no explanations, no extra text.',
        placeholder: 'Describe the correlation metadata to attach...',
        generationType: 'json-object',
      },
    },
    {
      id: 'accountActivityId',
      title: 'Account Activity ID',
      type: 'short-input',
      placeholder: 'identityRequestId of the request to cancel',
      condition: { field: 'operation', value: 'sailpoint_cancel_access_request' },
      required: { field: 'operation', value: 'sailpoint_cancel_access_request' },
    },
    {
      id: 'comment',
      title: 'Comment',
      type: 'long-input',
      placeholder: 'Reason for cancellation',
      condition: { field: 'operation', value: 'sailpoint_cancel_access_request' },
      required: { field: 'operation', value: 'sailpoint_cancel_access_request' },
    },
    {
      id: 'ownerId',
      title: 'Approval Owner',
      type: 'short-input',
      placeholder: 'Approver identity ID or me; omit for all visible approvals',
      condition: {
        field: 'operation',
        value: 'sailpoint_list_pending_access_request_approvals',
      },
    },
    {
      id: 'approvalId',
      title: 'Approval ID',
      type: 'short-input',
      placeholder: 'Pending access-request approval ID',
      condition: {
        field: 'operation',
        value: ['sailpoint_approve_access_request', 'sailpoint_reject_access_request'],
      },
      required: {
        field: 'operation',
        value: ['sailpoint_approve_access_request', 'sailpoint_reject_access_request'],
      },
    },
    {
      id: 'approvalComment',
      title: 'Approval Comment',
      type: 'long-input',
      placeholder: 'Reason for the approval decision',
      condition: {
        field: 'operation',
        value: ['sailpoint_approve_access_request', 'sailpoint_reject_access_request'],
      },
      required: { field: 'operation', value: 'sailpoint_reject_access_request' },
    },
    {
      id: 'sourceId',
      title: 'Source ID',
      type: 'short-input',
      placeholder: 'Source ID to aggregate',
      condition: {
        field: 'operation',
        value: ['sailpoint_load_accounts', 'sailpoint_load_entitlements'],
      },
      required: {
        field: 'operation',
        value: ['sailpoint_load_accounts', 'sailpoint_load_entitlements'],
      },
    },
    {
      id: 'accountsFileUpload',
      title: 'Accounts CSV',
      type: 'file-upload',
      canonicalParamId: 'accountsCsv',
      placeholder: 'Upload the accounts CSV to aggregate',
      condition: { field: 'operation', value: 'sailpoint_load_accounts' },
      mode: 'basic',
      multiple: false,
      required: false,
    },
    {
      id: 'accountsFileRef',
      title: 'Accounts CSV',
      type: 'short-input',
      canonicalParamId: 'accountsCsv',
      placeholder: 'Reference a file from a previous block',
      condition: { field: 'operation', value: 'sailpoint_load_accounts' },
      mode: 'advanced',
      required: false,
    },
    {
      id: 'disableOptimization',
      title: 'Disable Optimization',
      type: 'dropdown',
      options: [
        { label: 'No (default)', id: 'false' },
        { label: 'Yes - reprocess every account', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'sailpoint_load_accounts' },
      mode: 'advanced',
    },
    {
      id: 'entitlementsFileUpload',
      title: 'Entitlements CSV',
      type: 'file-upload',
      canonicalParamId: 'entitlementsCsv',
      placeholder: 'Upload the entitlements CSV to aggregate',
      condition: { field: 'operation', value: 'sailpoint_load_entitlements' },
      mode: 'basic',
      multiple: false,
      required: false,
    },
    {
      id: 'entitlementsFileRef',
      title: 'Entitlements CSV',
      type: 'short-input',
      canonicalParamId: 'entitlementsCsv',
      placeholder: 'Reference a file from a previous block',
      condition: { field: 'operation', value: 'sailpoint_load_entitlements' },
      mode: 'advanced',
      required: false,
    },
  ],

  tools: {
    access: [
      'sailpoint_approve_access_request',
      'sailpoint_cancel_access_request',
      'sailpoint_decide_certification_review_items',
      'sailpoint_get_access_profile',
      'sailpoint_get_access_profile_entitlements',
      'sailpoint_get_access_request_config',
      'sailpoint_get_access_request_status',
      'sailpoint_get_account',
      'sailpoint_get_account_activity',
      'sailpoint_get_account_entitlements',
      'sailpoint_get_account_selections',
      'sailpoint_get_campaign',
      'sailpoint_get_certification',
      'sailpoint_get_entitlement',
      'sailpoint_get_entitlement_request_config',
      'sailpoint_get_identity',
      'sailpoint_get_role',
      'sailpoint_get_role_entitlements',
      'sailpoint_get_source',
      'sailpoint_get_task_status',
      'sailpoint_list_access_profiles',
      'sailpoint_list_account_activities',
      'sailpoint_list_accounts',
      'sailpoint_list_campaigns',
      'sailpoint_list_certification_review_items',
      'sailpoint_list_certifications',
      'sailpoint_list_entitlements',
      'sailpoint_list_identities',
      'sailpoint_list_identity_entitlements',
      'sailpoint_list_pending_access_request_approvals',
      'sailpoint_list_roles',
      'sailpoint_list_sources',
      'sailpoint_load_accounts',
      'sailpoint_load_entitlements',
      'sailpoint_reject_access_request',
      'sailpoint_request_access',
      'sailpoint_search',
      'sailpoint_search_aggregate',
      'sailpoint_search_count',
      'sailpoint_sign_off_certification',
    ],
    config: {
      tool: (params) => {
        const operation = typeof params.operation === 'string' ? params.operation : ''
        return SAILPOINT_OPERATION_SET.has(operation)
          ? (operation as SailPointOperation)
          : 'sailpoint_search'
      },
      params: (params) => {
        const mapped: Record<string, unknown> = {
          clientId: params.clientId,
          clientSecret: params.clientSecret,
          tenant: params.tenant,
        }

        const setStr = (key: string, value: unknown) => {
          if (typeof value === 'string') {
            const trimmed = value.trim()
            if (trimmed) mapped[key] = trimmed
          } else if (value !== undefined && value !== null) {
            mapped[key] = value
          }
        }
        const setNum = (key: string, value: unknown) => {
          const parsed = parseOptionalNumberInput(value, key, { integer: true, min: 0 })
          if (parsed != null) mapped[key] = parsed
        }
        const setBoolean = (key: string, value: unknown) => {
          if (value === 'true' || value === true) mapped[key] = true
          if (value === 'false' || value === false) mapped[key] = false
        }
        const setJson = (key: string, value: unknown, label = key) => {
          const parsed = parseOptionalJsonInput(value, label)
          if (parsed !== undefined) mapped[key] = parsed
        }
        const applyPagination = () => {
          setNum('limit', params.limit)
          setNum('offset', params.offset)
          setBoolean('count', params.count)
        }
        const applyFilters = () => {
          setStr('filters', params.filters)
          setStr('sorters', params.sorters)
        }
        const applyIdentityScope = () => {
          switch (params.identityScopeType) {
            case 'requestedFor':
              setStr('requestedFor', params.requestedForFilter)
              break
            case 'requestedBy':
              setStr('requestedBy', params.requestedBy)
              break
            case 'regardingIdentity':
              setStr('regardingIdentity', params.regardingIdentity)
              break
          }
        }
        const applySearchBody = () => {
          setJson('indices', params.indices)
          setStr('queryType', params.queryType)
          setStr('queryVersion', params.queryVersion)
          setJson('query', params.query)
          setJson('queryDsl', params.queryDsl)
          setJson('textQuery', params.textQuery)
          setJson('typeAheadQuery', params.typeAheadQuery)
          setBoolean('includeNested', params.includeNested)
          setJson('queryResultFilter', params.queryResultFilter)
          setStr('aggregationType', params.aggregationType)
          setStr('aggregationsVersion', params.aggregationsVersion)
          setJson('aggregationsDsl', params.aggregationsDsl)
          setJson('aggregations', params.aggregations)
          setJson('sort', params.sort)
          setJson('searchAfter', params.searchAfter)
          setJson('filters', params.searchFilters, 'searchFilters')
        }

        switch (params.operation) {
          case 'sailpoint_search':
            applySearchBody()
            applyPagination()
            break
          case 'sailpoint_search_count':
            applySearchBody()
            break
          case 'sailpoint_search_aggregate':
            applySearchBody()
            applyPagination()
            break
          case 'sailpoint_list_identities':
            applyFilters()
            setStr('defaultFilter', params.defaultFilter)
            applyPagination()
            break
          case 'sailpoint_list_accounts':
            applyFilters()
            setStr('detailLevel', params.detailLevel)
            applyPagination()
            break
          case 'sailpoint_list_entitlements':
            applyFilters()
            if (
              params.entitlementSegmentationMode === 'identity' ||
              params.entitlementSegmentationMode === 'identityAndSegments'
            ) {
              setStr('segmentedForIdentity', params.segmentedForIdentity)
            }
            if (
              params.entitlementSegmentationMode === 'segments' ||
              params.entitlementSegmentationMode === 'identityAndSegments'
            ) {
              setStr('forSegmentIds', params.entitlementForSegmentIds)
            }
            if (
              params.entitlementSegmentationMode === 'identity' ||
              params.entitlementSegmentationMode === 'segments' ||
              params.entitlementSegmentationMode === 'identityAndSegments'
            ) {
              setBoolean('includeUnsegmented', params.entitlementIncludeUnsegmented)
            }
            setStr('searchAfter', params.entitlementSearchAfter)
            applyPagination()
            break
          case 'sailpoint_list_roles':
          case 'sailpoint_list_access_profiles':
            applyFilters()
            setStr('forSubadmin', params.forSubadmin)
            if (params.accessModelSegmentationMode === 'segments') {
              setStr('forSegmentIds', params.forSegmentIds)
              setBoolean('includeUnsegmented', params.includeUnsegmented)
            }
            applyPagination()
            break
          case 'sailpoint_get_role_entitlements':
          case 'sailpoint_get_access_profile_entitlements':
            setStr('id', params.id)
            applyFilters()
            applyPagination()
            break
          case 'sailpoint_get_account_entitlements':
          case 'sailpoint_list_identity_entitlements':
            setStr('id', params.id)
            applyPagination()
            break
          case 'sailpoint_list_sources':
            applyFilters()
            setStr('forSubadmin', params.forSubadmin)
            setBoolean('includeIDNSource', params.includeIDNSource)
            applyPagination()
            break
          case 'sailpoint_list_account_activities':
            applyIdentityScope()
            applyFilters()
            applyPagination()
            break
          case 'sailpoint_list_campaigns':
            setStr('detail', params.detail)
            applyFilters()
            applyPagination()
            break
          case 'sailpoint_get_campaign':
            setStr('id', params.id)
            setStr('detail', params.detail)
            break
          case 'sailpoint_list_certifications':
            setStr('reviewerIdentity', params.reviewerIdentity)
            applyFilters()
            applyPagination()
            break
          case 'sailpoint_list_certification_review_items':
            setStr('id', params.id)
            applyFilters()
            if (params.reviewItemFilterType === 'entitlements') {
              setStr('entitlements', params.entitlements)
            }
            if (params.reviewItemFilterType === 'accessProfiles') {
              setStr('accessProfiles', params.accessProfiles)
            }
            if (params.reviewItemFilterType === 'roles') setStr('roles', params.roles)
            applyPagination()
            break
          case 'sailpoint_get_identity':
          case 'sailpoint_get_account':
          case 'sailpoint_get_entitlement':
          case 'sailpoint_get_entitlement_request_config':
          case 'sailpoint_get_role':
          case 'sailpoint_get_access_profile':
          case 'sailpoint_get_source':
          case 'sailpoint_get_account_activity':
          case 'sailpoint_get_certification':
          case 'sailpoint_sign_off_certification':
          case 'sailpoint_get_task_status':
            setStr('id', params.id)
            break
          case 'sailpoint_decide_certification_review_items':
            setStr('id', params.id)
            setJson('decisions', params.decisions)
            break
          case 'sailpoint_get_access_request_status':
            applyIdentityScope()
            setStr('assignedTo', params.assignedTo)
            setStr('requestState', params.requestState)
            applyFilters()
            applyPagination()
            break
          case 'sailpoint_request_access':
          case 'sailpoint_get_account_selections': {
            if (params.requestPayloadShape === 'structured') {
              setJson(
                'requestedForWithRequestedItems',
                params.requestedForWithRequestedItems,
                'requestedForWithRequestedItems'
              )
            } else {
              setJson('requestedFor', params.requestedIdentities, 'requestedFor')
              setJson('requestedItems', params.requestedItems, 'requestedItems')
            }
            setStr('requestType', params.requestType)
            setJson('clientMetadata', params.clientMetadata)
            break
          }
          case 'sailpoint_get_access_request_config':
            break
          case 'sailpoint_cancel_access_request':
            setStr('accountActivityId', params.accountActivityId)
            setStr('comment', params.comment)
            break
          case 'sailpoint_list_pending_access_request_approvals':
            setStr('ownerId', params.ownerId)
            applyFilters()
            applyPagination()
            break
          case 'sailpoint_approve_access_request':
          case 'sailpoint_reject_access_request':
            setStr('approvalId', params.approvalId)
            setStr('comment', params.approvalComment)
            break
          case 'sailpoint_load_accounts': {
            setStr('sourceId', params.sourceId)
            const file = normalizeFileInput(params.accountsCsv, { single: true })
            if (file) mapped.file = file
            setBoolean('disableOptimization', params.disableOptimization)
            break
          }
          case 'sailpoint_load_entitlements': {
            setStr('sourceId', params.sourceId)
            const file = normalizeFileInput(params.entitlementsCsv, { single: true })
            if (file) mapped.file = file
            break
          }
        }

        return mapped
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Selected SailPoint operation' },
    tenant: { type: 'string', description: 'SailPoint tenant subdomain' },
    clientId: { type: 'string', description: 'PAT client ID' },
    clientSecret: { type: 'string', description: 'PAT client secret' },
    id: { type: 'string', description: 'Resource ID for single-entity operations' },
    indices: { type: 'json', description: 'Search index names; omission searches all indices' },
    queryType: { type: 'string', description: 'SAILPOINT, DSL, TEXT, or TYPEAHEAD' },
    queryVersion: { type: 'string', description: 'Elasticsearch version for the query body' },
    query: {
      type: 'json',
      description: 'SailPoint query object (query, fields, timeZone, innerHit)',
    },
    queryDsl: { type: 'json', description: 'Elasticsearch Query DSL object' },
    textQuery: {
      type: 'json',
      description: 'Text query object (terms, fields, matchAny, contains)',
    },
    typeAheadQuery: {
      type: 'json',
      description:
        'Type-ahead query object (query, field, nestedType, maxExpansions, size, sort, sortByValue)',
    },
    includeNested: { type: 'boolean', description: 'Include nested objects in search results' },
    queryResultFilter: {
      type: 'json',
      description: 'Search result field includes and excludes',
    },
    searchFilters: { type: 'json', description: 'Structured Search filters keyed by field' },
    sort: { type: 'json', description: 'Search sort field array' },
    searchAfter: { type: 'json', description: 'Search-after cursor value array' },
    aggregationType: { type: 'string', description: 'DSL or SAILPOINT aggregation syntax' },
    aggregationsVersion: {
      type: 'string',
      description: 'Elasticsearch version for the aggregation body',
    },
    aggregationsDsl: {
      type: 'json',
      description: 'Elasticsearch aggregations DSL object',
    },
    aggregations: { type: 'json', description: 'SailPoint aggregation specification' },
    filters: { type: 'string', description: 'Service collection filter expression' },
    sorters: { type: 'string', description: 'Sort expression' },
    limit: { type: 'number', description: 'Maximum records to return' },
    offset: { type: 'number', description: 'Pagination offset' },
    count: { type: 'boolean', description: 'Include the total matching record count' },
    defaultFilter: {
      type: 'string',
      description: 'Identity default filter (CORRELATED_ONLY or NONE)',
    },
    detailLevel: { type: 'string', description: 'Account detail level (SLIM or FULL)' },
    detail: { type: 'string', description: 'Campaign detail level (SLIM or FULL)' },
    entitlementSegmentationMode: {
      type: 'string',
      description: 'Entitlement segmentation by identity or explicit segment IDs',
    },
    segmentedForIdentity: {
      type: 'string',
      description: 'Identity ID for entitlement segmentation',
    },
    entitlementForSegmentIds: {
      type: 'string',
      description: 'Comma-separated segment IDs for entitlement filtering',
    },
    entitlementIncludeUnsegmented: {
      type: 'boolean',
      description: 'Whether segmented entitlement results include unsegmented entitlements',
    },
    accessModelSegmentationMode: {
      type: 'string',
      description: 'Role/access-profile segmentation mode',
    },
    forSegmentIds: { type: 'string', description: 'Comma-separated segment IDs' },
    includeUnsegmented: {
      type: 'boolean',
      description: 'Whether segmented list results include unsegmented access objects',
    },
    entitlementSearchAfter: {
      type: 'string',
      description: 'Comma-separated entitlement list search-after values matching sorters',
    },
    forSubadmin: {
      type: 'string',
      description: 'Subadmin identity ID or me for sources, roles, and access profiles',
    },
    includeIDNSource: {
      type: 'boolean',
      description: 'Include the IdentityNow source in results',
    },
    identityScopeType: {
      type: 'string',
      description: 'Identity scoping mode for activity and request-status lists',
    },
    requestedForFilter: { type: 'string', description: 'Identity to scope activities/status by' },
    requestedBy: { type: 'string', description: 'Requester identity to scope by' },
    regardingIdentity: { type: 'string', description: 'Requester or target identity to scope by' },
    assignedTo: { type: 'string', description: 'Work item owner identity ID' },
    requestState: { type: 'string', description: 'Access request state filter (EXECUTING)' },
    reviewerIdentity: { type: 'string', description: 'Reviewer identity for certifications' },
    entitlements: { type: 'string', description: 'Certification review item entitlements filter' },
    accessProfiles: {
      type: 'string',
      description: 'Certification review item access-profiles filter',
    },
    roles: { type: 'string', description: 'Certification review item roles filter' },
    decisions: {
      type: 'json',
      description: 'Certification review decisions (id, decision, bulk, and optional details)',
    },
    requestPayloadShape: {
      type: 'string',
      description: 'Flat human request or structured per-identity request shape',
    },
    requestedIdentities: { type: 'json', description: 'Identity IDs the access is requested for' },
    requestedItems: { type: 'json', description: 'Access items to request or revoke' },
    requestedForWithRequestedItems: {
      type: 'json',
      description: 'Per-identity access items and optional human or machine identity type',
    },
    requestType: { type: 'string', description: 'GRANT_ACCESS, REVOKE_ACCESS, or MODIFY_ACCESS' },
    clientMetadata: { type: 'json', description: 'Arbitrary key/value metadata for correlation' },
    accountActivityId: { type: 'string', description: 'identityRequestId to cancel' },
    comment: { type: 'string', description: 'Reason for cancellation' },
    ownerId: { type: 'string', description: 'Pending-approval owner identity ID or me' },
    approvalId: { type: 'string', description: 'Pending access-request approval ID' },
    approvalComment: { type: 'string', description: 'Approval or rejection comment' },
    sourceId: { type: 'string', description: 'Source ID for aggregation' },
    accountsCsv: { type: 'json', description: 'Accounts CSV file to aggregate' },
    entitlementsCsv: { type: 'json', description: 'Entitlements CSV file to aggregate' },
    disableOptimization: {
      type: 'boolean',
      description: 'Reprocess every account during aggregation',
    },
  },

  outputs: {
    items: {
      type: 'json',
      description: 'Operation-specific array of SailPoint resources for the returned page',
      condition: { field: 'operation', value: LIST_OUTPUT_OPERATIONS },
    },
    results: {
      type: 'json',
      description: 'Search documents from the requested SailPoint indices',
      condition: { field: 'operation', value: 'sailpoint_search' },
    },
    identity: {
      type: 'json',
      description: 'Identity resource (id, name, alias, email, attributes, and manager)',
      condition: { field: 'operation', value: 'sailpoint_get_identity' },
    },
    account: {
      type: 'json',
      description:
        'Account resource (id, name, nativeIdentity, sourceId, identityId, and attributes)',
      condition: { field: 'operation', value: 'sailpoint_get_account' },
    },
    entitlement: {
      type: 'json',
      description:
        'Entitlement resource (id, name, attribute, value, source, owner, requestable, privilegeLevel)',
      condition: { field: 'operation', value: 'sailpoint_get_entitlement' },
    },
    role: {
      type: 'json',
      description:
        'Role resource (id, name, description, owner, requestable, accessProfiles, membership)',
      condition: { field: 'operation', value: 'sailpoint_get_role' },
    },
    accessProfile: {
      type: 'json',
      description:
        'Access profile resource (id, name, description, owner, source, entitlements, accessRequestConfig, and revocationRequestConfig)',
      condition: { field: 'operation', value: 'sailpoint_get_access_profile' },
    },
    source: {
      type: 'json',
      description:
        'Source resource (id, name, description, owner, connector, status, authoritative, healthy)',
      condition: { field: 'operation', value: 'sailpoint_get_source' },
    },
    accountActivity: {
      type: 'json',
      description:
        'Account activity resource (id, name, type, created, modified, requesterIdentitySummary, targetIdentitySummary, and items)',
      condition: { field: 'operation', value: 'sailpoint_get_account_activity' },
    },
    campaign: {
      type: 'json',
      description:
        'Campaign resource (id, name, description, status, type, dates, and completion statistics)',
      condition: { field: 'operation', value: 'sailpoint_get_campaign' },
    },
    certification: {
      type: 'json',
      description:
        'Identity certification (id, name, reviewer, decisionsMade, decisionsTotal, completed, and signed)',
      condition: {
        field: 'operation',
        value: [
          'sailpoint_get_certification',
          'sailpoint_decide_certification_review_items',
          'sailpoint_sign_off_certification',
        ],
      },
    },
    total: {
      type: 'number',
      description: 'Total documents matching the search body',
      condition: { field: 'operation', value: 'sailpoint_search_count' },
    },
    accountSelections: {
      type: 'json',
      description: 'Eligible source accounts grouped by requested identity and access item',
      condition: { field: 'operation', value: 'sailpoint_get_account_selections' },
    },
    accessRequestConfig: {
      type: 'json',
      description: 'Tenant access-request and machine-identity configuration',
      condition: { field: 'operation', value: 'sailpoint_get_access_request_config' },
    },
    entitlementRequestConfig: {
      type: 'json',
      description: 'Grant, revocation, duration, approval, and form settings for an entitlement',
      condition: { field: 'operation', value: 'sailpoint_get_entitlement_request_config' },
    },
    aggregations: {
      type: 'json',
      description: 'Aggregation buckets and metrics returned by SailPoint Search',
      condition: { field: 'operation', value: 'sailpoint_search_aggregate' },
    },
    hits: {
      type: 'json',
      description: 'Search hits included with the aggregation response',
      condition: { field: 'operation', value: 'sailpoint_search_aggregate' },
    },
    task: {
      type: 'json',
      description:
        'Task status (id, type, uniqueName, description, created, launched, completionStatus, progress, percentComplete, messages, returns)',
      condition: {
        field: 'operation',
        value: [
          'sailpoint_load_accounts',
          'sailpoint_load_entitlements',
          'sailpoint_get_task_status',
        ],
      },
    },
    success: {
      type: 'boolean',
      description: 'Whether the account aggregation request succeeded',
      condition: { field: 'operation', value: 'sailpoint_load_accounts' },
    },
    accepted: {
      type: 'boolean',
      description: 'Whether SailPoint accepted the asynchronous write',
      condition: { field: 'operation', value: ACCEPTED_OUTPUT_OPERATIONS },
    },
    status: {
      type: 'number',
      description: 'HTTP status returned by SailPoint for the write',
      condition: { field: 'operation', value: ACCEPTED_OUTPUT_OPERATIONS },
    },
    newRequests: {
      type: 'json',
      description:
        'New access requests (requestedFor, requestedItemsDetails, attributesHash, accessRequestIds)',
      condition: { field: 'operation', value: 'sailpoint_request_access' },
    },
    existingRequests: {
      type: 'json',
      description:
        'Existing matching access requests (requestedFor, requestedItemsDetails, attributesHash, accessRequestIds)',
      condition: { field: 'operation', value: 'sailpoint_request_access' },
    },
    count: {
      type: 'number',
      description: 'Number of resources returned in this page',
      condition: { field: 'operation', value: [...LIST_OUTPUT_OPERATIONS, 'sailpoint_search'] },
    },
    totalCount: {
      type: 'number',
      description: 'Total matching resources when count=true; otherwise null',
      condition: {
        field: 'operation',
        value: [...LIST_OUTPUT_OPERATIONS, 'sailpoint_search', 'sailpoint_search_aggregate'],
      },
    },
  },
}

export const SailPointBlockMeta = {
  tags: ['identity', 'automation'],
  url: 'https://www.sailpoint.com',
  templates: [
    {
      icon: SailPointIcon,
      title: 'SailPoint joiner access review',
      prompt:
        'Create a scheduled workflow that lists recent SailPoint account activities for joiners, summarizes their granted access and time-to-access, and posts a digest to Slack for the identity team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SailPointIcon,
      title: 'SailPoint access request bot',
      prompt:
        'Build a Slack bot where a user describes the access they need, the agent searches SailPoint entitlements and access profiles, and submits a SailPoint access request on their behalf with a correlation note in client metadata.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'self-service'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SailPointIcon,
      title: 'SailPoint orphan account finder',
      prompt:
        'Create a scheduled workflow that lists SailPoint accounts using the uncorrelated filter, groups the orphaned accounts by source, and writes the review-ready inventory to a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'analysis'],
    },
    {
      icon: SailPointIcon,
      title: 'SailPoint certification progress digest',
      prompt:
        'Build a scheduled workflow that lists active SailPoint campaigns and certifications, computes completion percentages, and emails a progress digest to certification owners.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: SailPointIcon,
      title: 'SailPoint leaver access revocation',
      prompt:
        'Create a workflow that, given a departing employee, searches their SailPoint identity access, and submits revoke access requests for each directly-assigned entitlement with a comment referencing the offboarding ticket in Jira.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'security'],
      alsoIntegrations: ['jira'],
    },
    {
      icon: SailPointIcon,
      title: 'SailPoint entitlement catalog export',
      prompt:
        'Build a scheduled workflow that lists SailPoint entitlements and their owning sources, and writes the catalog to a table for access-governance reporting.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'reporting'],
    },
    {
      icon: SailPointIcon,
      title: 'SailPoint privileged access watch',
      prompt:
        'Create a scheduled workflow that searches SailPoint identities holding privileged roles, cross-references recent account activities, and flags any new privileged grants to a security review channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'security'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'review-identity-access',
      description:
        'Search a SailPoint identity and summarize its entitlements, roles, and access profiles for an access review.',
      content:
        '# Review SailPoint Identity Access\n\nBuild a complete picture of what an identity can access.\n\n## Steps\n1. Search identities (with nested objects) to find the target identity and its access array.\n2. Expand roles and access profiles into their underlying entitlements.\n3. Note directly-assigned versus role- or birthright-granted access (only directly-assigned access can be revoked via access request).\n\n## Output\nA per-identity access summary highlighting privileged or unusual grants for reviewer attention.',
    },
    {
      name: 'request-and-track-access',
      description:
        'Submit a SailPoint access request and track it to completion via account activities and request status.',
      content:
        '# Request and Track SailPoint Access\n\nDrive an access request from submission to fulfillment.\n\n## Steps\n1. Search entitlements, roles, or access profiles to resolve the exact item IDs and confirm the identity does not already hold the access.\n2. Submit a GRANT_ACCESS request using the flat human shape or the structured per-identity shape when account selection or a machine identity is required.\n3. Record accessRequestIds from newRequests and use access-request status plus account activities to follow fulfillment, cancelling only when authorized and necessary.\n\n## Output\nThe new or existing request IDs, requested items, and current fulfillment status.',
    },
    {
      name: 'review-pending-access-requests',
      description:
        'Review pending SailPoint access-request approvals and approve or reject each item with an auditable comment.',
      content:
        '# Review Pending SailPoint Access Requests\n\nProcess the approval queue with the context needed for a defensible decision.\n\n## Steps\n1. List pending access-request approvals for the current approver or an authorized owner.\n2. Inspect the requester, target identity, requested object, dates, account selections, prior reviewer comments, and any separation-of-duties context.\n3. Approve justified requests; reject requests that should not proceed and include the required reason.\n\n## Output\nA decision log containing each approval ID, requested access, decision, comment, and provider acceptance status.',
    },
    {
      name: 'complete-certification-review',
      description:
        'Review SailPoint certification items, record approve or revoke decisions, and sign off the completed certification.',
      content:
        '# Complete a SailPoint Certification Review\n\nWork through an assigned identity certification without losing review context.\n\n## Steps\n1. List certifications for the reviewer and open the target certification.\n2. Page through its access-review items, filtering by entitlement, access profile, or role when needed.\n3. Submit decisions in batches of no more than 250 review items, including comments and proposed end dates for revoke decisions where appropriate.\n4. Re-read the certification and sign it off only after every required item is complete.\n\n## Output\nThe certification status, decision summary, unresolved items, and final sign-off result.',
    },
    {
      name: 'monitor-aggregation-task',
      description:
        'Start a SailPoint source aggregation and monitor its task status through completion.',
      content:
        '# Monitor a SailPoint Aggregation Task\n\nRun a source import and surface its terminal result.\n\n## Steps\n1. Start an account or entitlement aggregation for the intended source, attaching a CSV only for a compatible delimited-file source.\n2. Capture the returned task ID.\n3. Poll task status until completionStatus is populated, retaining progress, percentComplete, messages, and return values.\n4. Report warnings or errors without treating task submission as successful completion.\n\n## Output\nThe source and task IDs, progress history, completion status, messages, and returned task details.',
    },
    {
      name: 'audit-orphan-accounts',
      description:
        'Find uncorrelated SailPoint accounts and prepare a source-grouped orphan-account inventory.',
      content:
        '# Audit SailPoint Orphan Accounts\n\nIdentify accounts that are not correlated to an identity.\n\n## Steps\n1. List accounts with the documented uncorrelated filter and request full detail when the audit needs source and attribute context.\n2. Page through all results using limit, offset, and totalCount when requested.\n3. Group accounts by source and preserve account ID, native identity, account name, source, creation and modification timestamps, and entitlement context.\n4. Write the normalized inventory to a table for governance follow-up.\n\n## Output\nA source-grouped orphan-account inventory with stable account identifiers and the evidence needed for review.',
    },
  ],
} as const satisfies BlockMeta
