import {
  INSTANCE_CONFIGURATION_OUTPUT_PROPERTIES,
  ociComputeOperationInput,
  type OciComputeGetInstanceConfigurationParams,
  type OciComputeResponse,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeGetInstanceConfigurationTool: InternalToolConfig<
  OciComputeGetInstanceConfigurationParams,
  OciComputeResponse
> = {
  id: 'oci_compute_get_instance_configuration',
  name: 'OCI Compute Get instance configuration',
  description:
    'Get instance configuration in OCI',
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
    instanceConfigurationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Instance configuration OCID',
    },
  },
  operation: {
    input: (params) => ociComputeOperationInput(params, [
      'instanceConfigurationId',
    ]),
  },
  outputs: {
    status: { type: 'number', description: 'OCI HTTP response status' },
    requestId: { type: 'string', description: 'Oracle request ID for correlation', nullable: true },
    etag: { type: 'string', description: 'Resource ETag when returned', nullable: true },
    instanceConfiguration: {
      type: 'json',
      description: 'Instance Configuration information returned by OCI',
      properties: INSTANCE_CONFIGURATION_OUTPUT_PROPERTIES,
    },
  },
}

