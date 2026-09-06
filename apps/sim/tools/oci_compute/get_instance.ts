import {
  INSTANCE_OUTPUT_PROPERTIES,
  ociComputeOperationInput,
  type OciComputeGetInstanceParams,
  type OciComputeResponse,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeGetInstanceTool: InternalToolConfig<
  OciComputeGetInstanceParams,
  OciComputeResponse
> = {
  id: 'oci_compute_get_instance',
  name: 'OCI Compute Get instance',
  description:
    'Get instance in OCI',
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
      'instanceId',
    ]),
  },
  outputs: {
    status: { type: 'number', description: 'OCI HTTP response status' },
    requestId: { type: 'string', description: 'Oracle request ID for correlation', nullable: true },
    etag: { type: 'string', description: 'Resource ETag when returned', nullable: true },
    instance: {
      type: 'json',
      description: 'Instance information returned by OCI',
      properties: INSTANCE_OUTPUT_PROPERTIES,
    },
  },
}

