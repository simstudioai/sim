import {
  type OciComputeListWorkRequestLogsParams,
  type OciComputeResponse,
  WORK_REQUEST_LOG_OUTPUT_PROPERTIES,
  ociComputeOperationInput,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeListWorkRequestLogsTool: InternalToolConfig<
  OciComputeListWorkRequestLogsParams,
  OciComputeResponse
> = {
  id: 'oci_compute_list_work_request_logs',
  name: 'OCI Compute List Work Request Logs',
  description: 'List work request logs in OCI',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci_compute', credentialKind: 'service-account' },
  params: {
    oauthCredential: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Authorized OCI signing-key credential ID',
    },
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'OCI region, such as us-ashburn-1; must remain in the credential realm',
    },
    accessToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'System-injected credential identity; never used as a bearer token',
    },
    workRequestId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Work request OCID returned by a supported asynchronous operation',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum results in this page, 1–100; default 50',
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
    input: (params) => ociComputeOperationInput(params, ['workRequestId', 'limit', 'page']),
  },
  outputs: {
    status: { type: 'number', description: 'OCI HTTP response status' },
    requestId: { type: 'string', description: 'Oracle request ID for correlation', nullable: true },
    etag: { type: 'string', description: 'Resource ETag when returned', nullable: true },
    nextPage: {
      type: 'string',
      description: 'Continuation token, including on empty pages',
      nullable: true,
    },
    workRequestLogs: {
      type: 'array',
      description: 'Work Request Logs information returned by OCI',
      items: { type: 'object', properties: WORK_REQUEST_LOG_OUTPUT_PROPERTIES },
    },
  },
}
