import {
  INSTANCE_POOL_OUTPUT_PROPERTIES,
  type OciComputeGetInstancePoolParams,
  type OciComputeResponse,
  ociComputeOperationInput,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeGetInstancePoolTool: InternalToolConfig<
  OciComputeGetInstancePoolParams,
  OciComputeResponse
> = {
  id: 'oci_compute_get_instance_pool',
  name: 'OCI Compute Get Instance Pool',
  description: 'Get instance pool in OCI',
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
    instancePoolId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Instance pool OCID',
    },
  },
  operation: {
    input: (params) => ociComputeOperationInput(params, ['instancePoolId']),
  },
  outputs: {
    status: { type: 'number', description: 'OCI HTTP response status' },
    requestId: { type: 'string', description: 'Oracle request ID for correlation', nullable: true },
    etag: { type: 'string', description: 'Resource ETag when returned', nullable: true },
    instancePool: {
      type: 'json',
      description: 'Instance Pool information returned by OCI',
      properties: INSTANCE_POOL_OUTPUT_PROPERTIES,
    },
  },
}
