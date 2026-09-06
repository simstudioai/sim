import {
  IMAGE_OUTPUT_PROPERTIES,
  ociComputeOperationInput,
  type OciComputeGetImageParams,
  type OciComputeResponse,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeGetImageTool: InternalToolConfig<
  OciComputeGetImageParams,
  OciComputeResponse
> = {
  id: 'oci_compute_get_image',
  name: 'OCI Compute Get image',
  description:
    'Get image in OCI',
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
    imageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Image OCID; required for image-ID launches',
    },
  },
  operation: {
    input: (params) => ociComputeOperationInput(params, [
      'imageId',
    ]),
  },
  outputs: {
    status: { type: 'number', description: 'OCI HTTP response status' },
    requestId: { type: 'string', description: 'Oracle request ID for correlation', nullable: true },
    etag: { type: 'string', description: 'Resource ETag when returned', nullable: true },
    image: {
      type: 'json',
      description: 'Image information returned by OCI',
      properties: IMAGE_OUTPUT_PROPERTIES,
    },
  },
}

