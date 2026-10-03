import { deriveDeliveryKey } from '@/lib/core/http/derive-key'
import { selectModelBoundFileInputPaths } from '@/lib/uploads/utils/model-input'
import {
  documentAnalysisParams,
  documentAuthParams,
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

interface DocumentSubmissionParams extends OciDocumentParams {
  _context?: { executionId?: string; blockId?: string; invocationId?: string }
}

export const ociDocumentCreateProcessorJobTool: InternalToolConfig<
  DocumentSubmissionParams,
  OciDocumentResponse
> = {
  id: 'oci_document_understanding_create_processor_job',
  name: 'OCI Document Understanding Create Processor Job',
  description:
    'Submit document analysis or searchable-PDF generation. Inline: 8 MB/five pages. Object Storage: 500 MB/2000 pages per document, at most 2000 documents and 500 KB request JSON. Results require Object Storage access.',
  version: '1.0.0',
  oauth: documentOAuth,
  params: {
    ...documentAuthParams,
    ...documentAnalysisParams,
    compartmentId: { ...documentAnalysisParams.compartmentId, required: true },
    outputLocation: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Existing output location: {namespaceName,bucketName,prefix}. Results use prefix/jobId/. ZIP output is disabled',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Job display name',
    },
    retryToken: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Stable submission token; derived from complete workflow invocation identity when omitted, otherwise generated per call. Supply explicitly for deliberate replays. At most 64 ASCII letters/digits/_/-. Reuse only for the identical request; expires after 24 hours and may be invalidated earlier',
    },
  },
  operation: {
    modelInput: {
      mode: 'private-provenance',
      inputPaths: (params) =>
        selectModelBoundFileInputPaths(params.file, ['file'], { includeInlineBase64: true }),
    },
    input: (params) => {
      const input = documentOperationInput(params, [
        'source',
        'file',
        'objects',
        'pageRange',
        'features',
        'compartmentId',
        'documentType',
        'language',
        'outputLocation',
        'displayName',
        'retryToken',
      ])
      const { executionId, blockId, invocationId } = params._context ?? {}
      /** Match Stripe's complete invocation identity; never collapse distinct loop iterations. */
      if (!params.retryToken && executionId && blockId && invocationId) {
        const toolId = 'oci_document_understanding_create_processor_job'
        input.retryToken = deriveDeliveryKey({ executionId, blockId, invocationId, toolId }, toolId)
      }
      return input
    },
  },
  outputs: {
    ...DOCUMENT_REQUEST_ID_OUTPUT,
    job: DOCUMENT_JOB_OUTPUT,
    retryToken: { type: 'string', description: 'Token used for this logical submission' },
  },
}
