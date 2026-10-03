import type {
  OracleEpmEdmQueryRequestsParams,
  OracleEpmEdmQueryRequestsResponse,
} from '@/tools/oracle_epm_enterprise_data_management/types'
import {
  edmAuthParams,
  edmOperationInput,
  edmOutputs,
  edmParam,
} from '@/tools/oracle_epm_enterprise_data_management/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmEdmQueryRequestsTool: InternalToolConfig<
  OracleEpmEdmQueryRequestsParams,
  OracleEpmEdmQueryRequestsResponse
> = {
  id: 'oracle_epm_edm_query_requests',
  name: 'Oracle EDM Query Requests',
  description: 'Query requests using one value per filter and a maximum 90-day time window.',
  version: '1.0.0',
  oauth: {
    required: true,
    provider: 'oracle-epm-enterprise-data-management',
    credentialKind: 'service-account',
    authoritativeParams: ['instanceUrl'],
  },
  params: {
    ...edmAuthParams,
    lastDays: edmParam(
      'number',
      false,
      'Previous days to query (1-90; default 30 when no explicit dates are supplied)'
    ),
    fromDate: edmParam(
      'number',
      false,
      'Inclusive start in epoch seconds; provide with toDate, without lastDays, within 90 days'
    ),
    toDate: edmParam(
      'number',
      false,
      'End in epoch seconds; provide with fromDate, without lastDays, within 90 days'
    ),
    myActivity: edmParam(
      'string',
      false,
      'One activity filter. Allowed values: Assigned, Collaborated, Submitted, Invited, Contributed, Managed.'
    ),
    owner: edmParam('string', false, 'One request owner name'),
    priority: edmParam(
      'string',
      false,
      'One request priority filter. Allowed values: None, Low, Medium, High.'
    ),
    requestNumber: edmParam('number', false, 'Positive Oracle request number, not request UUID'),
    requestType: edmParam(
      'string',
      false,
      'One request-type filter. Allowed values: Interactive, Subscription, Import, Consolidation.'
    ),
    stage: edmParam(
      'string',
      false,
      'One request-stage query filter, using Oracle query spelling. Allowed values: Submit, Approved, Commit, Closed.'
    ),
    status: edmParam(
      'string',
      false,
      'One request-status query filter. Allowed values: Draft, In Flight, Recalled, Pushed Back, Completed, Rejected, Blocked, Consolidated.'
    ),
    timeLabelName: edmParam('string', false, 'Time label name; request queries support one value'),
    viewName: edmParam('string', false, 'View name; request queries accept one value'),
    expandWorkflow: edmParam(
      'boolean',
      false,
      'Include documented workflow information in request queries'
    ),
    maxResults: edmParam(
      'number',
      false,
      'Maximum projected items (1-500; default 200). This is a local result cap, not provider pagination.'
    ),
  },
  operation: { input: (params) => edmOperationInput('oracle_epm_edm_query_requests', params) },
  outputs: {
    requests: edmOutputs.requests,
  },
}
