import {
  documentAuthParams,
  documentJobParams,
  documentOAuth,
  documentOperationInput,
  documentProjectionParams,
} from '@/tools/oci_document_understanding/shared'
import {
  DOCUMENT_ANALYSIS_OUTPUT,
  DOCUMENT_REQUEST_ID_OUTPUT,
  type OciDocumentParams,
  type OciDocumentResponse,
} from '@/tools/oci_document_understanding/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDocumentGetJobOutputTool: InternalToolConfig<
  OciDocumentParams,
  OciDocumentResponse
> = {
  id: 'oci_document_understanding_get_job_output',
  name: 'OCI Document Understanding Get Job Output',
  description:
    'Retrieve one job artifact with Oracle Object Storage read access. Project documented analysis JSON up to 32 MiB or persist a file up to 100 MiB. No automatic reanalysis or ZIP parsing.',
  version: '1.0.0',
  oauth: documentOAuth,
  params: {
    ...documentAuthParams,
    ...documentJobParams,
    ...documentProjectionParams,
    objectName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Exact name returned by List Job Outputs; must remain under this job’s prefix',
    },
    resultType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'structured (default) for analysis JSON or file for a persisted artifact',
    },
    ifMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional artifact ETag from listing',
    },
  },
  operation: {
    input: (params) =>
      documentOperationInput(params, [
        'jobId',
        'objectName',
        'resultType',
        'ifMatch',
        'pageNumbers',
        'maxPages',
        'maxOutputBytes',
        'includeWords',
        'includeGeometry',
      ]),
  },
  outputs: {
    ...DOCUMENT_REQUEST_ID_OUTPUT,
    jobId: { type: 'string', description: 'Processor job OCID' },
    analysis: { ...DOCUMENT_ANALYSIS_OUTPUT, optional: true },
    file: {
      type: 'file',
      description: 'Artifact persisted before the tool response',
      optional: true,
    },
  },
}
