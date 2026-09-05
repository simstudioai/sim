import type {
  OracleEpmEdmValidateViewpointParams,
  OracleEpmEdmValidateViewpointResponse,
} from '@/tools/oracle_epm_enterprise_data_management/types'
import {
  edmAuthParams,
  edmOperationInput,
  edmOutputs,
  edmParam,
} from '@/tools/oracle_epm_enterprise_data_management/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmEdmValidateViewpointTool: InternalToolConfig<
  OracleEpmEdmValidateViewpointParams,
  OracleEpmEdmValidateViewpointResponse
> = {
  id: 'oracle_epm_edm_validate_viewpoint',
  name: 'Oracle EDM Validate Viewpoint',
  description: 'Validate a viewpoint and retrieve its generated report after job completion.',
  version: '1.0.0',
  oauth: {
    required: true,
    provider: 'oracle-epm-enterprise-data-management',
    credentialKind: 'service-account',
    authoritativeParams: ['instanceUrl'],
  },
  params: {
    ...edmAuthParams,
    viewName: edmParam('string', true, 'View name; request queries accept one value'),
    viewpointName: edmParam('string', true, 'Viewpoint name'),
    fileName: edmParam(
      'string',
      true,
      'Single Oracle staging, attachment, or output file name; no directory path'
    ),
    requestNumber: edmParam('number', false, 'Positive Oracle request number, not request UUID'),
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
  operation: { input: (params) => edmOperationInput('oracle_epm_edm_validate_viewpoint', params) },
  outputs: {
    jobId: edmOutputs.jobId,
    job: edmOutputs.job,
    completed: edmOutputs.completed,
    timedOut: edmOutputs.timedOut,
    result: edmOutputs.result,
    file: edmOutputs.file,
    fileName: edmOutputs.fileName,
  },
}
