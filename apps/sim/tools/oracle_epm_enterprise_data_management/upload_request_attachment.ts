import type {
  OracleEpmEdmUploadRequestAttachmentParams,
  OracleEpmEdmUploadRequestAttachmentResponse,
} from '@/tools/oracle_epm_enterprise_data_management/types'
import {
  edmAuthParams,
  edmOperationInput,
  edmOutputs,
  edmParam,
} from '@/tools/oracle_epm_enterprise_data_management/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmEdmUploadRequestAttachmentTool: InternalToolConfig<
  OracleEpmEdmUploadRequestAttachmentParams,
  OracleEpmEdmUploadRequestAttachmentResponse
> = {
  id: 'oracle_epm_edm_upload_request_attachment',
  name: 'Oracle EDM Upload Request Attachment',
  description: 'Upload one authorized Sim file as an EDM request attachment.',
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
    file: edmParam(
      'file',
      true,
      'One uploaded Sim UserFile; imports/loads may omit this to use an existing staged file'
    ),
    fileName: edmParam(
      'string',
      false,
      'Single Oracle staging, attachment, or output file name; no directory path'
    ),
  },
  operation: {
    input: (params) => edmOperationInput('oracle_epm_edm_upload_request_attachment', params),
  },
  outputs: {
    requestId: edmOutputs.requestId,
    fileName: edmOutputs.fileName,
    attachmentId: edmOutputs.attachmentId,
    attachmentUri: edmOutputs.attachmentUri,
  },
}
