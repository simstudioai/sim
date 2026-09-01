import {
  createSailPointListOutputs,
  createSailPointOperationInput,
  createSailPointResourceOutput,
  normalizeStringList,
  optionalNonEmptyString,
  parseJsonValue,
  requireNonEmptyString,
  sailpointAcceptedOutputs,
  sailpointCredentialParams,
  sailpointPaginationParams,
  sailpointRolePaginationParams,
  unwrapSailPointOutput,
  validatePagination,
} from '@/tools/sailpoint/common'
import {
  SAILPOINT_ACCESS_PROFILE_OUTPUT_PROPERTIES,
  SAILPOINT_ACCESS_REQUEST_STATUS_OUTPUT_PROPERTIES,
  SAILPOINT_ACCESS_REQUEST_TRACKING_PROPERTIES,
  SAILPOINT_ACCOUNT_ACTIVITY_OUTPUT_PROPERTIES,
  SAILPOINT_ACCOUNT_OUTPUT_PROPERTIES,
  SAILPOINT_CAMPAIGN_OUTPUT_PROPERTIES,
  SAILPOINT_CERTIFICATION_OUTPUT_PROPERTIES,
  SAILPOINT_ENTITLEMENT_OUTPUT_PROPERTIES,
  SAILPOINT_IDENTITY_ENTITLEMENT_OUTPUT_PROPERTIES,
  SAILPOINT_IDENTITY_OUTPUT_PROPERTIES,
  SAILPOINT_PENDING_APPROVAL_OUTPUT_PROPERTIES,
  SAILPOINT_REVIEW_ITEM_OUTPUT_PROPERTIES,
  SAILPOINT_ROLE_OUTPUT_PROPERTIES,
  SAILPOINT_SOURCE_OUTPUT_PROPERTIES,
  SAILPOINT_TASK_OUTPUT_PROPERTIES,
} from '@/tools/sailpoint/outputs'
import type {
  SailPointAccessRequestStatusParams,
  SailPointApprovalDecisionParams,
  SailPointCancelAccessRequestParams,
  SailPointCertificationDecision,
  SailPointCredentials,
  SailPointDecideCertificationReviewItemsParams,
  SailPointGetByIdParams,
  SailPointGetCampaignParams,
  SailPointGetChildEntitlementsParams,
  SailPointListAccountActivitiesParams,
  SailPointListAccountsParams,
  SailPointListCampaignsParams,
  SailPointListCertificationsParams,
  SailPointListEntitlementsParams,
  SailPointListIdentitiesParams,
  SailPointListParams,
  SailPointListPendingApprovalsParams,
  SailPointListReviewItemsParams,
  SailPointListSourcesParams,
  SailPointLoadAccountsParams,
  SailPointLoadEntitlementsParams,
  SailPointRejectApprovalParams,
  SailPointRequestAccessParams,
  SailPointSearchAggregateParams,
  SailPointSearchBodyParams,
  SailPointSearchCountParams,
  SailPointSearchParams,
  SailPointSegmentedListParams,
  SailPointSourceItemRef,
} from '@/tools/sailpoint/types'
import type { InternalToolConfig, ToolConfig } from '@/tools/types'

type ToolParams = ToolConfig['params']

const ID_PARAM = {
  type: 'string',
  required: true,
  visibility: 'user-or-llm',
  description: 'SailPoint resource ID',
} as const

const FILTERS_PARAM = {
  type: 'string',
  required: false,
  visibility: 'user-or-llm',
  description: 'SailPoint standard collection filter expression for this operation',
} as const

const SORTERS_PARAM = {
  type: 'string',
  required: false,
  visibility: 'user-or-llm',
  description: 'Comma-separated supported sort fields, prefixed with - for descending order',
} as const

const FOR_SUBADMIN_PARAM = {
  type: 'string',
  required: false,
  visibility: 'user-or-llm',
  description: "Subadmin identity ID or 'me' whose visible resources should be returned",
} as const

const FOR_SEGMENT_IDS_PARAM = {
  type: 'string',
  required: false,
  visibility: 'user-or-llm',
  description: 'Comma-separated segment IDs used to restrict the returned resources',
} as const

const INCLUDE_UNSEGMENTED_PARAM = {
  type: 'boolean',
  required: false,
  visibility: 'user-or-llm',
  description: 'Include resources not assigned to a segment (default true)',
} as const

interface SailPointDefinition<P extends SailPointCredentials> {
  id: string
  name: string
  description: string
  params: ToolParams
  input: (params: P) => Record<string, unknown>
  outputs: ToolConfig['outputs']
}

function defineSailPointTool<P extends SailPointCredentials>({
  id,
  name,
  description,
  params,
  input,
  outputs,
}: SailPointDefinition<P>): InternalToolConfig<P> {
  return {
    id,
    name,
    description,
    version: '1.0.0',
    params,
    operation: { input: (params) => createSailPointOperationInput(id, params, input(params)) },
    transformResponse: (response) => unwrapSailPointOutput(response),
    outputs,
  }
}

function getInput(params: SailPointGetByIdParams, label: string): Record<string, unknown> {
  return { id: requireNonEmptyString(params.id, label) }
}

function listInput(
  params: SailPointListParams,
  extra: Record<string, unknown> = {},
  maxLimit = 250
): Record<string, unknown> {
  validatePagination(params.limit, params.offset, maxLimit)
  return {
    filters: optionalNonEmptyString(params.filters),
    sorters: optionalNonEmptyString(params.sorters),
    limit: params.limit,
    offset: params.offset,
    count: params.count,
    ...extra,
  }
}

function segmentedListInput(params: SailPointSegmentedListParams, maxLimit = 250) {
  return listInput(
    params,
    {
      forSubadmin: optionalNonEmptyString(params.forSubadmin),
      forSegmentIds: optionalNonEmptyString(params.forSegmentIds),
      includeUnsegmented: params.includeUnsegmented,
    },
    maxLimit
  )
}

