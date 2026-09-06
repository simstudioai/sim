import {
  INSTANCE_OUTPUT_PROPERTIES,
  ociComputeOperationInput,
  type OciComputeListInstancesParams,
  type OciComputeResponse,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeListInstancesTool: InternalToolConfig<
  OciComputeListInstancesParams,
  OciComputeResponse
> = {
  id: 'oci_compute_list_instances',
  name: 'OCI Compute List instances',
  description:
    'List instances in OCI',
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
    compartmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Compartment OCID; use the destination for moves, parent for compartment listing, and root for capacity reports',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Maximum results in this page, 1–100; default 50',
    },
    page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Opaque continuation token from nextPage; empty pages can still have another token',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort by TIMECREATED or DISPLAYNAME',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort direction: ASC or DESC',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Display name; on list operations this is an exact provider filter',
    },
    availabilityDomain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Exact availability-domain name returned by OCI discovery',
    },
    lifecycleState: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Exact lifecycle-state filter supported by this resource',
    },
    capacityReservationId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Existing reservation OCID; an empty string opts out on direct launch or removes the reservation on update',
    },
  },
  operation: {
    input: (params) => ociComputeOperationInput(params, [
      'compartmentId',
      'limit',
      'page',
      'sortBy',
      'sortOrder',
      'displayName',
      'availabilityDomain',
      'lifecycleState',
      'capacityReservationId',
    ]),
  },
  outputs: {
    status: { type: 'number', description: 'OCI HTTP response status' },
    requestId: { type: 'string', description: 'Oracle request ID for correlation', nullable: true },
    etag: { type: 'string', description: 'Resource ETag when returned', nullable: true },
    nextPage: { type: 'string', description: 'Continuation token, including on empty pages', nullable: true },
    instances: {
      type: 'array',
      description: 'Instances in this page',
      items: { type: 'object', properties: INSTANCE_OUTPUT_PROPERTIES },
    },
  },
}

