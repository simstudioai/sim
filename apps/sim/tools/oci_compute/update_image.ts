import {
  IMAGE_OUTPUT_PROPERTIES,
  ociComputeOperationInput,
  type OciComputeUpdateImageParams,
  type OciComputeResponse,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeUpdateImageTool: InternalToolConfig<
  OciComputeUpdateImageParams,
  OciComputeResponse
> = {
  id: 'oci_compute_update_image',
  name: 'OCI Compute Update image',
  description:
    'Update image in OCI',
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
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Display name; on list operations this is an exact provider filter',
    },
    freeformTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Free-form tags as a string-to-string JSON map',
    },
    definedTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Defined string tags grouped by namespace, for example {Operations: {CostCenter: "42"}}',
    },
    ifMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ETag from a previous get response; a conflict is returned instead of overwriting changed state',
    },
  },
  operation: {
    input: (params) => ociComputeOperationInput(params, [
      'imageId',
      'displayName',
      'freeformTags',
      'definedTags',
      'ifMatch',
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

