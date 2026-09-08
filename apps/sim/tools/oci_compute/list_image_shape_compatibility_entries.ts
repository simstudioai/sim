import {
  COMPATIBILITY_ENTRY_OUTPUT_PROPERTIES,
  type OciComputeListImageShapeCompatibilityEntriesParams,
  type OciComputeResponse,
  ociComputeOperationInput,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeListImageShapeCompatibilityEntriesTool: InternalToolConfig<
  OciComputeListImageShapeCompatibilityEntriesParams,
  OciComputeResponse
> = {
  id: 'oci_compute_list_image_shape_compatibility_entries',
  name: 'OCI Compute List Image Shape Compatibility Entries',
  description: 'List image shape compatibility entries in OCI',
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
    imageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Image OCID; required for image-ID launches',
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
  },
  operation: {
    input: (params) => ociComputeOperationInput(params, ['imageId', 'limit', 'page']),
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
    compatibilityEntries: {
      type: 'array',
      description: 'Compatibility Entries information returned by OCI',
      items: { type: 'object', properties: COMPATIBILITY_ENTRY_OUTPUT_PROPERTIES },
    },
  },
}
