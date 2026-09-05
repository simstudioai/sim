import type {
  OracleEpmEdmLoadViewpointParams,
  OracleEpmEdmLoadViewpointResponse,
} from '@/tools/oracle_epm_enterprise_data_management/types'
import {
  edmAuthParams,
  edmOperationInput,
  edmOutputs,
  edmParam,
} from '@/tools/oracle_epm_enterprise_data_management/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmEdmLoadViewpointTool: InternalToolConfig<
  OracleEpmEdmLoadViewpointParams,
  OracleEpmEdmLoadViewpointResponse
> = {
  id: 'oracle_epm_edm_load_viewpoint',
  name: 'Oracle EDM Load Viewpoint',
  description: 'Load a viewpoint from a staged or uploaded file using an explicit load mode.',
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
    purpose: edmParam('string', true, 'Purpose or reason for loading the viewpoint'),
    loadOption: edmParam(
      'string',
      true,
      'Required load mode; no provider default is applied. Allowed values: ReplaceNodes, Merge.'
    ),
    file: edmParam(
      'file',
      false,
      'One uploaded Sim UserFile; imports/loads may omit this to use an existing staged file'
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
  operation: { input: (params) => edmOperationInput('oracle_epm_edm_load_viewpoint', params) },
  outputs: {
    jobId: edmOutputs.jobId,
    job: edmOutputs.job,
    completed: edmOutputs.completed,
    timedOut: edmOutputs.timedOut,
    result: edmOutputs.result,
  },
}
