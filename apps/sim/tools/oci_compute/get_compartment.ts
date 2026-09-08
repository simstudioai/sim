import {
  COMPARTMENT_OUTPUT_PROPERTIES,
  type OciComputeGetCompartmentParams,
  type OciComputeResponse,
  ociComputeOperationInput,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeGetCompartmentTool: InternalToolConfig<
  OciComputeGetCompartmentParams,
  OciComputeResponse
> = {
  id: 'oci_compute_get_compartment',
  name: 'OCI Compute Get Compartment',
  description: 'Get compartment in OCI',
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
    compartmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Compartment OCID; use the destination for moves, parent for compartment listing, and root for capacity reports',
    },
  },
  operation: {
    input: (params) => ociComputeOperationInput(params, ['compartmentId']),
  },
  outputs: {
    status: { type: 'number', description: 'OCI HTTP response status' },
    requestId: { type: 'string', description: 'Oracle request ID for correlation', nullable: true },
    etag: { type: 'string', description: 'Resource ETag when returned', nullable: true },
    compartment: {
      type: 'json',
      description: 'Compartment information returned by OCI',
      properties: COMPARTMENT_OUTPUT_PROPERTIES,
    },
  },
}