function searchInput(
  params: SailPointSearchBodyParams,
  queryRequired = false
): Record<string, unknown> {
  const query = parseJsonValue(params.query, 'query')
  const queryDsl = parseJsonValue(params.queryDsl, 'queryDsl')
  const textQuery = parseJsonValue(params.textQuery, 'textQuery')
  const typeAheadQuery = parseJsonValue(params.typeAheadQuery, 'typeAheadQuery')
  const queryResultFilter = parseJsonValue(params.queryResultFilter, 'queryResultFilter')
  const aggregationsDsl = parseJsonValue(params.aggregationsDsl, 'aggregationsDsl')
  const aggregations = parseJsonValue(params.aggregations, 'aggregations')
  const filters = parseJsonValue(params.filters, 'filters')

  const hasQueryInput = Boolean(query || queryDsl || textQuery || typeAheadQuery)
  if (queryRequired || params.queryType || hasQueryInput) {
    const queryType = params.queryType ?? 'SAILPOINT'
    const selectedQuery = {
      DSL: queryDsl,
      SAILPOINT: query,
      TEXT: textQuery,
      TYPEAHEAD: typeAheadQuery,
    }[queryType]
    if (!selectedQuery) {
      const field = {
        DSL: 'queryDsl',
        SAILPOINT: 'query',
        TEXT: 'textQuery',
        TYPEAHEAD: 'typeAheadQuery',
      }[queryType]
      throw new Error(`${field} is required when queryType is ${queryType}`)
    }
  }
  const indices = normalizeStringList(params.indices, 'indices')
  const supportedIndices = new Set([
    'accessprofiles',
    'accountactivities',
    'entitlements',
    'events',
    'identities',
    'roles',
    '*',
  ])
  const invalidIndex = indices?.find((index) => !supportedIndices.has(index))
  if (invalidIndex) throw new Error(`Unsupported SailPoint search index: ${invalidIndex}`)

  return {
    indices,
    queryType: params.queryType,
    queryVersion: optionalNonEmptyString(params.queryVersion),
    query,
    queryDsl,
    textQuery,
    typeAheadQuery,
    includeNested: params.includeNested,
    queryResultFilter,
    aggregationType: params.aggregationType,
    aggregationsVersion: optionalNonEmptyString(params.aggregationsVersion),
    aggregationsDsl,
    aggregations,
    sort: normalizeStringList(params.sort, 'sort'),
    searchAfter: normalizeStringList(params.searchAfter, 'searchAfter'),
    filters,
  }
}

function searchParams(): ToolParams {
  return {
    ...sailpointCredentialParams,
    indices: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Indices to search: accessprofiles, accountactivities, entitlements, events, identities, roles, or *. Omit to search all.',
      items: { type: 'string' },
    },
    queryType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'SAILPOINT (default), DSL, TEXT, or TYPEAHEAD',
    },
    queryVersion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Elasticsearch query language version (default 5.2)',
    },
    query: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'SAILPOINT query object: {query?, fields?, timeZone?, innerHit?}',
      items: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          fields: { type: 'string' },
          timeZone: { type: 'string' },
          innerHit: { type: 'object', additionalProperties: true },
        },
      },
    },
    queryDsl: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Elasticsearch Query DSL object used with queryType=DSL',
    },
    textQuery: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'TEXT query object with required terms[] and fields[]',
      items: {
        type: 'object',
        required: ['terms', 'fields'],
        properties: {
          terms: { type: 'array' },
          fields: { type: 'array' },
          matchAny: { type: 'boolean' },
          contains: { type: 'boolean' },
        },
      },
    },
    typeAheadQuery: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'TYPEAHEAD query with query, field, optional nestedType, maxExpansions (1-1000), size, sort, and sortByValue',
      items: {
        type: 'object',
        required: ['query', 'field'],
        properties: {
          query: { type: 'string', minLength: 1 },
          field: { type: 'string', minLength: 1 },
          nestedType: { type: 'string' },
          maxExpansions: { type: 'integer', minimum: 1, maximum: 1000 },
          size: { type: 'integer', minimum: 1 },
          sort: { type: 'string' },
          sortByValue: { type: 'boolean' },
        },
      },
    },
    includeNested: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include nested objects in search results (default true)',
    },
    queryResultFilter: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Result projection object with includes[] and/or excludes[]',
      items: {
        type: 'object',
        properties: { includes: { type: 'array' }, excludes: { type: 'array' } },
      },
    },
    aggregationType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Aggregation query language: DSL (default) or SAILPOINT',
    },
    aggregationsVersion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Elasticsearch aggregation language version (default 5.2)',
    },
    aggregationsDsl: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Dynamic Elasticsearch aggregations DSL object',
    },
    aggregations: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Typed SailPoint aggregation specification',
    },
    sort: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ordered search fields; prefix + or - for direction',
      items: { type: 'string' },
    },
    searchAfter: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'String values from the final sorted record of the previous search page',
      items: { type: 'string' },
    },
    filters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Map of result field names to filter objects',
    },
  }
}

const SEARCH_OUTPUTS: ToolConfig['outputs'] = {
  results: {
    type: 'array',
    description: 'Index-dependent search documents',
    items: { type: 'json' },
  },
  count: { type: 'number', description: 'Documents returned in this page' },
  totalCount: {
    type: 'number',
    description: 'Total matching documents when count=true',
    nullable: true,
  },
}

const SEARCH_AGGREGATE_OUTPUTS: ToolConfig['outputs'] = {
  aggregations: {
    type: 'json',
    description: 'Dynamic Elasticsearch aggregation result document',
  },
  hits: {
    type: 'array',
    description: 'Index-dependent aggregation hits',
    items: { type: 'json' },
  },
  totalCount: {
    type: 'number',
    description: 'Total matching documents when count=true',
    nullable: true,
  },
}

export const sailpointSearchTool = defineSailPointTool<SailPointSearchParams>({
  id: 'sailpoint_search',
  name: 'SailPoint Search',
  description: 'Search current SailPoint indices with every documented search query mode.',
  params: { ...searchParams(), ...sailpointPaginationParams },
  input: (params) => {
    validatePagination(params.limit, params.offset, 10_000)
    return {
      ...searchInput(params, true),
      limit: params.limit,
      offset: params.offset,
      count: params.count,
    }
  },
  outputs: SEARCH_OUTPUTS,
})

export const sailpointSearchCountTool = defineSailPointTool<SailPointSearchCountParams>({
  id: 'sailpoint_search_count',
  name: 'SailPoint Search Count',
  description: 'Count documents matching a complete SailPoint search body.',
  params: searchParams(),
  input: (params) => searchInput(params, true),
  outputs: { total: { type: 'number', description: 'Number of matching documents' } },
})

