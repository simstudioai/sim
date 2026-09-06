import {
  INSTANCE_POOL_SUMMARY_OUTPUT_PROPERTIES,
  ociComputeOperationInput,
  type OciComputeListInstancePoolsParams,
  type OciComputeResponse,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeListInstancePoolsTool: InternalToolConfig<
  OciComputeListInstancePoolsParams,
  OciComputeResponse
> = {
  id: 'oci_compute_list_instance_pools',
  name: 'OCI Compute List instance pools',
  description:
    'List instance pools in OCI',
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
    lifecycleState: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Exact lifecycle-state filter supported by this resource',
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
      'lifecycleState',
    ]),
  },
  outputs: {
    status: { type: 'number', description: 'OCI HTTP response status' },
    requestId: { type: 'string', description: 'Oracle request ID for correlation', nullable: true },
    etag: { type: 'string', description: 'Resource ETag when returned', nullable: true },
    nextPage: { type: 'string', description: 'Continuation token, including on empty pages', nullable: true },
    instancePools: {
      type: 'array',
      description: 'Instance Pools in this page',
      items: { type: 'object', properties: INSTANCE_POOL_SUMMARY_OUTPUT_PROPERTIES },
    },
  },
}

