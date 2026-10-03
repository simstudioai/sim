import {
  COMPATIBILITY_ENTRY_OUTPUT_PROPERTIES,
  type OciComputeGetImageShapeCompatibilityEntryParams,
  type OciComputeResponse,
  ociComputeOperationInput,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeGetImageShapeCompatibilityEntryTool: InternalToolConfig<
  OciComputeGetImageShapeCompatibilityEntryParams,
  OciComputeResponse
> = {
  id: 'oci_compute_get_image_shape_compatibility_entry',
  name: 'OCI Compute Get Image Shape Compatibility Entry',
  description: 'Get image shape compatibility entry in OCI',
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
    shape: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Compute shape name; image, capacity, and shape compatibility are validated by OCI',
    },
  },
  operation: {
    input: (params) => ociComputeOperationInput(params, ['imageId', 'shape']),
  },
  outputs: {
    status: { type: 'number', description: 'OCI HTTP response status' },
    requestId: { type: 'string', description: 'Oracle request ID for correlation', nullable: true },
    etag: { type: 'string', description: 'Resource ETag when returned', nullable: true },
    compatibilityEntry: {
      type: 'json',
      description: 'Compatibility Entry information returned by OCI',
      properties: COMPATIBILITY_ENTRY_OUTPUT_PROPERTIES,
    },
  },
}