export const sailpointSearchAggregateTool = defineSailPointTool<SailPointSearchAggregateParams>({
  id: 'sailpoint_search_aggregate',
  name: 'SailPoint Search Aggregate',
  description: 'Run an Elasticsearch DSL or SailPoint aggregation over current search indices.',
  params: { ...searchParams(), ...sailpointPaginationParams },
  input: (params) => {
    validatePagination(params.limit, params.offset)
    return {
      ...searchInput(params),
      limit: params.limit,
      offset: params.offset,
      count: params.count,
    }
  },
  outputs: SEARCH_AGGREGATE_OUTPUTS,
})

export const sailpointGetIdentityTool = defineSailPointTool<SailPointGetByIdParams>({
  id: 'sailpoint_get_identity',
  name: 'SailPoint Get Identity',
  description: 'Get an identity from the current /identities/v1 service by ID.',
  params: { ...sailpointCredentialParams, id: { ...ID_PARAM, description: 'Identity ID' } },
  input: (params) => getInput(params, 'Identity ID'),
  outputs: createSailPointResourceOutput(
    'identity',
    SAILPOINT_IDENTITY_OUTPUT_PROPERTIES,
    'SailPoint identity'
  ),
})

export const sailpointListIdentitiesTool = defineSailPointTool<SailPointListIdentitiesParams>({
  id: 'sailpoint_list_identities',
  name: 'SailPoint List Identities',
  description: 'List identities with documented filtering, sorting, and pagination.',
  params: {
    ...sailpointCredentialParams,
    filters: FILTERS_PARAM,
    sorters: SORTERS_PARAM,
    defaultFilter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'CORRELATED_ONLY (default) or NONE',
    },
    ...sailpointPaginationParams,
  },
  input: (params) => listInput(params, { defaultFilter: params.defaultFilter }),
  outputs: createSailPointListOutputs(
    SAILPOINT_IDENTITY_OUTPUT_PROPERTIES,
    'Identities in this page'
  ),
})

export const sailpointGetAccountTool = defineSailPointTool<SailPointGetByIdParams>({
  id: 'sailpoint_get_account',
  name: 'SailPoint Get Account',
  description: 'Get an account from the current /accounts/v1 service by ID.',
  params: { ...sailpointCredentialParams, id: { ...ID_PARAM, description: 'Account ID' } },
  input: (params) => getInput(params, 'Account ID'),
  outputs: createSailPointResourceOutput(
    'account',
    SAILPOINT_ACCOUNT_OUTPUT_PROPERTIES,
    'SailPoint account'
  ),
})

export const sailpointListAccountsTool = defineSailPointTool<SailPointListAccountsParams>({
  id: 'sailpoint_list_accounts',
  name: 'SailPoint List Accounts',
  description: 'List accounts with documented filtering, sorting, detail, and pagination.',
  params: {
    ...sailpointCredentialParams,
    filters: FILTERS_PARAM,
    sorters: SORTERS_PARAM,
    detailLevel: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'SLIM or FULL (default FULL)',
    },
    ...sailpointPaginationParams,
  },
  input: (params) => listInput(params, { detailLevel: params.detailLevel }),
  outputs: createSailPointListOutputs(SAILPOINT_ACCOUNT_OUTPUT_PROPERTIES, 'Accounts in this page'),
})

export const sailpointGetAccountEntitlementsTool =
  defineSailPointTool<SailPointGetChildEntitlementsParams>({
    id: 'sailpoint_get_account_entitlements',
    name: 'SailPoint Get Account Entitlements',
    description: 'List entitlements granted to one account.',
    params: {
      ...sailpointCredentialParams,
      id: { ...ID_PARAM, description: 'Account ID' },
      ...sailpointPaginationParams,
    },
    input: (params) => ({
      ...listInput(params),
      id: requireNonEmptyString(params.id, 'Account ID'),
    }),
    outputs: createSailPointListOutputs(
      SAILPOINT_ENTITLEMENT_OUTPUT_PROPERTIES,
      'Entitlements on this account'
    ),
  })

export const sailpointGetAccountActivityTool = defineSailPointTool<SailPointGetByIdParams>({
  id: 'sailpoint_get_account_activity',
  name: 'SailPoint Get Account Activity',
  description: 'Get an account activity by ID.',
  params: {
    ...sailpointCredentialParams,
    id: { ...ID_PARAM, description: 'Account activity ID' },
  },
  input: (params) => getInput(params, 'Account activity ID'),
  outputs: createSailPointResourceOutput(
    'accountActivity',
    SAILPOINT_ACCOUNT_ACTIVITY_OUTPUT_PROPERTIES,
    'SailPoint account activity'
  ),
})

export const sailpointListAccountActivitiesTool =
  defineSailPointTool<SailPointListAccountActivitiesParams>({
    id: 'sailpoint_list_account_activities',
    name: 'SailPoint List Account Activities',
    description: 'List provisioning activities with identity, filter, sort, and page controls.',
    params: {
      ...sailpointCredentialParams,
      requestedFor: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: "Target identity ID or 'me'; mutually exclusive with regardingIdentity",
      },
      requestedBy: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: "Requester identity ID or 'me'; mutually exclusive with regardingIdentity",
      },
      regardingIdentity: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: "Requester-or-target identity ID or 'me'; excludes requestedFor/requestedBy",
      },
      filters: FILTERS_PARAM,
      sorters: SORTERS_PARAM,
      ...sailpointPaginationParams,
    },
    input: (params) => {
      if (params.regardingIdentity && (params.requestedFor || params.requestedBy)) {
        throw new Error('regardingIdentity cannot be combined with requestedFor or requestedBy')
      }
      return listInput(params, {
        requestedFor: optionalNonEmptyString(params.requestedFor),
        requestedBy: optionalNonEmptyString(params.requestedBy),
        regardingIdentity: optionalNonEmptyString(params.regardingIdentity),
      })
    },
    outputs: createSailPointListOutputs(
      SAILPOINT_ACCOUNT_ACTIVITY_OUTPUT_PROPERTIES,
      'Account activities in this page'
    ),
  })

export const sailpointGetSourceTool = defineSailPointTool<SailPointGetByIdParams>({
  id: 'sailpoint_get_source',
  name: 'SailPoint Get Source',
  description: 'Get an identity source by ID.',
  params: { ...sailpointCredentialParams, id: { ...ID_PARAM, description: 'Source ID' } },
  input: (params) => getInput(params, 'Source ID'),
  outputs: createSailPointResourceOutput(
    'source',
    SAILPOINT_SOURCE_OUTPUT_PROPERTIES,
    'SailPoint identity source'
  ),
})

