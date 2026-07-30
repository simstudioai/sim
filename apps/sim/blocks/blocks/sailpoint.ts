import { SailPointIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import {
  normalizeFileInput,
  parseOptionalJsonInput,
  parseOptionalNumberInput,
} from '@/blocks/utils'
import type { SailPointListResponse } from '@/tools/sailpoint/types'

/** Single-entity operations that take a resource `id`. */
const ID_OPERATIONS = [
  'sailpoint_get_identity',
  'sailpoint_get_account',
  'sailpoint_get_account_entitlements',
  'sailpoint_get_entitlement',
  'sailpoint_get_role_entitlements',
  'sailpoint_get_access_profile_entitlements',
  'sailpoint_get_source',
  'sailpoint_get_account_activity',
  'sailpoint_get_campaign',
  'sailpoint_list_certification_review_items',
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
]

/** Operations that accept `limit`/`offset` pagination. */
const LIMIT_OPERATIONS = [
  ...FILTER_OPERATIONS,
  'sailpoint_search',
  'sailpoint_search_aggregate',
  'sailpoint_get_account_entitlements',
]

/** Operations that scope by an identity (`requested-for` / `requested-by` / `regarding-identity`). */
const IDENTITY_SCOPE_OPERATIONS = [
  'sailpoint_list_account_activities',
  'sailpoint_get_access_request_status',
]

export const SailPointBlock: BlockConfig<SailPointListResponse> = {
  type: 'sailpoint',
  name: 'SailPoint',
  description: 'Govern identities and access in SailPoint Identity Security Cloud',
  longDescription:
    'Read and act on identity governance data in SailPoint Identity Security Cloud (ISC): search identities, accounts, entitlements, roles, and access profiles; review account activities, campaigns, and certifications; and request, revoke, or cancel access. Authenticates with a Personal Access Token (PAT) using the OAuth2 client-credentials grant against your per-tenant host (https://{tenant}.api.identitynow.com). ' +
    "IMPORTANT: generate the PAT from a dedicated ISC service *identity* (a real user with the required user level), NOT an API-Management client - identity, role, access-profile, and access-request endpoints are user-context only, and a client without user context returns empty result sets instead of an error. A PAT's effective rights are the intersection of its selected scopes AND the owner's ISC user level. Select these scopes when generating the PAT: sp:search:read (search), idn:identity:read (identities), idn:accounts:read (accounts), idn:entitlement:read (entitlements), idn:role-unchecked:read (roles), idn:access-profile:read (access profiles), idn:sources:read (sources), idn:access-request:manage or idn:access-request-self:manage (request/cancel access), idn:access-request-status:read (request status), idn:campaign:read (campaigns and certifications). Account activities are user-context gated and need no dedicated scope; sp:scopes:all covers everything for a pilot. Revoking access for anyone who is not a direct report requires ORG_ADMIN, and self-revoke is not permitted.",
  docsLink: 'https://docs.sim.ai/integrations/sailpoint',
  category: 'tools',
  integrationType: IntegrationType.Security,
  bgColor: '#0033A1',
  icon: SailPointIcon,
  authMode: AuthMode.ApiKey,

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
        { label: 'List Entitlements', id: 'sailpoint_list_entitlements' },
        { label: 'Get Entitlement', id: 'sailpoint_get_entitlement' },
        { label: 'List Roles', id: 'sailpoint_list_roles' },
        { label: 'Get Role Entitlements', id: 'sailpoint_get_role_entitlements' },
        { label: 'List Access Profiles', id: 'sailpoint_list_access_profiles' },
        {
          label: 'Get Access Profile Entitlements',
          id: 'sailpoint_get_access_profile_entitlements',
        },
        { label: 'List Sources', id: 'sailpoint_list_sources' },
        { label: 'Get Source', id: 'sailpoint_get_source' },
        { label: 'List Account Activities', id: 'sailpoint_list_account_activities' },
        { label: 'Get Account Activity', id: 'sailpoint_get_account_activity' },
        { label: 'List Campaigns', id: 'sailpoint_list_campaigns' },
        { label: 'Get Campaign', id: 'sailpoint_get_campaign' },
        { label: 'List Certifications', id: 'sailpoint_list_certifications' },
        {
          label: 'List Certification Review Items',
          id: 'sailpoint_list_certification_review_items',
        },
        { label: 'Request Access', id: 'sailpoint_request_access' },
        { label: 'Cancel Access Request', id: 'sailpoint_cancel_access_request' },
        { label: 'Get Access Request Status', id: 'sailpoint_get_access_request_status' },
        { label: 'Load Accounts (CSV)', id: 'sailpoint_load_accounts' },
        { label: 'Load Entitlements (CSV)', id: 'sailpoint_load_entitlements' },
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
      title: 'API Version',
      type: 'dropdown',
      options: [
        { label: 'v2025 (default)', id: 'v2025' },
        { label: 'v2024', id: 'v2024' },
        { label: 'v3', id: 'v3' },
      ],
      value: () => 'v2025',
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
      type: 'short-input',
      placeholder: 'identities (comma-separated or JSON array)',
      condition: { field: 'operation', value: SEARCH_OPERATIONS },
    },
    {
      id: 'query',
      title: 'Query',
      type: 'short-input',
      placeholder: 'attributes.department:Engineering',
      condition: { field: 'operation', value: SEARCH_OPERATIONS },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a SailPoint Identity Security Cloud search query string using Elasticsearch query-string syntax (field:value, AND/OR, wildcards). Return ONLY the query string - no explanations.',
        placeholder:
          'Describe what to search for, e.g. "active identities in the Finance department"...',
      },
    },
    {
      id: 'includeNested',
      title: 'Include Nested Objects',
      type: 'dropdown',
      options: [
        { label: 'Yes (default)', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'true',
      condition: { field: 'operation', value: 'sailpoint_search' },
      mode: 'advanced',
    },
    {
      id: 'sort',
      title: 'Sort',
      type: 'short-input',
      placeholder: 'displayName,+id',
      condition: { field: 'operation', value: 'sailpoint_search' },
      mode: 'advanced',
    },
    {
      id: 'searchAfter',
      title: 'Search After',
      type: 'short-input',
      placeholder: '["John Doe","2c9180...id"] (cursor from the last result to page past 10k)',
      condition: { field: 'operation', value: 'sailpoint_search' },
      mode: 'advanced',
    },
    {
      id: 'aggregationsDsl',
      title: 'Aggregations',
      type: 'code',
      language: 'json',
      placeholder: '{ "department": { "terms": { "field": "attributes.department" } } }',
      condition: { field: 'operation', value: 'sailpoint_search_aggregate' },
      required: { field: 'operation', value: 'sailpoint_search_aggregate' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a SailPoint search aggregations DSL object (Elasticsearch aggregations syntax) defining the buckets or metrics to compute over the matched documents. Return ONLY valid JSON.',
        placeholder: 'Describe the aggregation, e.g. "count identities grouped by department"...',
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
          'Generate a SailPoint ISC V3 filter expression (e.g. name sw "A", cloudStatus eq "ACTIVE", and/or). Use documented filterable fields and operators. Return ONLY the filter string.',
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
      title: 'Account ID',
      type: 'short-input',
      placeholder: 'Filter entitlements to a specific account',
      condition: { field: 'operation', value: 'sailpoint_list_entitlements' },
      mode: 'advanced',
    },
    {
      id: 'segmentedForIdentity',
      title: 'Segmented For Identity',
      type: 'short-input',
      placeholder: 'Identity ID to apply entitlement segmentation for',
      condition: { field: 'operation', value: 'sailpoint_list_entitlements' },
      mode: 'advanced',
    },
    {
      id: 'forSubadmin',
      title: 'For Subadmin',
      type: 'short-input',
      placeholder: 'Subadmin identity ID',
      condition: { field: 'operation', value: 'sailpoint_list_sources' },
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
      id: 'requestedForFilter',
      title: 'Requested For',
      type: 'short-input',
      placeholder: 'Identity ID or "me"',
      condition: { field: 'operation', value: IDENTITY_SCOPE_OPERATIONS },
    },
    {
      id: 'requestedBy',
      title: 'Requested By',
      type: 'short-input',
      placeholder: 'Identity ID or "me"',
      condition: { field: 'operation', value: IDENTITY_SCOPE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'regardingIdentity',
      title: 'Regarding Identity',
      type: 'short-input',
      placeholder: 'Identity ID (requester or target)',
      condition: { field: 'operation', value: IDENTITY_SCOPE_OPERATIONS },
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
      id: 'entitlements',
      title: 'Entitlement IDs',
      type: 'short-input',
      placeholder: 'Comma-separated entitlement IDs to filter by',
      condition: { field: 'operation', value: 'sailpoint_list_certification_review_items' },
      mode: 'advanced',
    },
    {
      id: 'accessProfiles',
      title: 'Access Profile IDs',
      type: 'short-input',
      placeholder: 'Comma-separated access profile IDs to filter by',
      condition: { field: 'operation', value: 'sailpoint_list_certification_review_items' },
      mode: 'advanced',
    },
    {
      id: 'roles',
      title: 'Role IDs',
      type: 'short-input',
      placeholder: 'Comma-separated role IDs to filter by',
      condition: { field: 'operation', value: 'sailpoint_list_certification_review_items' },
      mode: 'advanced',
    },
    {
      id: 'requestedIdentities',
      title: 'Requested For (Identities)',
      type: 'code',
      language: 'json',
      placeholder: '["2c9180857c1a...","2c9180857c1b..."]',
      condition: { field: 'operation', value: 'sailpoint_request_access' },
      required: { field: 'operation', value: 'sailpoint_request_access' },
    },
    {
      id: 'requestedItems',
      title: 'Requested Items',
      type: 'code',
      language: 'json',
      placeholder: '[{ "type": "ENTITLEMENT", "id": "2c918...", "comment": "New hire" }]',
      condition: { field: 'operation', value: 'sailpoint_request_access' },
      required: { field: 'operation', value: 'sailpoint_request_access' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a SailPoint access-request requestedItems JSON array. Each item is { type: ACCESS_PROFILE|ROLE|ENTITLEMENT, id, comment?, removeDate?, startDate?, assignmentId?, nativeIdentity?, clientMetadata? }. For REVOKE_ACCESS exactly one item with a comment is allowed. Return ONLY valid JSON.',
        placeholder: 'Describe the access to request or revoke...',
        generationType: 'json-object',
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
      condition: { field: 'operation', value: 'sailpoint_request_access' },
    },
    {
      id: 'clientMetadata',
      title: 'Client Metadata',
      type: 'code',
      language: 'json',
      placeholder: '{ "requestedByEmail": "manager@acme.com" }',
      condition: { field: 'operation', value: 'sailpoint_request_access' },
      mode: 'advanced',
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
      'sailpoint_cancel_access_request',
      'sailpoint_get_access_profile_entitlements',
      'sailpoint_get_access_request_status',
      'sailpoint_get_account',
      'sailpoint_get_account_activity',
      'sailpoint_get_account_entitlements',
      'sailpoint_get_campaign',
      'sailpoint_get_entitlement',
      'sailpoint_get_identity',
      'sailpoint_get_role_entitlements',
      'sailpoint_get_source',
      'sailpoint_list_access_profiles',
      'sailpoint_list_account_activities',
      'sailpoint_list_accounts',
      'sailpoint_list_campaigns',
      'sailpoint_list_certification_review_items',
      'sailpoint_list_certifications',
      'sailpoint_list_entitlements',
      'sailpoint_list_identities',
      'sailpoint_list_roles',
      'sailpoint_list_sources',
      'sailpoint_load_accounts',
      'sailpoint_load_entitlements',
      'sailpoint_request_access',
      'sailpoint_search',
      'sailpoint_search_aggregate',
      'sailpoint_search_count',
    ],
    config: {
      tool: (params) =>
        typeof params.operation === 'string' ? params.operation : 'sailpoint_search',
      params: (params) => {
        const mapped: Record<string, unknown> = {
          clientId: params.clientId,
          clientSecret: params.clientSecret,
          tenant: params.tenant,
        }
        if (params.apiVersion) mapped.apiVersion = params.apiVersion

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
        const applyPagination = () => {
          setNum('limit', params.limit)
          setNum('offset', params.offset)
          if (params.count === 'true' || params.count === true) {
            mapped.count = true
          }
        }
        const applyFilters = () => {
          setStr('filters', params.filters)
          setStr('sorters', params.sorters)
        }

        switch (params.operation) {
          case 'sailpoint_search':
            setStr('indices', params.indices)
            setStr('query', params.query)
            setStr('sort', params.sort)
            setStr('searchAfter', params.searchAfter)
            if (params.includeNested === 'false' || params.includeNested === false) {
              mapped.includeNested = false
            }
            applyPagination()
            break
          case 'sailpoint_search_count':
            setStr('indices', params.indices)
            setStr('query', params.query)
            break
          case 'sailpoint_search_aggregate': {
            setStr('indices', params.indices)
            setStr('query', params.query)
            const aggregationsDsl = parseOptionalJsonInput(params.aggregationsDsl, 'aggregations')
            if (aggregationsDsl !== undefined) mapped.aggregationsDsl = aggregationsDsl
            applyPagination()
            break
          }
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
            setStr('accountId', params.accountId)
            setStr('segmentedForIdentity', params.segmentedForIdentity)
            applyPagination()
            break
          case 'sailpoint_list_roles':
          case 'sailpoint_list_access_profiles':
            applyFilters()
            applyPagination()
            break
          case 'sailpoint_get_role_entitlements':
          case 'sailpoint_get_access_profile_entitlements':
            setStr('id', params.id)
            applyFilters()
            applyPagination()
            break
          case 'sailpoint_get_account_entitlements':
            setStr('id', params.id)
            applyPagination()
            break
          case 'sailpoint_list_sources':
            applyFilters()
            setStr('forSubadmin', params.forSubadmin)
            if (params.includeIDNSource === 'true' || params.includeIDNSource === true) {
              mapped.includeIDNSource = true
            }
            applyPagination()
            break
          case 'sailpoint_list_account_activities':
            setStr('requestedFor', params.requestedForFilter)
            setStr('requestedBy', params.requestedBy)
            setStr('regardingIdentity', params.regardingIdentity)
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
            setStr('entitlements', params.entitlements)
            setStr('accessProfiles', params.accessProfiles)
            setStr('roles', params.roles)
            applyPagination()
            break
          case 'sailpoint_get_identity':
          case 'sailpoint_get_account':
          case 'sailpoint_get_entitlement':
          case 'sailpoint_get_source':
          case 'sailpoint_get_account_activity':
            setStr('id', params.id)
            break
          case 'sailpoint_get_access_request_status':
            setStr('requestedFor', params.requestedForFilter)
            setStr('requestedBy', params.requestedBy)
            setStr('regardingIdentity', params.regardingIdentity)
            setStr('assignedTo', params.assignedTo)
            setStr('requestState', params.requestState)
            applyFilters()
            applyPagination()
            break
          case 'sailpoint_request_access': {
            const requestedFor = parseOptionalJsonInput(params.requestedIdentities, 'requestedFor')
            if (requestedFor !== undefined) mapped.requestedFor = requestedFor
            const requestedItems = parseOptionalJsonInput(params.requestedItems, 'requestedItems')
            if (requestedItems !== undefined) mapped.requestedItems = requestedItems
            setStr('requestType', params.requestType)
            const clientMetadata = parseOptionalJsonInput(params.clientMetadata, 'clientMetadata')
            if (clientMetadata !== undefined) mapped.clientMetadata = clientMetadata
            break
          }
          case 'sailpoint_cancel_access_request':
            setStr('accountActivityId', params.accountActivityId)
            setStr('comment', params.comment)
            break
          case 'sailpoint_load_accounts': {
            setStr('sourceId', params.sourceId)
            const file = normalizeFileInput(params.accountsCsv, { single: true })
            if (file) mapped.file = file
            if (params.disableOptimization === 'true' || params.disableOptimization === true) {
              mapped.disableOptimization = true
            }
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
    apiVersion: { type: 'string', description: 'API version path segment (v2025, v2024, v3)' },
    id: { type: 'string', description: 'Resource ID for single-entity operations' },
    indices: { type: 'string', description: 'Search indices (comma-separated or JSON array)' },
    query: { type: 'string', description: 'Elasticsearch query string' },
    includeNested: { type: 'string', description: 'Include nested objects in search results' },
    sort: { type: 'string', description: 'Search sort fields' },
    searchAfter: { type: 'string', description: 'searchAfter cursor for deep search pagination' },
    aggregationsDsl: {
      type: 'json',
      description: 'Elasticsearch aggregations DSL for search aggregate',
    },
    filters: { type: 'string', description: 'V3 filter expression' },
    sorters: { type: 'string', description: 'Sort expression' },
    limit: { type: 'number', description: 'Maximum records to return' },
    offset: { type: 'number', description: 'Pagination offset' },
    count: { type: 'string', description: 'Include the total matching record count' },
    defaultFilter: {
      type: 'string',
      description: 'Identity default filter (CORRELATED_ONLY or NONE)',
    },
    detailLevel: { type: 'string', description: 'Account detail level (SLIM or FULL)' },
    detail: { type: 'string', description: 'Campaign detail level (SLIM or FULL)' },
    accountId: { type: 'string', description: 'Account ID to filter entitlements' },
    segmentedForIdentity: {
      type: 'string',
      description: 'Identity ID for entitlement segmentation',
    },
    forSubadmin: { type: 'string', description: 'Subadmin identity ID for source scoping' },
    includeIDNSource: { type: 'string', description: 'Include the IdentityNow source in results' },
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
    requestedIdentities: { type: 'json', description: 'Identity IDs the access is requested for' },
    requestedItems: { type: 'json', description: 'Access items to request or revoke' },
    requestType: { type: 'string', description: 'GRANT_ACCESS, REVOKE_ACCESS, or MODIFY_ACCESS' },
    clientMetadata: { type: 'json', description: 'Arbitrary key/value metadata for correlation' },
    accountActivityId: { type: 'string', description: 'identityRequestId to cancel' },
    comment: { type: 'string', description: 'Reason for cancellation' },
    sourceId: { type: 'string', description: 'Source ID for aggregation' },
    accountsCsv: { type: 'json', description: 'Accounts CSV file to aggregate' },
    entitlementsCsv: { type: 'json', description: 'Entitlements CSV file to aggregate' },
    disableOptimization: {
      type: 'string',
      description: 'Reprocess every account during aggregation',
    },
  },

  outputs: {
    items: { type: 'json', description: 'Raw SailPoint documents for list operations' },
    results: { type: 'json', description: 'Raw SailPoint documents for search operations' },
    item: { type: 'json', description: 'Raw SailPoint document for get operations' },
    total: { type: 'number', description: 'Total matching documents (search count)' },
    task: { type: 'json', description: 'Aggregation task for load operations' },
    accepted: { type: 'boolean', description: 'Whether an access-request write was accepted' },
    status: { type: 'number', description: 'HTTP status returned by SailPoint for writes' },
    count: { type: 'number', description: 'Number of records returned in the page' },
    totalCount: { type: 'number', description: 'Total matching records when count is requested' },
    complete: {
      type: 'boolean',
      description: 'False when an empty result may indicate a permission gap',
    },
    warnings: { type: 'json', description: 'Diagnostic warnings (e.g. empty-result guidance)' },
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
        'Create a scheduled workflow that searches SailPoint accounts that are uncorrelated to any identity, writes the orphan list to a table, and opens a review task for the source owners.',
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
        '# Request and Track SailPoint Access\n\nDrive an access request from submission to fulfillment.\n\n## Steps\n1. Search entitlements, roles, or access profiles to resolve the exact item IDs.\n2. Submit an access request (GRANT_ACCESS) for the identities, adding a correlation note in client metadata.\n3. Poll access request status and account activities until the request completes, cancelling if needed.\n\n## Output\nA confirmation of the submitted request plus its current fulfillment status.',
    },
  ],
} as const satisfies BlockMeta
