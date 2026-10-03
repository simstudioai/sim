import {
  AVAILABILITY_DOMAIN_OUTPUT_PROPERTIES,
  type OciComputeListAvailabilityDomainsParams,
  type OciComputeResponse,
  ociComputeOperationInput,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeListAvailabilityDomainsTool: InternalToolConfig<
  OciComputeListAvailabilityDomainsParams,
  OciComputeResponse
> = {
  id: 'oci_compute_list_availability_domains',
  name: 'OCI Compute List Availability Domains',
  description: 'List availability domains in OCI',
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
    availabilityDomains: {
      type: 'array',
      description: 'Availability Domains information returned by OCI',
      items: { type: 'object', properties: AVAILABILITY_DOMAIN_OUTPUT_PROPERTIES },
    },
  },
}
