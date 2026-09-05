import type {
  OracleEpmEdmGenerateRequestAttachmentParams,
  OracleEpmEdmGenerateRequestAttachmentResponse,
} from '@/tools/oracle_epm_enterprise_data_management/types'
import {
  edmAuthParams,
  edmOperationInput,
  edmOutputs,
  edmParam,
} from '@/tools/oracle_epm_enterprise_data_management/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmEdmGenerateRequestAttachmentTool: InternalToolConfig<
  OracleEpmEdmGenerateRequestAttachmentParams,
  OracleEpmEdmGenerateRequestAttachmentResponse
> = {
  id: 'oracle_epm_edm_generate_request_attachment',
  name: 'Oracle EDM Generate Request Attachment',
  description:
    'Generate an Excel request attachment and poll its job; Oracle does not document the generated attachment ID for automatic import chaining.',
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
    fileName: edmParam(
      'string',
      true,
      'Single Oracle staging, attachment, or output file name; no directory path'
    ),
    items: {
      ...edmParam(
        'array',
        true,
        'Attachment rows: each has viewpoint and data cells with header and value'
      ),
      minItems: 1,
      maxItems: 1000,
      items: {
        type: 'object',
        required: ['viewpoint', 'data'],
        properties: {
          viewpoint: { type: 'string' },
          data: {
            type: 'array',
            minItems: 1,
            maxItems: 100,
            items: {
              type: 'object',
              required: ['header', 'value'],
              properties: { header: { type: 'string' }, value: { type: 'string' } },
            },
          },
        },
      },
    },
    overwrite: edmParam(
      'boolean',
      false,
      'Whether to overwrite an existing generated request attachment; false is preserved'
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
    input: (params) => edmOperationInput('oracle_epm_edm_generate_request_attachment', params),
  },
  outputs: {
    jobId: edmOutputs.jobId,
    job: edmOutputs.job,
    completed: edmOutputs.completed,
    timedOut: edmOutputs.timedOut,
    result: edmOutputs.result,
  },
}