export const sailpointListSourcesTool = defineSailPointTool<SailPointListSourcesParams>({
  id: 'sailpoint_list_sources',
  name: 'SailPoint List Sources',
  description:
    'List identity sources with visibility, filtering, sorting, and pagination controls.',
  params: {
    ...sailpointCredentialParams,
    filters: FILTERS_PARAM,
    sorters: SORTERS_PARAM,
    forSubadmin: FOR_SUBADMIN_PARAM,
    includeIDNSource: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include the built-in IdentityNow source (default false)',
    },
    ...sailpointPaginationParams,
  },
  input: (params) =>
    listInput(params, {
      forSubadmin: optionalNonEmptyString(params.forSubadmin),
      includeIDNSource: params.includeIDNSource,
    }),
  outputs: createSailPointListOutputs(SAILPOINT_SOURCE_OUTPUT_PROPERTIES, 'Sources in this page'),
})

export const sailpointGetEntitlementTool = defineSailPointTool<SailPointGetByIdParams>({
  id: 'sailpoint_get_entitlement',
  name: 'SailPoint Get Entitlement',
  description: 'Get an entitlement by ID.',
  params: { ...sailpointCredentialParams, id: { ...ID_PARAM, description: 'Entitlement ID' } },
  input: (params) => getInput(params, 'Entitlement ID'),
  outputs: createSailPointResourceOutput(
    'entitlement',
    SAILPOINT_ENTITLEMENT_OUTPUT_PROPERTIES,
    'SailPoint entitlement'
  ),
})

export const sailpointListEntitlementsTool = defineSailPointTool<SailPointListEntitlementsParams>({
  id: 'sailpoint_list_entitlements',
  name: 'SailPoint List Entitlements',
  description: 'List entitlements with current segmentation, cursor, filter, and page controls.',
  params: {
    ...sailpointCredentialParams,
    segmentedForIdentity: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Identity ID whose visible segments restrict the results',
    },
    forSegmentIds: FOR_SEGMENT_IDS_PARAM,
    includeUnsegmented: INCLUDE_UNSEGMENTED_PARAM,
    searchAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque search-after cursor from the previous entitlement page',
    },
    filters: FILTERS_PARAM,
    sorters: SORTERS_PARAM,
    ...sailpointPaginationParams,
  },
  input: (params) => {
    if (params.segmentedForIdentity && params.forSegmentIds) {
      throw new Error('segmentedForIdentity and forSegmentIds are mutually exclusive')
    }
    if (
      params.includeUnsegmented === false &&
      !params.segmentedForIdentity &&
      !params.forSegmentIds
    ) {
      throw new Error('includeUnsegmented=false requires segmentedForIdentity or forSegmentIds')
    }
    return listInput(params, {
      segmentedForIdentity: optionalNonEmptyString(params.segmentedForIdentity),
      forSegmentIds: optionalNonEmptyString(params.forSegmentIds),
      includeUnsegmented: params.includeUnsegmented,
      searchAfter: optionalNonEmptyString(params.searchAfter),
    })
  },
  outputs: createSailPointListOutputs(
    SAILPOINT_ENTITLEMENT_OUTPUT_PROPERTIES,
    'Entitlements in this page'
  ),
})

export const sailpointListIdentityEntitlementsTool =
  defineSailPointTool<SailPointGetChildEntitlementsParams>({
    id: 'sailpoint_list_identity_entitlements',
    name: 'SailPoint List Identity Entitlements',
    description: 'List tagged entitlement references held by one identity.',
    params: {
      ...sailpointCredentialParams,
      id: { ...ID_PARAM, description: 'Identity ID' },
      ...sailpointPaginationParams,
    },
    input: (params) => ({
      ...listInput(params),
      id: requireNonEmptyString(params.id, 'Identity ID'),
    }),
    outputs: createSailPointListOutputs(
      SAILPOINT_IDENTITY_ENTITLEMENT_OUTPUT_PROPERTIES,
      'Entitlements held by this identity'
    ),
  })

export const sailpointGetAccessProfileTool = defineSailPointTool<SailPointGetByIdParams>({
  id: 'sailpoint_get_access_profile',
  name: 'SailPoint Get Access Profile',
  description: 'Get an access profile by ID.',
  params: {
    ...sailpointCredentialParams,
    id: { ...ID_PARAM, description: 'Access profile ID' },
  },
  input: (params) => getInput(params, 'Access profile ID'),
  outputs: createSailPointResourceOutput(
    'accessProfile',
    SAILPOINT_ACCESS_PROFILE_OUTPUT_PROPERTIES,
    'SailPoint access profile'
  ),
})

export const sailpointListAccessProfilesTool = defineSailPointTool<SailPointSegmentedListParams>({
  id: 'sailpoint_list_access_profiles',
  name: 'SailPoint List Access Profiles',
  description: 'List access profiles with current visibility and segmentation controls.',
  params: {
    ...sailpointCredentialParams,
    forSubadmin: FOR_SUBADMIN_PARAM,
    forSegmentIds: FOR_SEGMENT_IDS_PARAM,
    includeUnsegmented: INCLUDE_UNSEGMENTED_PARAM,
    filters: FILTERS_PARAM,
    sorters: SORTERS_PARAM,
    ...sailpointPaginationParams,
  },
  input: (params) => segmentedListInput(params),
  outputs: createSailPointListOutputs(
    SAILPOINT_ACCESS_PROFILE_OUTPUT_PROPERTIES,
    'Access profiles in this page'
  ),
})

export const sailpointGetAccessProfileEntitlementsTool =
  defineSailPointTool<SailPointGetChildEntitlementsParams>({
    id: 'sailpoint_get_access_profile_entitlements',
    name: 'SailPoint Get Access Profile Entitlements',
    description: 'List entitlements in one access profile.',
    params: {
      ...sailpointCredentialParams,
      id: { ...ID_PARAM, description: 'Access profile ID' },
      filters: FILTERS_PARAM,
      sorters: SORTERS_PARAM,
      ...sailpointPaginationParams,
    },
    input: (params) => ({
      ...listInput(params),
      id: requireNonEmptyString(params.id, 'Access profile ID'),
    }),
    outputs: createSailPointListOutputs(
      SAILPOINT_ENTITLEMENT_OUTPUT_PROPERTIES,
      'Entitlements in this access profile'
    ),
  })

export const sailpointGetRoleTool = defineSailPointTool<SailPointGetByIdParams>({
  id: 'sailpoint_get_role',
  name: 'SailPoint Get Role',
  description: 'Get a role by ID.',
  params: { ...sailpointCredentialParams, id: { ...ID_PARAM, description: 'Role ID' } },
  input: (params) => getInput(params, 'Role ID'),
  outputs: createSailPointResourceOutput(
    'role',
    SAILPOINT_ROLE_OUTPUT_PROPERTIES,
    'SailPoint role'
  ),
})

