import type {
  OracleEpmEdmIncrementalExportDimensionParams,
  OracleEpmEdmIncrementalExportDimensionResponse,
} from '@/tools/oracle_epm_enterprise_data_management/types'
import {
  edmAuthParams,
  edmOperationInput,
  edmOutputs,
  edmParam,
} from '@/tools/oracle_epm_enterprise_data_management/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmEdmIncrementalExportDimensionTool: InternalToolConfig<
  OracleEpmEdmIncrementalExportDimensionParams,
  OracleEpmEdmIncrementalExportDimensionResponse
> = {
  id: 'oracle_epm_edm_incremental_export_dimension',
  name: 'Oracle EDM Incremental Export Dimension',
  description: 'Export new or updated dimension nodes since a timestamp or a previous export.',
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
    bindingNames: {
      ...edmParam('array', true, 'Non-empty array of dimension binding names'),
      minItems: 1,
      maxItems: 100,
      items: { type: 'string', minLength: 1, maxLength: 255 },
    },
    nodeChangeTypes: {
      ...edmParam('array', true, 'Node changes to export: NEW, UPDATED, or both'),
      minItems: 1,
      maxItems: 2,
      items: { anyOf: [{ const: 'NEW' }, { const: 'UPDATED' }] },
    },
    since: edmParam(
      'number',
      false,
      'Raw Oracle incremental timestamp; units are undocumented. Supply a tenant-confirmed value or use sinceLastExportOfType; no conversion is applied'
    ),
    sinceLastExportOfType: edmParam(
      'string',
      false,
      'Use a previous export as the incremental boundary; mutually exclusive with since. Allowed values: FULL, INCREMENTAL.'
    ),
    connectionName: edmParam(
      'string',
      false,
      'Configured Oracle connection name; omit to export to staging and return a Sim file'
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
  operation: {
    input: (params) => edmOperationInput('oracle_epm_edm_incremental_export_dimension', params),
  },
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
