import {
  BOOT_VOLUME_ATTACHMENT_OUTPUT_PROPERTIES,
  type OciComputeListBootVolumeAttachmentsParams,
  type OciComputeResponse,
  ociComputeOperationInput,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeListBootVolumeAttachmentsTool: InternalToolConfig<
  OciComputeListBootVolumeAttachmentsParams,
  OciComputeResponse
> = {
  id: 'oci_compute_list_boot_volume_attachments',
  name: 'OCI Compute List Boot Volume Attachments',
  description: 'List boot volume attachments in OCI',
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
    instanceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Compute instance OCID',
    },
    availabilityDomain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Exact availability-domain name returned by OCI discovery',
    },
  },
  operation: {
    input: (params) =>
      ociComputeOperationInput(params, [
        'compartmentId',
        'limit',
        'page',
        'instanceId',
        'availabilityDomain',
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
    bootVolumeAttachments: {
      type: 'array',
      description: 'Boot Volume Attachments information returned by OCI',
      items: { type: 'object', properties: BOOT_VOLUME_ATTACHMENT_OUTPUT_PROPERTIES },
    },
  },
}
