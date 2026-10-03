import type {
  OracleEpmEdmTransitionRequestParams,
  OracleEpmEdmTransitionRequestResponse,
} from '@/tools/oracle_epm_enterprise_data_management/types'
import {
  edmAuthParams,
  edmOperationInput,
  edmOutputs,
  edmParam,
} from '@/tools/oracle_epm_enterprise_data_management/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmEdmTransitionRequestTool: InternalToolConfig<
  OracleEpmEdmTransitionRequestParams,
  OracleEpmEdmTransitionRequestResponse
> = {
  id: 'oracle_epm_edm_transition_request',
  name: 'Oracle EDM Transition Request',
  description: 'Perform a documented request workflow action and optionally wait for completion.',
  version: '1.0.0',
  oauth: {
    required: true,
    provider: 'oracle-epm-enterprise-data-management',
    credentialKind: 'service-account',
    authoritativeParams: ['instanceUrl'],
  },
  params: {
    ...edmAuthParams,
    requestId: edmParam('string', true, 'Request UUID; for node listing it requires request scope'),
    action: edmParam(
      'string',
      true,
      'Requested workflow action; inspect validTransitionActions before choosing. Allowed values: SUBMIT, APPROVE, PUSHBACK, REJECT, WITHDRAW, RECALL, COMMIT, CLOSE.'
    ),
    comment: edmParam('string', false, 'Workflow or assignment comment'),
    transitionWithWarning: edmParam(
      'boolean',
      false,
      'Whether to allow the transition with validation warnings; false is preserved'
    ),
    waitForCompletion: edmParam(
      'boolean',
      false,
      'Wait for the Oracle job (default true); false returns the job ID immediately'
    ),
    maxWaitSeconds: edmParam(
      'number',
      false,
      'Maximum local wait (1-240 seconds; default 120); timeout does not cancel the remote job'
    ),
  },
  operation: { input: (params) => edmOperationInput('oracle_epm_edm_transition_request', params) },
  outputs: {
    jobId: edmOutputs.jobId,
    job: edmOutputs.job,
    completed: edmOutputs.completed,
    timedOut: edmOutputs.timedOut,
    result: edmOutputs.result,
  },
}
