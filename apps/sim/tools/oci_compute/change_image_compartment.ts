import {
  ociComputeOperationInput,
  type OciComputeChangeImageCompartmentParams,
  type OciComputeResponse,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeChangeImageCompartmentTool: InternalToolConfig<
  OciComputeChangeImageCompartmentParams,
  OciComputeResponse
> = {
  id: 'oci_compute_change_image_compartment',
  name: 'OCI Compute Change image compartment',
  description:
    'Change image compartment in OCI',
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
    ifMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ETag from a previous get response; a conflict is returned instead of overwriting changed state',
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
    input: (params) => ociComputeOperationInput(params, [
      'imageId',
      'ifMatch',
      'compartmentId',
    ]),
  },
  outputs: {
    status: { type: 'number', description: 'OCI HTTP response status' },
    requestId: { type: 'string', description: 'Oracle request ID for correlation', nullable: true },
    etag: { type: 'string', description: 'Resource ETag when returned', nullable: true },
  },
}

