import {
  documentAuthParams,
  documentJobParams,
  documentOAuth,
  documentOperationInput,
} from '@/tools/oci_document_understanding/shared'
import {
  DOCUMENT_JOB_OUTPUT,
  DOCUMENT_REQUEST_ID_OUTPUT,
  type OciDocumentParams,
  type OciDocumentResponse,
} from '@/tools/oci_document_understanding/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDocumentGetProcessorJobTool: InternalToolConfig<
  OciDocumentParams,
  OciDocumentResponse
> = {
  id: 'oci_document_understanding_get_processor_job',
  name: 'OCI Document Understanding Get Processor Job',
  description:
    'Read processor status once. Use bounded workflow waits for polling; FAILED with PARTIALLY_SUCCEEDED can still have usable output artifacts.',
  version: '1.0.0',
  oauth: documentOAuth,
  params: { ...documentAuthParams, ...documentJobParams },
  operation: { input: (params) => documentOperationInput(params, ['jobId']) },
  outputs: {
    ...DOCUMENT_REQUEST_ID_OUTPUT,
    job: DOCUMENT_JOB_OUTPUT,
    etag: {
      type: 'string',
      optional: true,
      description: 'Job ETag for cancellation’s ifMatch precondition',
    },
  },
}