export const sailpointListRolesTool = defineSailPointTool<SailPointSegmentedListParams>({
  id: 'sailpoint_list_roles',
  name: 'SailPoint List Roles',
  description:
    'List roles with current visibility, segmentation, filtering, and pagination controls.',
  params: {
    ...sailpointCredentialParams,
    forSubadmin: FOR_SUBADMIN_PARAM,
    forSegmentIds: FOR_SEGMENT_IDS_PARAM,
    includeUnsegmented: INCLUDE_UNSEGMENTED_PARAM,
    filters: FILTERS_PARAM,
    sorters: SORTERS_PARAM,
    ...sailpointRolePaginationParams,
  },
  input: (params) => segmentedListInput(params, 50),
  outputs: createSailPointListOutputs(SAILPOINT_ROLE_OUTPUT_PROPERTIES, 'Roles in this page'),
})

export const sailpointGetRoleEntitlementsTool =
  defineSailPointTool<SailPointGetChildEntitlementsParams>({
    id: 'sailpoint_get_role_entitlements',
    name: 'SailPoint Get Role Entitlements',
    description: 'List entitlements in one role using the current non-experimental roles service.',
    params: {
      ...sailpointCredentialParams,
      id: { ...ID_PARAM, description: 'Role ID' },
      filters: FILTERS_PARAM,
      sorters: SORTERS_PARAM,
      ...sailpointRolePaginationParams,
    },
    input: (params) => ({
      ...listInput(params, {}, 50),
      id: requireNonEmptyString(params.id, 'Role ID'),
    }),
    outputs: createSailPointListOutputs(
      SAILPOINT_ENTITLEMENT_OUTPUT_PROPERTIES,
      'Entitlements in this role'
    ),
  })

export const sailpointGetCampaignTool = defineSailPointTool<SailPointGetCampaignParams>({
  id: 'sailpoint_get_campaign',
  name: 'SailPoint Get Campaign',
  description: 'Get a certification campaign by ID.',
  params: {
    ...sailpointCredentialParams,
    id: { ...ID_PARAM, description: 'Campaign ID' },
    detail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'SLIM or FULL',
    },
  },
  input: (params) => ({
    ...getInput(params, 'Campaign ID'),
    detail: params.detail,
  }),
  outputs: createSailPointResourceOutput(
    'campaign',
    SAILPOINT_CAMPAIGN_OUTPUT_PROPERTIES,
    'SailPoint certification campaign'
  ),
})

export const sailpointListCampaignsTool = defineSailPointTool<SailPointListCampaignsParams>({
  id: 'sailpoint_list_campaigns',
  name: 'SailPoint List Campaigns',
  description: 'List certification campaigns with detail, filtering, sorting, and pagination.',
  params: {
    ...sailpointCredentialParams,
    detail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'SLIM (default) or FULL',
    },
    filters: FILTERS_PARAM,
    sorters: SORTERS_PARAM,
    ...sailpointPaginationParams,
  },
  input: (params) => listInput(params, { detail: params.detail }),
  outputs: createSailPointListOutputs(
    SAILPOINT_CAMPAIGN_OUTPUT_PROPERTIES,
    'Certification campaigns in this page'
  ),
})

export const sailpointGetCertificationTool = defineSailPointTool<SailPointGetByIdParams>({
  id: 'sailpoint_get_certification',
  name: 'SailPoint Get Certification',
  description: 'Get an identity certification by ID.',
  params: {
    ...sailpointCredentialParams,
    id: { ...ID_PARAM, description: 'Certification ID' },
  },
  input: (params) => getInput(params, 'Certification ID'),
  outputs: createSailPointResourceOutput(
    'certification',
    SAILPOINT_CERTIFICATION_OUTPUT_PROPERTIES,
    'SailPoint identity certification'
  ),
})

export const sailpointListCertificationsTool =
  defineSailPointTool<SailPointListCertificationsParams>({
    id: 'sailpoint_list_certifications',
    name: 'SailPoint List Certifications',
    description: 'List identity certifications assigned to a reviewer.',
    params: {
      ...sailpointCredentialParams,
      reviewerIdentity: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: "Reviewer identity ID or 'me'",
      },
      filters: FILTERS_PARAM,
      sorters: SORTERS_PARAM,
      ...sailpointPaginationParams,
    },
    input: (params) =>
      listInput(params, { reviewerIdentity: optionalNonEmptyString(params.reviewerIdentity) }),
    outputs: createSailPointListOutputs(
      SAILPOINT_CERTIFICATION_OUTPUT_PROPERTIES,
      'Identity certifications in this page'
    ),
  })

export const sailpointListCertificationReviewItemsTool =
  defineSailPointTool<SailPointListReviewItemsParams>({
    id: 'sailpoint_list_certification_review_items',
    name: 'SailPoint List Certification Review Items',
    description: 'List access-review items in one identity certification.',
    params: {
      ...sailpointCredentialParams,
      id: { ...ID_PARAM, description: 'Certification ID' },
      filters: FILTERS_PARAM,
      sorters: SORTERS_PARAM,
      entitlements: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated entitlement IDs',
      },
      accessProfiles: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated access profile IDs',
      },
      roles: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated role IDs',
      },
      ...sailpointPaginationParams,
    },
    input: (params) => ({
      ...(() => {
        const selected = [params.entitlements, params.accessProfiles, params.roles].filter(
          (value) => value !== undefined && value.trim() !== ''
        )
        if (selected.length > 1) {
          throw new Error('entitlements, accessProfiles, and roles are mutually exclusive')
        }
        return listInput(params, {
          entitlements: optionalNonEmptyString(params.entitlements),
          accessProfiles: optionalNonEmptyString(params.accessProfiles),
          roles: optionalNonEmptyString(params.roles),
        })
      })(),
      id: requireNonEmptyString(params.id, 'Certification ID'),
    }),
    outputs: createSailPointListOutputs(
      SAILPOINT_REVIEW_ITEM_OUTPUT_PROPERTIES,
      'Certification access-review items in this page'
    ),
  })

