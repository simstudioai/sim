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

export const ociDocumentListJobOutputsTool: InternalToolConfig<
  OciDocumentParams,
  OciDocumentResponse
> = {
  id: 'oci_document_understanding_list_job_outputs',
  name: 'OCI Document Understanding List Job Outputs',
  description:
    'List one page of artifacts beneath the authenticated job’s output prefix. Requires Oracle Object Storage list access. Missing artifacts do not establish individual document failures.',
  version: '1.0.0',
  oauth: documentOAuth,
  params: {
    ...documentAuthParams,
    ...documentJobParams,
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Result limit; default 100, maximum 1000',
    },
    start: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Inclusive continuation name from nextStartWith',
    },
  },
  operation: { input: (params) => documentOperationInput(params, ['jobId', 'limit', 'start']) },
  outputs: {
    ...DOCUMENT_REQUEST_ID_OUTPUT,
    job: DOCUMENT_JOB_OUTPUT,
    objects: {
      type: 'array',
      description: 'Available artifacts',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Exact artifact object name' },
          size: { type: 'number', description: 'Object size in bytes', optional: true },
          etag: { type: 'string', description: 'Entity tag', optional: true },
          timeCreated: { type: 'string', description: 'Creation timestamp', optional: true },
        },
      },
    },
    nextStartWith: { type: 'string', description: 'Next inclusive listing start', nullable: true },
  },
}
