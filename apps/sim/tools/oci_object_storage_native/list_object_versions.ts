import {
  createOciNativeOperationInput,
  ociNativeAuthParams,
  ociNativeOAuth,
} from '@/tools/oci_object_storage_native/shared'
import {
  OCI_NATIVE_OBJECT_VERSION_PROPERTIES,
  OCI_NATIVE_REQUEST_ID_OUTPUT,
  type OciObjectStorageNativeParams,
  type OciObjectStorageNativeResponse,
} from '@/tools/oci_object_storage_native/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociObjectStorageNativeListObjectVersionsTool: InternalToolConfig<
  OciObjectStorageNativeParams<'list_object_versions'>,
  OciObjectStorageNativeResponse<'list_object_versions'>
> = {
  id: 'oci_object_storage_native_list_object_versions',
  name: 'OCI Object Storage Native List Object Versions',
  description:
    'List one page of object versions and delete markers. Continue with nextPage as page. Requires OBJECT_INSPECT.',
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
    prefix: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exact object-name prefix; whitespace is significant',
    },
    start: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Inclusive object-name start; use nextStartWith here',
    },
    end: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exclusive object-name end',
    },
    startAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exclusive object-name start; do not use for nextStartWith',
    },
    delimiter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to / to group object prefixes',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'One-page result limit, default 100, maximum 1000',
    },
    page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque nextPage token from the previous response',
    },
  },
  operation: {
    input: (params) =>
      createOciNativeOperationInput(params, [
        'bucketName',
        'prefix',
        'start',
        'end',
        'startAfter',
        'delimiter',
        'limit',
        'page',
      ]),
  },
  outputs: {
    ...OCI_NATIVE_REQUEST_ID_OUTPUT,
    namespace: {
      type: 'string',
      description: 'Object Storage namespace',
    },
    bucketName: {
      type: 'string',
      description: 'Bucket name',
    },
    versions: {
      type: 'array',
      description: 'Object versions with versionId and isDeleteMarker',
      items: { type: 'object', properties: OCI_NATIVE_OBJECT_VERSION_PROPERTIES },
    },
    prefixes: {
      type: 'array',
      description: 'Common prefixes',
      items: { type: 'string' },
    },
    nextPage: {
      type: 'string',
      description: 'Opaque next-page token',
      nullable: true,
    },
  },
}