function normalizeCertificationDecisions(
  value: SailPointCertificationDecision[] | string
): SailPointCertificationDecision[] {
  const decisions = parseJsonValue<SailPointCertificationDecision[]>(value, 'decisions')
  if (!Array.isArray(decisions) || decisions.length < 1 || decisions.length > 250) {
    throw new Error('decisions must contain between 1 and 250 review decisions')
  }
  return decisions.map((decision, index) => {
    if (!decision || typeof decision !== 'object') {
      throw new Error(`decisions[${index}] must be an object`)
    }
    const id = requireNonEmptyString(decision.id, `decisions[${index}].id`)
    if (decision.decision !== 'APPROVE' && decision.decision !== 'REVOKE') {
      throw new Error(`decisions[${index}].decision must be APPROVE or REVOKE`)
    }
    if (typeof decision.bulk !== 'boolean') {
      throw new Error(`decisions[${index}].bulk must be a boolean`)
    }
    return { ...decision, id }
  })
}

export const sailpointDecideCertificationReviewItemsTool =
  defineSailPointTool<SailPointDecideCertificationReviewItemsParams>({
    id: 'sailpoint_decide_certification_review_items',
    name: 'SailPoint Decide Certification Review Items',
    description: 'Approve or revoke 1-250 review items in an identity certification.',
    params: {
      ...sailpointCredentialParams,
      id: { ...ID_PARAM, description: 'Certification ID' },
      decisions: {
        type: 'json',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Array of {id, decision: APPROVE|REVOKE, bulk, proposedEndDate?, recommendation?, comments?}',
        items: {
          type: 'object',
          required: ['id', 'decision', 'bulk'],
          properties: {
            id: { type: 'string', minLength: 1 },
            decision: { type: 'string' },
            bulk: { type: 'boolean' },
            proposedEndDate: { type: 'string' },
            recommendation: { type: 'object', additionalProperties: false },
            comments: { type: 'string' },
          },
        },
      },
    },
    input: (params) => ({
      id: requireNonEmptyString(params.id, 'Certification ID'),
      decisions: normalizeCertificationDecisions(params.decisions),
    }),
    outputs: createSailPointResourceOutput(
      'certification',
      SAILPOINT_CERTIFICATION_OUTPUT_PROPERTIES,
      'Updated identity certification'
    ),
  })

export const sailpointSignOffCertificationTool = defineSailPointTool<SailPointGetByIdParams>({
  id: 'sailpoint_sign_off_certification',
  name: 'SailPoint Sign Off Certification',
  description: 'Sign off a completed identity certification.',
  params: {
    ...sailpointCredentialParams,
    id: { ...ID_PARAM, description: 'Certification ID' },
  },
  input: (params) => getInput(params, 'Certification ID'),
  outputs: createSailPointResourceOutput(
    'certification',
    SAILPOINT_CERTIFICATION_OUTPUT_PROPERTIES,
    'Signed-off identity certification'
  ),
})

export const sailpointGetTaskStatusTool = defineSailPointTool<SailPointGetByIdParams>({
  id: 'sailpoint_get_task_status',
  name: 'SailPoint Get Task Status',
  description: 'Get the current status of a SailPoint background task by ID.',
  params: { ...sailpointCredentialParams, id: { ...ID_PARAM, description: 'Task ID' } },
  input: (params) => getInput(params, 'Task ID'),
  outputs: createSailPointResourceOutput(
    'task',
    SAILPOINT_TASK_OUTPUT_PROPERTIES,
    'SailPoint task status'
  ),
})

function normalizeRequestedItemId<T extends { id: string; type: string }>(
  item: T,
  label: string
): T {
  if (!item || typeof item !== 'object') throw new Error(`${label} must be an object`)
  if (item.type !== 'ACCESS_PROFILE' && item.type !== 'ROLE' && item.type !== 'ENTITLEMENT') {
    throw new Error(`${label}.type must be ACCESS_PROFILE, ROLE, or ENTITLEMENT`)
  }
  return { ...item, id: requireNonEmptyString(item.id, `${label}.id`) }
}

function validateAccountSelection(
  selection: SailPointSourceItemRef[] | null | undefined,
  label: string
) {
  if (selection == null) return
  if (!Array.isArray(selection)) throw new Error(`${label} must be an array`)
  selection.forEach((source, sourceIndex) => {
    if (!source || typeof source !== 'object') {
      throw new Error(`${label}[${sourceIndex}] must be an object`)
    }
    if (source.sourceId !== undefined && source.sourceId !== null) {
      requireNonEmptyString(source.sourceId, `${label}[${sourceIndex}].sourceId`)
    }
    source.accounts?.forEach((account, accountIndex) => {
      if (!account.accountUuid && !account.nativeIdentity) {
        throw new Error(
          `${label}[${sourceIndex}].accounts[${accountIndex}] requires accountUuid or nativeIdentity`
        )
      }
    })
  })
}

