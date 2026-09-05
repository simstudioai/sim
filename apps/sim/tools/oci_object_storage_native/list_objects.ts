import {
  createOciNativeOperationInput,
  ociNativeAuthParams,
  ociNativeOAuth,
} from '@/tools/oci_object_storage_native/shared'
import {
  OCI_NATIVE_OBJECT_PROPERTIES,
  OCI_NATIVE_REQUEST_ID_OUTPUT,
  type OciObjectStorageNativeParams,
  type OciObjectStorageNativeResponse,
} from '@/tools/oci_object_storage_native/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociObjectStorageNativeListObjectsTool: InternalToolConfig<
  OciObjectStorageNativeParams<'list_objects'>,
  OciObjectStorageNativeResponse<'list_objects'>
> = {
  id: 'oci_object_storage_native_list_objects',
  name: 'OCI Object Storage Native List Objects',
  description:
    'List one page of objects and prefixes. Pass nextStartWith into start for the next page. Requires OBJECT_INSPECT.',
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
    objects: {
      type: 'array',
      description: 'Objects with name, size, etag, md5, timestamps, storageTier and archivalState',
      items: { type: 'object', properties: OCI_NATIVE_OBJECT_PROPERTIES },
    },
    prefixes: {
      type: 'array',
      description: 'Common prefixes for the delimiter',
      items: { type: 'string' },
    },
    nextStartWith: {
      type: 'string',
      description: 'Next inclusive start value',
      nullable: true,
    },
  },
}
