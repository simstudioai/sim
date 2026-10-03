import {
  documentAuthParams,
  documentJobParams,
  documentOAuth,
  documentOperationInput,
} from '@/tools/oci_document_understanding/shared'
import {
  DOCUMENT_REQUEST_ID_OUTPUT,
  type OciDocumentParams,
  type OciDocumentResponse,
} from '@/tools/oci_document_understanding/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDocumentCancelProcessorJobTool: InternalToolConfig<
  OciDocumentParams,
  OciDocumentResponse
> = {
  id: 'oci_document_understanding_cancel_processor_job',
  name: 'OCI Document Understanding Cancel Processor Job',
  description:
    'Request processor cancellation. The acknowledgement does not prove the job is canceled; read its status afterward.',
  version: '1.0.0',
  oauth: documentOAuth,
  params: {
    ...documentAuthParams,
    ...documentJobParams,
    ifMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional provider ETag condition',
    },
  },
  operation: { input: (params) => documentOperationInput(params, ['jobId', 'ifMatch']) },
  outputs: {
    ...DOCUMENT_REQUEST_ID_OUTPUT,
    jobId: { type: 'string', description: 'Processor job OCID' },
    cancellationRequested: {
      type: 'boolean',
      description: 'Oracle acknowledged the cancellation request',
    },
  },
}
