import {
  INSTANCE_POOL_OUTPUT_PROPERTIES,
  ociComputeOperationInput,
  type OciComputeInstancePoolActionParams,
  type OciComputeResponse,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeInstancePoolActionTool: InternalToolConfig<
  OciComputeInstancePoolActionParams,
  OciComputeResponse
> = {
  id: 'oci_compute_instance_pool_action',
  name: 'OCI Compute Instance pool action',
  description:
    'Start, stop, or reset a pool’s instances; may interrupt workloads and affect charges',
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
    ifMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ETag from a previous get response; a conflict is returned instead of overwriting changed state',
    },
    action: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Instance action: START, STOP, SOFTSTOP, RESET, SOFTRESET, or REBOOTMIGRATE. Pools support the first five',
    },
  },
  operation: {
    input: (params) => ociComputeOperationInput(params, [
      'instancePoolId',
      'ifMatch',
      'action',
    ]),
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

