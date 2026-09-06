import {
  POOL_INSTANCE_OUTPUT_PROPERTIES,
  ociComputeOperationInput,
  type OciComputeAttachInstancePoolInstanceParams,
  type OciComputeResponse,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeAttachInstancePoolInstanceTool: InternalToolConfig<
  OciComputeAttachInstancePoolInstanceParams,
  OciComputeResponse
> = {
  id: 'oci_compute_attach_instance_pool_instance',
  name: 'OCI Compute Attach instance pool instance',
  description:
    'Attach an eligible existing instance to a pool and return membership status',
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
    instancePoolId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Instance pool OCID',
    },
    instanceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Compute instance OCID',
    },
  },
  operation: {
    input: (params) => ociComputeOperationInput(params, [
      'instancePoolId',
      'instanceId',
    ]),
  },
  outputs: {
    status: { type: 'number', description: 'OCI HTTP response status' },
    requestId: { type: 'string', description: 'Oracle request ID for correlation', nullable: true },
    etag: { type: 'string', description: 'Resource ETag when returned', nullable: true },
    workRequestId: { type: 'string', description: 'Work request OCID when returned; use status tools', nullable: true },
    location: { type: 'string', description: 'Provider resource location; not followed automatically', nullable: true },
    poolInstance: {
      type: 'json',
      description: 'Pool Instance information returned by OCI',
      properties: POOL_INSTANCE_OUTPUT_PROPERTIES,
    },
  },
}

