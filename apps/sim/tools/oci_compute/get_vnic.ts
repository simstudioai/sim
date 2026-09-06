import {
  type OciComputeGetVnicParams,
  type OciComputeResponse,
  ociComputeOperationInput,
  VNIC_OUTPUT_PROPERTIES,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeGetVnicTool: InternalToolConfig<
  OciComputeGetVnicParams,
  OciComputeResponse
> = {
  id: 'oci_compute_get_vnic',
  name: 'OCI Compute Get Vnic',
  description: 'Get vnic in OCI',
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
    vnicId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'VNIC OCID',
    },
  },
  operation: {
    input: (params) => ociComputeOperationInput(params, ['vnicId']),
  },
  outputs: {
    status: { type: 'number', description: 'OCI HTTP response status' },
    requestId: { type: 'string', description: 'Oracle request ID for correlation', nullable: true },
    etag: { type: 'string', description: 'Resource ETag when returned', nullable: true },
    vnic: {
      type: 'json',
      description: 'Vnic information returned by OCI',
      properties: VNIC_OUTPUT_PROPERTIES,
    },
  },
}
