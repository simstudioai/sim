import {
  WORK_REQUEST_ERROR_OUTPUT_PROPERTIES,
  ociComputeOperationInput,
  type OciComputeListWorkRequestErrorsParams,
  type OciComputeResponse,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeListWorkRequestErrorsTool: InternalToolConfig<
  OciComputeListWorkRequestErrorsParams,
  OciComputeResponse
> = {
  id: 'oci_compute_list_work_request_errors',
  name: 'OCI Compute List work request errors',
  description:
    'List work request errors in OCI',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci_compute', credentialKind: 'service-account' },
  params: {
    oauthCredential: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Authorized OCI signing-key credential ID',
    },
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'OCI region, such as us-ashburn-1; must remain in the credential realm',
    },
    accessToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description:
        'System-injected credential identity; never used as a bearer token',
    },
    workRequestId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Work request OCID returned by a supported asynchronous operation',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Maximum results in this page, 1–100; default 50',
    },
    page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Opaque continuation token from nextPage; empty pages can still have another token',
    },
  },
  operation: {
    input: (params) => ociComputeOperationInput(params, [
      'workRequestId',
      'limit',
      'page',
    ]),
  },
  outputs: {
    status: { type: 'number', description: 'OCI HTTP response status' },
    requestId: { type: 'string', description: 'Oracle request ID for correlation', nullable: true },
    etag: { type: 'string', description: 'Resource ETag when returned', nullable: true },
    nextPage: { type: 'string', description: 'Continuation token, including on empty pages', nullable: true },
    workRequestErrors: {
      type: 'array',
      description: 'Work Request Errors in this page',
      items: { type: 'object', properties: WORK_REQUEST_ERROR_OUTPUT_PROPERTIES },
    },
  },
}

