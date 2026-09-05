import type {
  OracleEpmEdmImportRequestAttachmentParams,
  OracleEpmEdmImportRequestAttachmentResponse,
} from '@/tools/oracle_epm_enterprise_data_management/types'
import {
  edmAuthParams,
  edmOperationInput,
  edmOutputs,
  edmParam,
} from '@/tools/oracle_epm_enterprise_data_management/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmEdmImportRequestAttachmentTool: InternalToolConfig<
  OracleEpmEdmImportRequestAttachmentParams,
  OracleEpmEdmImportRequestAttachmentResponse
> = {
  id: 'oracle_epm_edm_import_request_attachment',
  name: 'Oracle EDM Import Request Attachment',
  description: 'Import named sheets from a saved request attachment and poll its job.',
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
    attachmentId: edmParam('string', true, 'Saved request attachment UUID'),
    sheetNames: {
      ...edmParam('array', true, 'Non-empty array of attachment sheet names to import'),
      minItems: 1,
      maxItems: 100,
      items: { type: 'string', minLength: 1, maxLength: 255 },
    },
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
    input: (params) => edmOperationInput('oracle_epm_edm_import_request_attachment', params),
  },
  outputs: {
    jobId: edmOutputs.jobId,
    job: edmOutputs.job,
    completed: edmOutputs.completed,
    timedOut: edmOutputs.timedOut,
    result: edmOutputs.result,
  },
}