function requestAccessInput(params: SailPointRequestAccessParams): Record<string, unknown> {
  const requestType = params.requestType ?? 'GRANT_ACCESS'
  if (
    requestType !== 'GRANT_ACCESS' &&
    requestType !== 'REVOKE_ACCESS' &&
    requestType !== 'MODIFY_ACCESS'
  ) {
    throw new Error('requestType must be GRANT_ACCESS, REVOKE_ACCESS, or MODIFY_ACCESS')
  }
  const requestedFor = normalizeStringList(params.requestedFor, 'requestedFor')
  const requestedItems = parseJsonValue(params.requestedItems, 'requestedItems')
  const requestedForWithRequestedItems = parseJsonValue(
    params.requestedForWithRequestedItems,
    'requestedForWithRequestedItems'
  )
  const clientMetadata = parseJsonValue(params.clientMetadata, 'clientMetadata')
  const hasFlat = requestedFor !== undefined || requestedItems !== undefined
  const hasNested = requestedForWithRequestedItems !== undefined

  if (hasFlat === hasNested) {
    throw new Error(
      'Provide either requestedFor + requestedItems or requestedForWithRequestedItems, but not both'
    )
  }

  if (hasFlat) {
    if (!requestedFor?.length || !Array.isArray(requestedItems) || requestedItems.length === 0) {
      throw new Error('requestedFor and at least one requestedItems entry are required together')
    }
    const normalizedItems = requestedItems.map((item, index) =>
      normalizeRequestedItemId(item, `requestedItems[${index}]`)
    )
    const entitlementCount = normalizedItems.filter((item) => item.type === 'ENTITLEMENT').length
    if (entitlementCount > 0 && (entitlementCount > 25 || requestedFor.length > 10)) {
      throw new Error('Entitlement requests allow at most 25 entitlements and 10 identities')
    }
    if (requestType === 'REVOKE_ACCESS') {
      if (requestedFor.length !== 1) {
        throw new Error('REVOKE_ACCESS requires exactly one identity')
      }
      if (normalizedItems.filter((item) => item.type === 'ENTITLEMENT').length > 1) {
        throw new Error('REVOKE_ACCESS allows at most one entitlement item')
      }
      normalizedItems.forEach((item, index) => {
        if (!item.comment?.trim()) {
          throw new Error(`REVOKE_ACCESS requires requestedItems[${index}].comment`)
        }
        if (item.startDate) {
          throw new Error(`REVOKE_ACCESS cannot include requestedItems[${index}].startDate`)
        }
      })
    }
    return { requestType, requestedFor, requestedItems: normalizedItems, clientMetadata }
  }

  if (
    !Array.isArray(requestedForWithRequestedItems) ||
    requestedForWithRequestedItems.length === 0
  ) {
    throw new Error('requestedForWithRequestedItems must contain at least one identity')
  }
  const identityTypes = new Set(
    requestedForWithRequestedItems.map((entry) => entry.identityType ?? 'HUMAN')
  )
  if (identityTypes.size > 1) throw new Error('Human and machine identities cannot be mixed')
  const isMachine = identityTypes.has('MACHINE')
  if (!isMachine && requestType === 'REVOKE_ACCESS') {
    throw new Error('Human REVOKE_ACCESS must use requestedFor and requestedItems')
  }
  if (isMachine && requestType === 'REVOKE_ACCESS' && requestedForWithRequestedItems.length !== 1) {
    throw new Error('Machine REVOKE_ACCESS requires exactly one machine identity')
  }

  const nestedEntitlementCount = requestedForWithRequestedItems.reduce(
    (total, entry) =>
      total + entry.requestedItems.filter((item) => item.type === 'ENTITLEMENT').length,
    0
  )
  if (
    nestedEntitlementCount > 0 &&
    (nestedEntitlementCount > 25 || requestedForWithRequestedItems.length > 10)
  ) {
    throw new Error('Entitlement requests allow at most 25 entitlements and 10 identities')
  }

  const normalizedNested = requestedForWithRequestedItems.map((entry, identityIndex) => {
    const identityId = requireNonEmptyString(
      entry.identityId,
      `requestedForWithRequestedItems[${identityIndex}].identityId`
    )
    if (!Array.isArray(entry.requestedItems) || entry.requestedItems.length === 0) {
      throw new Error(`requestedForWithRequestedItems[${identityIndex}].requestedItems is required`)
    }
    const items = entry.requestedItems.map((item, itemIndex) => {
      const label = `requestedForWithRequestedItems[${identityIndex}].requestedItems[${itemIndex}]`
      const normalized = normalizeRequestedItemId(item, label)
      validateAccountSelection(normalized.accountSelection, `${label}.accountSelection`)
      if (isMachine && normalized.type !== 'ENTITLEMENT') {
        throw new Error(`${label}.type must be ENTITLEMENT for machine identities`)
      }
      if (isMachine && requestType !== 'REVOKE_ACCESS' && !normalized.accountSelection?.length) {
        throw new Error(`${label}.accountSelection is required for machine grant/modify requests`)
      }
      if (
        isMachine &&
        requestType !== 'REVOKE_ACCESS' &&
        (normalized.accountSelection?.length !== 1 ||
          normalized.accountSelection[0].accounts?.length !== 1)
      ) {
        throw new Error(`${label}.accountSelection requires exactly one source and one account`)
      }
      if (isMachine && requestType === 'REVOKE_ACCESS' && normalized.accountSelection) {
        throw new Error(`${label}.accountSelection is not allowed for machine revoke requests`)
      }
      if (isMachine && normalized.formInstanceId) {
        throw new Error(`${label}.formInstanceId is not supported for machine identities`)
      }
      if (requestType === 'REVOKE_ACCESS' && !normalized.comment?.trim()) {
        throw new Error(`${label}.comment is required for REVOKE_ACCESS`)
      }
      if (requestType === 'REVOKE_ACCESS' && normalized.startDate) {
        throw new Error(`${label}.startDate is not allowed for REVOKE_ACCESS`)
      }
      if (
        isMachine &&
        requestType === 'MODIFY_ACCESS' &&
        !normalized.startDate &&
        !normalized.removeDate
      ) {
        throw new Error(`${label} requires startDate or removeDate for machine MODIFY_ACCESS`)
      }
      return normalized
    })
    return { ...entry, identityId, requestedItems: items }
  })
  return { requestType, requestedForWithRequestedItems: normalizedNested, clientMetadata }
}

export const sailpointRequestAccessTool = defineSailPointTool<SailPointRequestAccessParams>({
  id: 'sailpoint_request_access',
  name: 'SailPoint Request Access',
  description: 'Submit a current human or machine identity access request.',
  params: {
    ...sailpointCredentialParams,
    requestType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'GRANT_ACCESS (default), REVOKE_ACCESS, or MODIFY_ACCESS',
    },
    requestedFor: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Human identity IDs for the flat request shape',
      items: { type: 'string', minLength: 1 },
    },
    requestedItems: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Flat human request items',
      items: {
        type: 'object',
        required: ['type', 'id'],
        properties: {
          type: { type: 'string' },
          id: { type: 'string', minLength: 1 },
          comment: { type: 'string' },
          clientMetadata: { type: 'object', additionalProperties: true },
          startDate: { type: 'string' },
          removeDate: { type: 'string' },
          assignmentId: { type: 'string' },
          nativeIdentity: { type: 'string' },
          formInstanceId: { type: 'string' },
        },
      },
    },
    requestedForWithRequestedItems: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Per-identity request items for account selection and all machine identity requests',
      items: {
        type: 'object',
        required: ['identityId', 'requestedItems'],
        properties: {
          identityId: { type: 'string', minLength: 1 },
          identityType: { type: 'string' },
          requestedItems: { type: 'array' },
        },
      },
    },
    clientMetadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Arbitrary string-to-string metadata returned by related APIs',
    },
  },
  input: requestAccessInput,
  outputs: {
    accepted: sailpointAcceptedOutputs.accepted,
    status: sailpointAcceptedOutputs.status,
    newRequests: {
      type: 'array',
      description: 'New access request tracking records',
      items: { type: 'object', properties: SAILPOINT_ACCESS_REQUEST_TRACKING_PROPERTIES },
    },
    existingRequests: {
      type: 'array',
      description: 'Already-existing request tracking records',
      items: { type: 'object', properties: SAILPOINT_ACCESS_REQUEST_TRACKING_PROPERTIES },
    },
  },
})

