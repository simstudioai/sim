import {
  WORK_REQUEST_OUTPUT_PROPERTIES,
  ociComputeOperationInput,
  type OciComputeListWorkRequestsParams,
  type OciComputeResponse,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeListWorkRequestsTool: InternalToolConfig<
  OciComputeListWorkRequestsParams,
  OciComputeResponse
> = {
  id: 'oci_compute_list_work_requests',
  name: 'OCI Compute List work requests',
  description:
    'List work requests in OCI',
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
    compartmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Compartment OCID; use the destination for moves, parent for compartment listing, and root for capacity reports',
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
    resourceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter work requests by affected resource OCID',
    },
  },
  operation: {
    input: (params) => ociComputeOperationInput(params, [
      'compartmentId',
      'limit',
      'page',
      'resourceId',
    ]),
  },
  outputs: {
    status: { type: 'number', description: 'OCI HTTP response status' },
    requestId: { type: 'string', description: 'Oracle request ID for correlation', nullable: true },
    etag: { type: 'string', description: 'Resource ETag when returned', nullable: true },
    nextPage: { type: 'string', description: 'Continuation token, including on empty pages', nullable: true },
    workRequests: {
      type: 'array',
      description: 'Work Requests in this page',
      items: { type: 'object', properties: WORK_REQUEST_OUTPUT_PROPERTIES },
    },
  },
}

