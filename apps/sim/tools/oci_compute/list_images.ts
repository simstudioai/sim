import {
  IMAGE_OUTPUT_PROPERTIES,
  type OciComputeListImagesParams,
  type OciComputeResponse,
  ociComputeOperationInput,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeListImagesTool: InternalToolConfig<
  OciComputeListImagesParams,
  OciComputeResponse
> = {
  id: 'oci_compute_list_images',
  name: 'OCI Compute List Images',
  description: 'List images in OCI',
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
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum results in this page, 1–100; default 50',
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
      description: 'Sort by TIMECREATED or DISPLAYNAME',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort direction: ASC or DESC',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name; on list operations this is an exact provider filter',
    },
    operatingSystem: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exact image operating-system filter',
    },
    operatingSystemVersion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exact image operating-system-version filter',
    },
    shape: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Compute shape name; image, capacity, and shape compatibility are validated by OCI',
    },
    lifecycleState: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exact lifecycle-state filter supported by this resource',
    },
  },
  operation: {
    input: (params) =>
      ociComputeOperationInput(params, [
        'compartmentId',
        'limit',
        'page',
        'sortBy',
        'sortOrder',
        'displayName',
        'operatingSystem',
        'operatingSystemVersion',
        'shape',
        'lifecycleState',
      ]),
  },
  outputs: {
    status: { type: 'number', description: 'OCI HTTP response status' },
    requestId: { type: 'string', description: 'Oracle request ID for correlation', nullable: true },
    etag: { type: 'string', description: 'Resource ETag when returned', nullable: true },
    nextPage: {
      type: 'string',
      description: 'Continuation token, including on empty pages',
      nullable: true,
    },
    images: {
      type: 'array',
      description: 'Images information returned by OCI',
      items: { type: 'object', properties: IMAGE_OUTPUT_PROPERTIES },
    },
  },
}
