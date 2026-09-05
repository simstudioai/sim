import type {
  OracleEpmEdmExportDimensionParams,
  OracleEpmEdmExportDimensionResponse,
} from '@/tools/oracle_epm_enterprise_data_management/types'
import {
  edmAuthParams,
  edmOperationInput,
  edmOutputs,
  edmParam,
} from '@/tools/oracle_epm_enterprise_data_management/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmEdmExportDimensionTool: InternalToolConfig<
  OracleEpmEdmExportDimensionParams,
  OracleEpmEdmExportDimensionResponse
> = {
  id: 'oracle_epm_edm_export_dimension',
  name: 'Oracle EDM Export Dimension',
  description: 'Export a dimension to a configured connection or a stored Sim file.',
  version: '1.0.0',
  oauth: {
    required: true,
    provider: 'oracle-epm-enterprise-data-management',
    credentialKind: 'service-account',
    authoritativeParams: ['instanceUrl'],
  },
  params: {
    ...edmAuthParams,
    applicationName: edmParam(
      'string',
      true,
      "Exact application name for Oracle's byName endpoint"
    ),
    dimensionName: edmParam('string', true, "Exact dimension name for Oracle's byName endpoint"),
    fileName: edmParam(
      'string',
      true,
      'Single Oracle staging, attachment, or output file name; no directory path'
    ),
    connection: edmParam(
      'string',
      false,
      'Configured Oracle connection; omit to use staging and, for exports, return a Sim file'
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
  operation: { input: (params) => edmOperationInput('oracle_epm_edm_export_dimension', params) },
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