export const sailpointCancelAccessRequestTool =
  defineSailPointTool<SailPointCancelAccessRequestParams>({
    id: 'sailpoint_cancel_access_request',
    name: 'SailPoint Cancel Access Request',
    description: 'Cancel an access request that has not passed approval.',
    params: {
      ...sailpointCredentialParams,
      accountActivityId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Account activity / identity request ID',
      },
      comment: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Cancellation reason',
      },
    },
    input: (params) => ({
      accountActivityId: requireNonEmptyString(params.accountActivityId, 'Account activity ID'),
      comment: requireNonEmptyString(params.comment, 'Comment'),
    }),
    outputs: sailpointAcceptedOutputs,
  })

export const sailpointGetAccessRequestStatusTool =
  defineSailPointTool<SailPointAccessRequestStatusParams>({
    id: 'sailpoint_get_access_request_status',
    name: 'SailPoint Get Access Request Status',
    description: 'List requested-item status records for access requests.',
    params: {
      ...sailpointCredentialParams,
      requestedFor: { type: 'string', required: false, visibility: 'user-or-llm' },
      requestedBy: { type: 'string', required: false, visibility: 'user-or-llm' },
      regardingIdentity: { type: 'string', required: false, visibility: 'user-or-llm' },
      assignedTo: { type: 'string', required: false, visibility: 'user-or-llm' },
      requestState: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'EXECUTING',
      },
      filters: FILTERS_PARAM,
      sorters: SORTERS_PARAM,
      ...sailpointPaginationParams,
    },
    input: (params) => {
      if (params.regardingIdentity && (params.requestedFor || params.requestedBy)) {
        throw new Error('regardingIdentity cannot be combined with requestedFor or requestedBy')
      }
      return listInput(params, {
        requestedFor: optionalNonEmptyString(params.requestedFor),
        requestedBy: optionalNonEmptyString(params.requestedBy),
        regardingIdentity: optionalNonEmptyString(params.regardingIdentity),
        assignedTo: optionalNonEmptyString(params.assignedTo),
        requestState: params.requestState,
      })
    },
    outputs: createSailPointListOutputs(
      SAILPOINT_ACCESS_REQUEST_STATUS_OUTPUT_PROPERTIES,
      'Requested item status records in this page'
    ),
  })

export const sailpointListPendingAccessRequestApprovalsTool =
  defineSailPointTool<SailPointListPendingApprovalsParams>({
    id: 'sailpoint_list_pending_access_request_approvals',
    name: 'SailPoint List Pending Access Request Approvals',
    description: 'List pending access-request approvals visible to the caller.',
    params: {
      ...sailpointCredentialParams,
      ownerId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: "Approval owner identity ID or 'me'; admins may omit it for all approvals",
      },
      filters: FILTERS_PARAM,
      sorters: SORTERS_PARAM,
      ...sailpointPaginationParams,
    },
    input: (params) => listInput(params, { ownerId: optionalNonEmptyString(params.ownerId) }),
    outputs: createSailPointListOutputs(
      SAILPOINT_PENDING_APPROVAL_OUTPUT_PROPERTIES,
      'Pending access-request approvals in this page'
    ),
  })

export const sailpointApproveAccessRequestTool =
  defineSailPointTool<SailPointApprovalDecisionParams>({
    id: 'sailpoint_approve_access_request',
    name: 'SailPoint Approve Access Request',
    description: 'Approve one pending access-request approval.',
    params: {
      ...sailpointCredentialParams,
      approvalId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Approval ID',
      },
      comment: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Optional reviewer comment',
      },
    },
    input: (params) => ({
      approvalId: requireNonEmptyString(params.approvalId, 'Approval ID'),
      comment: optionalNonEmptyString(params.comment),
    }),
    outputs: sailpointAcceptedOutputs,
  })

export const sailpointRejectAccessRequestTool = defineSailPointTool<SailPointRejectApprovalParams>({
  id: 'sailpoint_reject_access_request',
  name: 'SailPoint Reject Access Request',
  description: 'Reject one pending access-request approval with a reviewer comment.',
  params: {
    ...sailpointCredentialParams,
    approvalId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Approval ID',
    },
    comment: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Reviewer rejection comment',
    },
  },
  input: (params) => ({
    approvalId: requireNonEmptyString(params.approvalId, 'Approval ID'),
    comment: requireNonEmptyString(params.comment, 'Comment'),
  }),
  outputs: sailpointAcceptedOutputs,
})

export const sailpointLoadAccountsTool = defineSailPointTool<SailPointLoadAccountsParams>({
  id: 'sailpoint_load_accounts',
  name: 'SailPoint Load Accounts',
  description: 'Start account aggregation for a source, optionally using a CSV file.',
  params: {
    ...sailpointCredentialParams,
    sourceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Source ID',
    },
    file: {
      type: 'file',
      required: false,
      visibility: 'user-or-llm',
      description: 'Delimited-file source account CSV',
    },
    disableOptimization: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reprocess every account instead of using optimized aggregation',
    },
  },
  input: (params) => ({
    sourceId: requireNonEmptyString(params.sourceId, 'Source ID'),
    file: params.file,
    disableOptimization: params.disableOptimization,
  }),
  outputs: {
    success: { type: 'boolean', description: 'Whether SailPoint successfully created the task' },
    task: {
      type: 'object',
      description: 'Account aggregation task',
      properties: SAILPOINT_TASK_OUTPUT_PROPERTIES,
    },
  },
})

export const sailpointLoadEntitlementsTool = defineSailPointTool<SailPointLoadEntitlementsParams>({
  id: 'sailpoint_load_entitlements',
  name: 'SailPoint Load Entitlements',
  description: 'Start entitlement aggregation for a source, optionally using a CSV file.',
  params: {
    ...sailpointCredentialParams,
    sourceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Source ID',
    },
    file: {
      type: 'file',
      required: false,
      visibility: 'user-or-llm',
      description: 'Delimited-file source entitlement CSV',
    },
  },
  input: (params) => ({
    sourceId: requireNonEmptyString(params.sourceId, 'Source ID'),
    file: params.file,
  }),
  outputs: {
    task: {
      type: 'object',
      description: 'Entitlement aggregation task',
      properties: SAILPOINT_TASK_OUTPUT_PROPERTIES,
    },
  },
})
