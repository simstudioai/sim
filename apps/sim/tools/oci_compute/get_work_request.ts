import {
  type OciComputeGetWorkRequestParams,
  type OciComputeResponse,
  WORK_REQUEST_OUTPUT_PROPERTIES,
  ociComputeOperationInput,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeGetWorkRequestTool: InternalToolConfig<
  OciComputeGetWorkRequestParams,
  OciComputeResponse
> = {
  id: 'oci_compute_get_work_request',
  name: 'OCI Compute Get Work Request',
  description: 'Get work request in OCI',
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
  },
  operation: {
    input: (params) => ociComputeOperationInput(params, ['workRequestId']),
  },
  outputs: {
    status: { type: 'number', description: 'OCI HTTP response status' },
    requestId: { type: 'string', description: 'Oracle request ID for correlation', nullable: true },
    etag: { type: 'string', description: 'Resource ETag when returned', nullable: true },
    workRequest: {
      type: 'json',
      description: 'Work Request information returned by OCI',
      properties: WORK_REQUEST_OUTPUT_PROPERTIES,
    },
  },
}
