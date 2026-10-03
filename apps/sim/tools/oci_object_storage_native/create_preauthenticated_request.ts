import {
  createOciNativeOperationInput,
  ociNativeAuthParams,
  ociNativeOAuth,
} from '@/tools/oci_object_storage_native/shared'
import {
  OCI_NATIVE_PAR_PROPERTIES,
  OCI_NATIVE_REQUEST_ID_OUTPUT,
  type OciObjectStorageNativeParams,
  type OciObjectStorageNativeResponse,
} from '@/tools/oci_object_storage_native/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociObjectStorageNativeCreatePreauthenticatedRequestTool: InternalToolConfig<
  OciObjectStorageNativeParams<'create_preauthenticated_request'>,
  OciObjectStorageNativeResponse<'create_preauthenticated_request'>
> = {
  id: 'oci_object_storage_native_create_preauthenticated_request',
  name: 'OCI Object Storage Native Create Pre-Authenticated Request',
  description:
    'Grant unauthenticated access to an object, prefix, or bucket until an explicit expiry. Anyone holding accessUrl receives the chosen access. Listing defaults to Deny. Requires PAR_MANAGE and the creator permissions for the granted access.',
  version: '1.0.0',
  oauth: ociNativeOAuth,
  params: {
    ...ociNativeAuthParams,
    bucketName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'OCI bucket name',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Display name for the pre-authenticated access grant',
    },
    scope: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Required grant scope: object, prefix, or bucket',
    },
    accessType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'ObjectRead/ObjectWrite/ObjectReadWrite for object scope; AnyObjectRead/AnyObjectWrite/AnyObjectReadWrite for prefix or bucket scope',
    },
    timeExpires: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Required future ISO 8601 expiry timestamp with timezone',
    },
    objectName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exact object name; preserve spaces, Unicode, separators and percent characters',
    },
    bucketListingAction: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Deny (default) or ListObjects; listing requires bucket or prefix read scope',
    },
  },
  operation: {
    input: (params) =>
      createOciNativeOperationInput(params, [
        'bucketName',
        'name',
        'scope',
        'accessType',
        'timeExpires',
        'objectName',
        'bucketListingAction',
      ]),
  },
  outputs: {
    ...OCI_NATIVE_REQUEST_ID_OUTPUT,
    request: {
      type: 'object',
      description: 'Access grant identity, scope and expiry',
      properties: OCI_NATIVE_PAR_PROPERTIES,
    },
    accessUrl: {
      type: 'string',
      description: 'Sensitive unauthenticated access-grant URL; returned only at creation',
    },
  },
}
