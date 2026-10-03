import {
  OCI_RULES_OUTPUTS,
  type OciEventsListRulesParams,
  type OciEventsResponse,
} from '@/tools/oci_events/types'
import { OCI_CONNECTION_PARAMS, transformOciEventsResponse } from '@/tools/oci_events/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociEventsListRulesTool: InternalToolConfig<
  OciEventsListRulesParams,
  OciEventsResponse
> = {
  id: 'oci_events_list_rules',
  name: 'OCI Events List Rules',
  description: 'List one page of OCI Events rules in a compartment',
  version: '1.0.0',
  params: {
    ...OCI_CONNECTION_PARAMS,
    compartmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Compartment OCID for listing or creating rules.',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum rules on this page: 1–50; defaults to 10.',
    },
    page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque nextPage from the preceding list response.',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Rule display name; list operations apply the OCI displayName filter.',
    },
    lifecycleState: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter: CREATING, ACTIVE, INACTIVE, UPDATING, DELETING, DELETED or FAILED.',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort field: TIME_CREATED, ID or DISPLAY_NAME.',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort direction: ASC or DESC.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      opcRequestId: params.opcRequestId,
      compartmentId: params.compartmentId,
      limit: params.limit,
      page: params.page,
      displayName: params.displayName,
      lifecycleState: params.lifecycleState,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder,
    }),
  },
  transformResponse: transformOciEventsResponse,
  outputs: OCI_RULES_OUTPUTS,
}
