import {
  FAULT_DOMAIN_OUTPUT_PROPERTIES,
  type OciComputeListFaultDomainsParams,
  type OciComputeResponse,
  ociComputeOperationInput,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeListFaultDomainsTool: InternalToolConfig<
  OciComputeListFaultDomainsParams,
  OciComputeResponse
> = {
  id: 'oci_compute_list_fault_domains',
  name: 'OCI Compute List Fault Domains',
  description: 'List fault domains in OCI',
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
    availabilityDomain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Exact availability-domain name returned by OCI discovery',
    },
  },
  operation: {
    input: (params) => ociComputeOperationInput(params, ['compartmentId', 'availabilityDomain']),
  },
  outputs: {
    status: { type: 'number', description: 'OCI HTTP response status' },
    requestId: { type: 'string', description: 'Oracle request ID for correlation', nullable: true },
    etag: { type: 'string', description: 'Resource ETag when returned', nullable: true },
    faultDomains: {
      type: 'array',
      description: 'Fault Domains information returned by OCI',
      items: { type: 'object', properties: FAULT_DOMAIN_OUTPUT_PROPERTIES },
    },
  },
}
