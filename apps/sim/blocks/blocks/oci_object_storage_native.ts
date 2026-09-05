import { NetSuiteIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import { normalizeFileInput, parseOptionalNumberInput } from '@/blocks/utils'
import type { OciObjectStorageNativeResponse } from '@/tools/oci_object_storage_native/types'

const OPERATION_FIELDS: Record<string, readonly string[]> = {
  oci_object_storage_native_abort_multipart_upload: ['bucketName', 'objectName', 'uploadId'],
  oci_object_storage_native_batch_delete_objects: ['bucketName', 'objects', 'isSkipDeletedResult'],
  oci_object_storage_native_commit_multipart_upload: [
    'bucketName',
    'objectName',
    'uploadId',
    'partsToCommit',
    'ifMatch',
    'ifNoneMatch',
    'partsToExclude',
  ],
  oci_object_storage_native_copy_object: [
    'bucketName',
    'objectName',
    'destinationRegion',
    'destinationNamespace',
    'destinationBucket',
    'destinationObjectName',
    'sourceVersionId',
    'sourceObjectIfMatchETag',
    'destinationObjectIfMatchETag',
    'destinationObjectIfNoneMatchETag',
    'destinationObjectMetadata',
    'destinationObjectStorageTier',
  ],
  oci_object_storage_native_create_bucket: [
    'bucketName',
    'compartmentId',
    'metadata',
    'freeformTags',
    'definedTags',
    'autoTiering',
    'objectEventsEnabled',
    'versioning',
    'storageTier',
  ],
  oci_object_storage_native_create_multipart_upload: [
    'bucketName',
    'objectName',
    'contentType',
    'contentLanguage',
    'contentEncoding',
    'contentDisposition',
    'cacheControl',
    'ifMatch',
    'ifNoneMatch',
    'metadata',
    'storageTier',
  ],
  oci_object_storage_native_create_preauthenticated_request: [
    'bucketName',
    'name',
    'scope',
    'accessType',
    'timeExpires',
    'objectName',
    'bucketListingAction',
  ],
  oci_object_storage_native_delete_bucket: ['bucketName', 'ifMatch'],
  oci_object_storage_native_delete_lifecycle_policy: ['bucketName', 'ifMatch'],
  oci_object_storage_native_delete_object: ['bucketName', 'objectName', 'versionId', 'ifMatch'],
  oci_object_storage_native_delete_preauthenticated_request: ['bucketName', 'parId'],
  oci_object_storage_native_download_object: ['bucketName', 'objectName', 'versionId', 'ifMatch'],
  oci_object_storage_native_get_bucket: ['bucketName', 'ifMatch'],
  oci_object_storage_native_get_lifecycle_policy: ['bucketName'],
  oci_object_storage_native_get_namespace: ['compartmentId'],
  oci_object_storage_native_get_preauthenticated_request: ['bucketName', 'parId'],
  oci_object_storage_native_get_work_request: ['workRequestId'],
  oci_object_storage_native_head_object: ['bucketName', 'objectName', 'versionId', 'ifMatch'],
  oci_object_storage_native_list_buckets: ['compartmentId', 'limit', 'page'],
  oci_object_storage_native_list_multipart_parts: [
    'bucketName',
    'objectName',
    'uploadId',
    'limit',
    'page',
  ],
  oci_object_storage_native_list_multipart_uploads: ['bucketName', 'limit', 'page'],
  oci_object_storage_native_list_object_versions: [
    'bucketName',
    'prefix',
    'start',
    'end',
    'startAfter',
    'delimiter',
    'limit',
    'page',
  ],
  oci_object_storage_native_list_objects: [
    'bucketName',
    'prefix',
    'start',
    'end',
    'startAfter',
    'delimiter',
    'limit',
  ],
  oci_object_storage_native_list_preauthenticated_requests: [
    'bucketName',
    'limit',
    'page',
    'objectNamePrefix',
  ],
  oci_object_storage_native_put_lifecycle_policy: ['bucketName', 'rules', 'ifMatch', 'ifNoneMatch'],
  oci_object_storage_native_rename_object: [
    'bucketName',
    'objectName',
    'newName',
    'srcObjIfMatchETag',
    'newObjIfMatchETag',
    'newObjIfNoneMatchETag',
  ],
  oci_object_storage_native_restore_object: ['bucketName', 'objectName', 'versionId', 'hours'],
  oci_object_storage_native_update_bucket: [
    'bucketName',
    'metadata',
    'freeformTags',
    'definedTags',
    'autoTiering',
    'objectEventsEnabled',
    'versioning',
    'ifMatch',
  ],
  oci_object_storage_native_update_object_storage_tier: [
    'bucketName',
    'objectName',
    'storageTier',
    'versionId',
  ],
  oci_object_storage_native_upload_object: [
    'bucketName',
    'objectName',
    'file',
    'content',
    'contentType',
    'contentLanguage',
    'contentEncoding',
    'contentDisposition',
    'cacheControl',
    'ifMatch',
    'ifNoneMatch',
    'metadata',
    'storageTier',
    'contentMd5',
  ],
  oci_object_storage_native_upload_part: [
    'bucketName',
    'objectName',
    'uploadId',
    'partNumber',
    'file',
    'content',
    'contentType',
    'contentMd5',
    'ifMatch',
    'ifNoneMatch',
  ],
}

export const OciObjectStorageNativeBlock: BlockConfig<OciObjectStorageNativeResponse> = {
  type: 'oci_object_storage_native',
  name: 'OCI Object Storage (Native)',
  description:
    'Manage OCI buckets, objects, versions, lifecycle policies, multipart uploads and access grants',
  longDescription:
    'Use native OCI API signing-key credentials to discover namespaces and buckets, read and write objects, manage versions and archive restoration, replace lifecycle policies, complete multipart uploads, and deliberately grant or revoke pre-authenticated access. File transfers are limited to 100 MiB. Inline text must fit within the 8 MiB JSON request budget, including escaping and other fields. JSON responses are limited to 8 MiB and listings to one page of at most 1000 items. Bucket creation is private. Copy is asynchronous and returns a work-request ID. This integration coexists with the S3-compatible OCI integration and does not use Customer Secret Keys.',
  docsLink: 'https://docs.sim.ai/integrations/oci_object_storage_native',
  authMode: AuthMode.ApiKey,
  category: 'tools',
  integrationType: IntegrationType.Documents,
  bgColor: '#FFFFFF',
  icon: NetSuiteIcon,
  canvasPresentation: {
    defaultTitle: 'OCI Object Storage (Native)',
    sentences: {
      byOperation: {
        oci_object_storage_native_abort_multipart_upload: [
          { text: 'Abort Multipart Upload', field: 'newObjectName', core: true },
        ],
        oci_object_storage_native_batch_delete_objects: [
          { text: 'Batch Delete Objects', field: ['bucketSelector', 'bucketManual'], core: true },
        ],
        oci_object_storage_native_commit_multipart_upload: [
          { text: 'Commit Multipart Upload', field: 'newObjectName', core: true },
        ],
        oci_object_storage_native_copy_object: [
          { text: 'Copy Object', field: ['objectSelector', 'objectManual'], core: true },
        ],
        oci_object_storage_native_create_bucket: [
          { text: 'Create Bucket', field: 'newBucketName', core: true },
        ],
        oci_object_storage_native_create_multipart_upload: [
          { text: 'Create Multipart Upload', field: 'newObjectName', core: true },
        ],
        oci_object_storage_native_create_preauthenticated_request: [
          { text: 'Create Pre-Authenticated Request', field: 'name', core: true },
        ],
        oci_object_storage_native_delete_bucket: [
          { text: 'Delete Bucket', field: ['bucketSelector', 'bucketManual'], core: true },
        ],
        oci_object_storage_native_delete_lifecycle_policy: [
          {
            text: 'Delete Lifecycle Policy',
            field: ['bucketSelector', 'bucketManual'],
            core: true,
          },
        ],
        oci_object_storage_native_delete_object: [
          { text: 'Delete Object', field: ['objectSelector', 'objectManual'], core: true },
        ],
        oci_object_storage_native_delete_preauthenticated_request: [
          { text: 'Delete Pre-Authenticated Request', field: 'parId', core: true },
        ],
        oci_object_storage_native_download_object: [
          { text: 'Download Object', field: ['objectSelector', 'objectManual'], core: true },
        ],
        oci_object_storage_native_get_bucket: [
          { text: 'Get Bucket', field: ['bucketSelector', 'bucketManual'], core: true },
        ],
        oci_object_storage_native_get_lifecycle_policy: [
          { text: 'Get Lifecycle Policy', field: ['bucketSelector', 'bucketManual'], core: true },
        ],
        oci_object_storage_native_get_namespace: ['Get the OCI Object Storage namespace'],
        oci_object_storage_native_get_preauthenticated_request: [
          { text: 'Get Pre-Authenticated Request', field: 'parId', core: true },
        ],
        oci_object_storage_native_get_work_request: [
          { text: 'Get Work Request', field: 'workRequestId', core: true },
        ],
        oci_object_storage_native_head_object: [
          { text: 'Head Object', field: ['objectSelector', 'objectManual'], core: true },
        ],
        oci_object_storage_native_list_buckets: [
          { text: 'List Buckets', field: 'compartmentId', core: true },
        ],
        oci_object_storage_native_list_multipart_parts: [
          { text: 'List Multipart Parts', field: 'newObjectName', core: true },
        ],
        oci_object_storage_native_list_multipart_uploads: [
          { text: 'List Multipart Uploads', field: ['bucketSelector', 'bucketManual'], core: true },
        ],
        oci_object_storage_native_list_object_versions: [
          { text: 'List Object Versions', field: ['bucketSelector', 'bucketManual'], core: true },
        ],
        oci_object_storage_native_list_objects: [
          { text: 'List Objects', field: ['bucketSelector', 'bucketManual'], core: true },
        ],
        oci_object_storage_native_list_preauthenticated_requests: [
          {
            text: 'List Pre-Authenticated Requests',
            field: ['bucketSelector', 'bucketManual'],
            core: true,
          },
        ],
        oci_object_storage_native_put_lifecycle_policy: [
          { text: 'Put Lifecycle Policy', field: ['bucketSelector', 'bucketManual'], core: true },
        ],
        oci_object_storage_native_rename_object: [
          { text: 'Rename Object', field: ['objectSelector', 'objectManual'], core: true },
        ],
        oci_object_storage_native_restore_object: [
          { text: 'Restore Object', field: ['objectSelector', 'objectManual'], core: true },
        ],
        oci_object_storage_native_update_bucket: [
          { text: 'Update Bucket', field: ['bucketSelector', 'bucketManual'], core: true },
        ],
        oci_object_storage_native_update_object_storage_tier: [
          {
            text: 'Update Object Storage Tier',
            field: ['objectSelector', 'objectManual'],
            core: true,
          },
        ],
        oci_object_storage_native_upload_object: [
          { text: 'Upload Object', field: 'newObjectName', core: true },
        ],
        oci_object_storage_native_upload_part: [
          { text: 'Upload Part', field: 'newObjectName', core: true },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      required: true,
      options: [
        { label: 'Abort Multipart Upload', id: 'oci_object_storage_native_abort_multipart_upload' },
        { label: 'Batch Delete Objects', id: 'oci_object_storage_native_batch_delete_objects' },
        {
          label: 'Commit Multipart Upload',
          id: 'oci_object_storage_native_commit_multipart_upload',
        },
        { label: 'Copy Object', id: 'oci_object_storage_native_copy_object' },
        { label: 'Create Bucket', id: 'oci_object_storage_native_create_bucket' },
        {
          label: 'Create Multipart Upload',
          id: 'oci_object_storage_native_create_multipart_upload',
        },
        {
          label: 'Create Pre-Authenticated Request',
          id: 'oci_object_storage_native_create_preauthenticated_request',
        },
        { label: 'Delete Bucket', id: 'oci_object_storage_native_delete_bucket' },
        {
          label: 'Delete Lifecycle Policy',
          id: 'oci_object_storage_native_delete_lifecycle_policy',
        },
        { label: 'Delete Object', id: 'oci_object_storage_native_delete_object' },
        {
          label: 'Delete Pre-Authenticated Request',
          id: 'oci_object_storage_native_delete_preauthenticated_request',
        },
        { label: 'Download Object', id: 'oci_object_storage_native_download_object' },
        { label: 'Get Bucket', id: 'oci_object_storage_native_get_bucket' },
        { label: 'Get Lifecycle Policy', id: 'oci_object_storage_native_get_lifecycle_policy' },
        { label: 'Get Namespace', id: 'oci_object_storage_native_get_namespace' },
        {
          label: 'Get Pre-Authenticated Request',
          id: 'oci_object_storage_native_get_preauthenticated_request',
        },
        { label: 'Get Work Request', id: 'oci_object_storage_native_get_work_request' },
        { label: 'Head Object', id: 'oci_object_storage_native_head_object' },
        { label: 'List Buckets', id: 'oci_object_storage_native_list_buckets' },
        { label: 'List Multipart Parts', id: 'oci_object_storage_native_list_multipart_parts' },
        { label: 'List Multipart Uploads', id: 'oci_object_storage_native_list_multipart_uploads' },
        { label: 'List Object Versions', id: 'oci_object_storage_native_list_object_versions' },
        { label: 'List Objects', id: 'oci_object_storage_native_list_objects' },
        {
          label: 'List Pre-Authenticated Requests',
          id: 'oci_object_storage_native_list_preauthenticated_requests',
        },
        { label: 'Put Lifecycle Policy', id: 'oci_object_storage_native_put_lifecycle_policy' },
        { label: 'Rename Object', id: 'oci_object_storage_native_rename_object' },
        { label: 'Restore Object', id: 'oci_object_storage_native_restore_object' },
        { label: 'Update Bucket', id: 'oci_object_storage_native_update_bucket' },
        {
          label: 'Update Object Storage Tier',
          id: 'oci_object_storage_native_update_object_storage_tier',
        },
        { label: 'Upload Object', id: 'oci_object_storage_native_upload_object' },
        { label: 'Upload Part', id: 'oci_object_storage_native_upload_part' },
      ],
      value: () => 'oci_object_storage_native_list_objects',
    },
    {
      id: 'credential',
      title: 'OCI Account',
      type: 'oauth-input',
      serviceId: 'oci_object_storage_native',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
      placeholder: 'Select OCI API signing-key credential',
    },
    {
      id: 'manualCredential',
      title: 'OCI Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      required: true,
      placeholder: 'Enter credential ID',
    },
    {
      id: 'region',
      title: 'Region',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Default: credential region',
    },
    {
      id: 'namespace',
      title: 'Namespace',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Leave empty to discover namespace',
    },
    {
      id: 'compartmentId',
      title: 'Compartment OCID',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_abort_multipart_upload',
          'oci_object_storage_native_batch_delete_objects',
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_copy_object',
          'oci_object_storage_native_create_bucket',
          'oci_object_storage_native_create_multipart_upload',
          'oci_object_storage_native_create_preauthenticated_request',
          'oci_object_storage_native_delete_bucket',
          'oci_object_storage_native_delete_lifecycle_policy',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_delete_preauthenticated_request',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_get_bucket',
          'oci_object_storage_native_get_lifecycle_policy',
          'oci_object_storage_native_get_namespace',
          'oci_object_storage_native_get_preauthenticated_request',
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_list_buckets',
          'oci_object_storage_native_list_multipart_parts',
          'oci_object_storage_native_list_multipart_uploads',
          'oci_object_storage_native_list_object_versions',
          'oci_object_storage_native_list_objects',
          'oci_object_storage_native_list_preauthenticated_requests',
          'oci_object_storage_native_put_lifecycle_policy',
          'oci_object_storage_native_rename_object',
          'oci_object_storage_native_restore_object',
          'oci_object_storage_native_update_bucket',
          'oci_object_storage_native_update_object_storage_tier',
          'oci_object_storage_native_upload_object',
          'oci_object_storage_native_upload_part',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oci_object_storage_native_list_buckets',
          'oci_object_storage_native_create_bucket',
        ],
      },
      placeholder: 'Required for bucket discovery; optional with a manually entered bucket',
    },
    {
      id: 'bucketSelector',
      title: 'Bucket',
      type: 'project-selector',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_abort_multipart_upload',
          'oci_object_storage_native_batch_delete_objects',
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_copy_object',
          'oci_object_storage_native_create_multipart_upload',
          'oci_object_storage_native_create_preauthenticated_request',
          'oci_object_storage_native_delete_bucket',
          'oci_object_storage_native_delete_lifecycle_policy',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_delete_preauthenticated_request',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_get_bucket',
          'oci_object_storage_native_get_lifecycle_policy',
          'oci_object_storage_native_get_preauthenticated_request',
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_list_multipart_parts',
          'oci_object_storage_native_list_multipart_uploads',
          'oci_object_storage_native_list_object_versions',
          'oci_object_storage_native_list_objects',
          'oci_object_storage_native_list_preauthenticated_requests',
          'oci_object_storage_native_put_lifecycle_policy',
          'oci_object_storage_native_rename_object',
          'oci_object_storage_native_restore_object',
          'oci_object_storage_native_update_bucket',
          'oci_object_storage_native_update_object_storage_tier',
          'oci_object_storage_native_upload_object',
          'oci_object_storage_native_upload_part',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oci_object_storage_native_abort_multipart_upload',
          'oci_object_storage_native_batch_delete_objects',
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_copy_object',
          'oci_object_storage_native_create_bucket',
          'oci_object_storage_native_create_multipart_upload',
          'oci_object_storage_native_create_preauthenticated_request',
          'oci_object_storage_native_delete_bucket',
          'oci_object_storage_native_delete_lifecycle_policy',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_delete_preauthenticated_request',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_get_bucket',
          'oci_object_storage_native_get_lifecycle_policy',
          'oci_object_storage_native_get_preauthenticated_request',
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_list_multipart_parts',
          'oci_object_storage_native_list_multipart_uploads',
          'oci_object_storage_native_list_object_versions',
          'oci_object_storage_native_list_objects',
          'oci_object_storage_native_list_preauthenticated_requests',
          'oci_object_storage_native_put_lifecycle_policy',
          'oci_object_storage_native_rename_object',
          'oci_object_storage_native_restore_object',
          'oci_object_storage_native_update_bucket',
          'oci_object_storage_native_update_object_storage_tier',
          'oci_object_storage_native_upload_object',
          'oci_object_storage_native_upload_part',
        ],
      },
      canonicalParamId: 'bucketName',
      mode: 'basic',
      serviceId: 'oci_object_storage_native',
      selectorKey: 'oci_object_storage_native.buckets',
      dependsOn: ['credential', 'compartmentId', 'region', 'namespace'],
    },
    {
      id: 'newBucketName',
      title: 'New Bucket Name',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_create_bucket'],
      },
      required: {
        field: 'operation',
        value: ['oci_object_storage_native_create_bucket'],
      },
    },
    {
      id: 'bucketManual',
      title: 'Bucket Name',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_abort_multipart_upload',
          'oci_object_storage_native_batch_delete_objects',
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_copy_object',
          'oci_object_storage_native_create_multipart_upload',
          'oci_object_storage_native_create_preauthenticated_request',
          'oci_object_storage_native_delete_bucket',
          'oci_object_storage_native_delete_lifecycle_policy',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_delete_preauthenticated_request',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_get_bucket',
          'oci_object_storage_native_get_lifecycle_policy',
          'oci_object_storage_native_get_preauthenticated_request',
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_list_multipart_parts',
          'oci_object_storage_native_list_multipart_uploads',
          'oci_object_storage_native_list_object_versions',
          'oci_object_storage_native_list_objects',
          'oci_object_storage_native_list_preauthenticated_requests',
          'oci_object_storage_native_put_lifecycle_policy',
          'oci_object_storage_native_rename_object',
          'oci_object_storage_native_restore_object',
          'oci_object_storage_native_update_bucket',
          'oci_object_storage_native_update_object_storage_tier',
          'oci_object_storage_native_upload_object',
          'oci_object_storage_native_upload_part',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oci_object_storage_native_abort_multipart_upload',
          'oci_object_storage_native_batch_delete_objects',
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_copy_object',
          'oci_object_storage_native_create_multipart_upload',
          'oci_object_storage_native_create_preauthenticated_request',
          'oci_object_storage_native_delete_bucket',
          'oci_object_storage_native_delete_lifecycle_policy',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_delete_preauthenticated_request',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_get_bucket',
          'oci_object_storage_native_get_lifecycle_policy',
          'oci_object_storage_native_get_preauthenticated_request',
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_list_multipart_parts',
          'oci_object_storage_native_list_multipart_uploads',
          'oci_object_storage_native_list_object_versions',
          'oci_object_storage_native_list_objects',
          'oci_object_storage_native_list_preauthenticated_requests',
          'oci_object_storage_native_put_lifecycle_policy',
          'oci_object_storage_native_rename_object',
          'oci_object_storage_native_restore_object',
          'oci_object_storage_native_update_bucket',
          'oci_object_storage_native_update_object_storage_tier',
          'oci_object_storage_native_upload_object',
          'oci_object_storage_native_upload_part',
        ],
      },
      canonicalParamId: 'bucketName',
      mode: 'advanced',
    },
    {
      id: 'objectSelector',
      title: 'Object',
      type: 'file-selector',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_copy_object',
          'oci_object_storage_native_rename_object',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_restore_object',
          'oci_object_storage_native_update_object_storage_tier',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_copy_object',
          'oci_object_storage_native_rename_object',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_restore_object',
          'oci_object_storage_native_update_object_storage_tier',
        ],
      },
      canonicalParamId: 'objectName',
      mode: 'basic',
      serviceId: 'oci_object_storage_native',
      selectorKey: 'oci_object_storage_native.objects',
      dependsOn: ['credential', 'bucketSelector', 'region', 'namespace', 'prefix'],
    },
    {
      id: 'newObjectName',
      title: 'Object Name',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_abort_multipart_upload',
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_create_multipart_upload',
          'oci_object_storage_native_list_multipart_parts',
          'oci_object_storage_native_upload_object',
          'oci_object_storage_native_upload_part',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oci_object_storage_native_abort_multipart_upload',
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_create_multipart_upload',
          'oci_object_storage_native_list_multipart_parts',
          'oci_object_storage_native_upload_object',
          'oci_object_storage_native_upload_part',
        ],
      },
    },
    {
      id: 'objectManual',
      title: 'Object Name',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_copy_object',
          'oci_object_storage_native_rename_object',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_restore_object',
          'oci_object_storage_native_update_object_storage_tier',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_copy_object',
          'oci_object_storage_native_rename_object',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_restore_object',
          'oci_object_storage_native_update_object_storage_tier',
        ],
      },
      canonicalParamId: 'objectName',
      mode: 'advanced',
    },
    {
      id: 'grantObjectName',
      title: 'Object Name or Prefix',
      type: 'short-input',
      canonicalParamId: 'grantObject',
      mode: 'basic',
      required: true,
      condition: {
        field: 'operation',
        value: 'oci_object_storage_native_create_preauthenticated_request',
        and: { field: 'scope', value: ['object', 'prefix'] },
      },
      placeholder: 'Exact object name for object scope, or exact prefix for prefix scope',
    },
    {
      id: 'grantObjectNameManual',
      title: 'Object Name or Prefix',
      type: 'short-input',
      canonicalParamId: 'grantObject',
      mode: 'advanced',
      required: true,
      condition: {
        field: 'operation',
        value: 'oci_object_storage_native_create_preauthenticated_request',
        and: { field: 'scope', value: ['object', 'prefix'] },
      },
    },
    {
      id: 'uploadSource',
      title: 'Upload Source',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_upload_object', 'oci_object_storage_native_upload_part'],
      },
      options: [
        { label: 'File', id: 'file' },
        { label: 'Inline Text', id: 'content' },
      ],
      value: () => 'file',
    },
    {
      id: 'uploadFile',
      title: 'File to Upload',
      type: 'file-upload',
      canonicalParamId: 'file',
      mode: 'basic',
      multiple: false,
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_upload_object', 'oci_object_storage_native_upload_part'],
        and: { field: 'uploadSource', value: 'file' },
      },
    },
    {
      id: 'fileReference',
      title: 'File Reference',
      type: 'short-input',
      canonicalParamId: 'file',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_upload_object', 'oci_object_storage_native_upload_part'],
        and: { field: 'uploadSource', value: 'file' },
      },
    },
    {
      id: 'content',
      title: 'Text Content',
      type: 'long-input',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_upload_object', 'oci_object_storage_native_upload_part'],
        and: { field: 'uploadSource', value: 'content' },
      },
    },
    {
      id: 'uploadId',
      title: 'Upload Id',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_abort_multipart_upload',
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_list_multipart_parts',
          'oci_object_storage_native_upload_part',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oci_object_storage_native_abort_multipart_upload',
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_list_multipart_parts',
          'oci_object_storage_native_upload_part',
        ],
      },
      placeholder: 'Native multipart upload identifier',
    },
    {
      id: 'objects',
      title: 'Objects',
      type: 'code',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_batch_delete_objects'],
      },
      required: {
        field: 'operation',
        value: ['oci_object_storage_native_batch_delete_objects'],
      },
      placeholder: '1–1000 entries containing objectName and optional ifMatch; no versionId',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-array',
        prompt:
          'Generate only valid JSON. 1–1000 entries containing objectName and optional ifMatch; no versionId Example: [{"objectName":"reports/old.csv","ifMatch":"known-etag"}]. Return ONLY the JSON array.',
      },
    },
    {
      id: 'isSkipDeletedResult',
      title: 'Is Skip Deleted Result',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_batch_delete_objects'],
      },
      mode: 'advanced',
    },
    {
      id: 'partsToCommit',
      title: 'Parts To Commit',
      type: 'code',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_commit_multipart_upload'],
      },
      required: {
        field: 'operation',
        value: ['oci_object_storage_native_commit_multipart_upload'],
      },
      placeholder: '1–10000 unique {partNum, etag} entries in the completion manifest',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-array',
        prompt:
          'Generate only valid JSON. 1–10000 unique {partNum, etag} entries in the completion manifest Example: [{"partNum":1,"etag":"part-etag"}]. Return ONLY the JSON array.',
      },
    },
    {
      id: 'ifMatch',
      title: 'If Match',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_create_multipart_upload',
          'oci_object_storage_native_delete_bucket',
          'oci_object_storage_native_delete_lifecycle_policy',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_get_bucket',
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_put_lifecycle_policy',
          'oci_object_storage_native_update_bucket',
          'oci_object_storage_native_upload_object',
          'oci_object_storage_native_upload_part',
        ],
      },
      mode: 'advanced',
      placeholder: 'Apply only if the entity tag matches',
    },
    {
      id: 'ifNoneMatch',
      title: 'If None Match',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_create_multipart_upload',
          'oci_object_storage_native_put_lifecycle_policy',
          'oci_object_storage_native_upload_object',
          'oci_object_storage_native_upload_part',
        ],
      },
      mode: 'advanced',
      options: [{ label: '*', id: '*' }],
      placeholder: 'Set to * to apply only when the destination does not exist',
    },
    {
      id: 'partsToExclude',
      title: 'Parts To Exclude',
      type: 'code',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_commit_multipart_upload'],
      },
      mode: 'advanced',
      placeholder: 'Unique part numbers to exclude, disjoint from partsToCommit',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-array',
        prompt:
          'Generate only valid JSON. Unique part numbers to exclude, disjoint from partsToCommit Example: [2,3]. Return ONLY the JSON array.',
      },
    },
    {
      id: 'destinationRegion',
      title: 'Destination Region',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_copy_object'],
      },
      required: {
        field: 'operation',
        value: ['oci_object_storage_native_copy_object'],
      },
      placeholder: 'Destination OCI region',
    },
    {
      id: 'destinationNamespace',
      title: 'Destination Namespace',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_copy_object'],
      },
      required: {
        field: 'operation',
        value: ['oci_object_storage_native_copy_object'],
      },
      placeholder: 'Destination Object Storage namespace',
    },
    {
      id: 'destinationBucket',
      title: 'Destination Bucket',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_copy_object'],
      },
      required: {
        field: 'operation',
        value: ['oci_object_storage_native_copy_object'],
      },
      placeholder: 'Destination bucket name',
    },
    {
      id: 'destinationObjectName',
      title: 'Destination Object Name',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_copy_object'],
      },
      required: {
        field: 'operation',
        value: ['oci_object_storage_native_copy_object'],
      },
      placeholder: 'Exact destination object name',
    },
    {
      id: 'sourceVersionId',
      title: 'Source Version Id',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_copy_object'],
      },
      mode: 'advanced',
      placeholder: 'Source object version to copy',
    },
    {
      id: 'sourceObjectIfMatchETag',
      title: 'Source Object If Match E Tag',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_copy_object'],
      },
      mode: 'advanced',
      placeholder: 'Require the source object ETag',
    },
    {
      id: 'destinationObjectIfMatchETag',
      title: 'Destination Object If Match E Tag',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_copy_object'],
      },
      mode: 'advanced',
      placeholder: 'Require the destination object ETag',
    },
    {
      id: 'destinationObjectIfNoneMatchETag',
      title: 'Destination Object If None Match E Tag',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_copy_object'],
      },
      mode: 'advanced',
      options: [{ label: '*', id: '*' }],
      placeholder: 'Set to * to prevent overwriting the copy destination',
    },
    {
      id: 'destinationObjectMetadata',
      title: 'Destination Object Metadata',
      type: 'code',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_copy_object'],
      },
      mode: 'advanced',
      placeholder: 'Replacement metadata with unprefixed keys, up to 4000 bytes',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Generate only valid JSON. Replacement metadata with unprefixed keys, up to 4000 bytes Example: {"owner":"analytics"}. Return ONLY the JSON object.',
      },
    },
    {
      id: 'destinationObjectStorageTier',
      title: 'Destination Object Storage Tier',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_copy_object'],
      },
      mode: 'advanced',
      options: [
        { label: 'Standard', id: 'Standard' },
        { label: 'InfrequentAccess', id: 'InfrequentAccess' },
        { label: 'Archive', id: 'Archive' },
      ],
      placeholder: 'Standard, InfrequentAccess, or Archive',
    },
    {
      id: 'metadata',
      title: 'Metadata',
      type: 'code',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_create_bucket',
          'oci_object_storage_native_create_multipart_upload',
          'oci_object_storage_native_update_bucket',
          'oci_object_storage_native_upload_object',
        ],
      },
      mode: 'advanced',
      placeholder:
        'Custom metadata object; object uploads use unprefixed header-safe keys and at most 4000 UTF-8 bytes including header names',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Generate only valid JSON. Custom metadata object; object uploads use unprefixed header-safe keys and at most 4000 UTF-8 bytes including header names Example: {"owner":"analytics"}. Return ONLY the JSON object.',
      },
    },
    {
      id: 'freeformTags',
      title: 'Freeform Tags',
      type: 'code',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_create_bucket',
          'oci_object_storage_native_update_bucket',
        ],
      },
      mode: 'advanced',
      placeholder: 'Freeform tag name/value object',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Generate only valid JSON. Freeform tag name/value object Example: {"Department":"Finance"}. Return ONLY the JSON object.',
      },
    },
    {
      id: 'definedTags',
      title: 'Defined Tags',
      type: 'code',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_create_bucket',
          'oci_object_storage_native_update_bucket',
        ],
      },
      mode: 'advanced',
      placeholder: 'Defined tag namespaces and values',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Generate only valid JSON. Defined tag namespaces and values Example: {"Operations":{"CostCenter":"42"}}. Return ONLY the JSON object.',
      },
    },
    {
      id: 'autoTiering',
      title: 'Auto Tiering',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_create_bucket',
          'oci_object_storage_native_update_bucket',
        ],
      },
      mode: 'advanced',
      options: [
        { label: 'Disabled', id: 'Disabled' },
        { label: 'InfrequentAccess', id: 'InfrequentAccess' },
      ],
      placeholder: 'Disabled or InfrequentAccess',
    },
    {
      id: 'objectEventsEnabled',
      title: 'Object Events Enabled',
      type: 'switch',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_create_bucket',
          'oci_object_storage_native_update_bucket',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'createVersioning',
      title: 'Versioning',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_create_bucket'],
      },
      mode: 'advanced',
      options: [
        { label: 'Enabled', id: 'Enabled' },
        { label: 'Disabled', id: 'Disabled' },
      ],
      placeholder: 'Create: Enabled or Disabled; update: Enabled or Suspended',
    },
    {
      id: 'versioning',
      title: 'Versioning',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_update_bucket'],
      },
      mode: 'advanced',
      options: [
        { label: 'Enabled', id: 'Enabled' },
        { label: 'Suspended', id: 'Suspended' },
      ],
      placeholder: 'Create: Enabled or Disabled; update: Enabled or Suspended',
    },
    {
      id: 'createStorageTier',
      title: 'Storage Tier',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_create_bucket'],
      },
      mode: 'advanced',
      options: [
        { label: 'Standard', id: 'Standard' },
        { label: 'Archive', id: 'Archive' },
      ],
      placeholder:
        'Standard, InfrequentAccess, or Archive; bucket creation supports Standard or Archive',
    },
    {
      id: 'storageTier',
      title: 'Storage Tier',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_create_multipart_upload',
          'oci_object_storage_native_update_object_storage_tier',
          'oci_object_storage_native_upload_object',
        ],
      },
      required: {
        field: 'operation',
        value: ['oci_object_storage_native_update_object_storage_tier'],
      },
      options: [
        { label: 'Standard', id: 'Standard' },
        { label: 'InfrequentAccess', id: 'InfrequentAccess' },
        { label: 'Archive', id: 'Archive' },
      ],
      placeholder:
        'Standard, InfrequentAccess, or Archive; bucket creation supports Standard or Archive',
    },
    {
      id: 'contentType',
      title: 'Content Type',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_create_multipart_upload',
          'oci_object_storage_native_upload_object',
          'oci_object_storage_native_upload_part',
        ],
      },
      mode: 'advanced',
      placeholder: 'Content MIME type; inferred for files, text/plain for inline content',
    },
    {
      id: 'contentLanguage',
      title: 'Content Language',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_create_multipart_upload',
          'oci_object_storage_native_upload_object',
        ],
      },
      mode: 'advanced',
      placeholder: 'Content-Language header',
    },
    {
      id: 'contentEncoding',
      title: 'Content Encoding',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_create_multipart_upload',
          'oci_object_storage_native_upload_object',
        ],
      },
      mode: 'advanced',
      placeholder: 'Content-Encoding header',
    },
    {
      id: 'contentDisposition',
      title: 'Content Disposition',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_create_multipart_upload',
          'oci_object_storage_native_upload_object',
        ],
      },
      mode: 'advanced',
      placeholder: 'Content-Disposition header',
    },
    {
      id: 'cacheControl',
      title: 'Cache Control',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_create_multipart_upload',
          'oci_object_storage_native_upload_object',
        ],
      },
      mode: 'advanced',
      placeholder: 'Cache-Control header',
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_create_preauthenticated_request'],
      },
      required: {
        field: 'operation',
        value: ['oci_object_storage_native_create_preauthenticated_request'],
      },
      placeholder: 'Display name for the pre-authenticated access grant',
    },
    {
      id: 'scope',
      title: 'Scope',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_create_preauthenticated_request'],
      },
      required: {
        field: 'operation',
        value: ['oci_object_storage_native_create_preauthenticated_request'],
      },
      options: [
        { label: 'object', id: 'object' },
        { label: 'prefix', id: 'prefix' },
        { label: 'bucket', id: 'bucket' },
      ],
      placeholder: 'Required grant scope: object, prefix, or bucket',
    },
    {
      id: 'accessType',
      title: 'Access Type',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_create_preauthenticated_request'],
      },
      required: {
        field: 'operation',
        value: ['oci_object_storage_native_create_preauthenticated_request'],
      },
      options: [
        { label: 'ObjectRead', id: 'ObjectRead' },
        { label: 'ObjectWrite', id: 'ObjectWrite' },
        { label: 'ObjectReadWrite', id: 'ObjectReadWrite' },
        { label: 'AnyObjectRead', id: 'AnyObjectRead' },
        { label: 'AnyObjectWrite', id: 'AnyObjectWrite' },
        { label: 'AnyObjectReadWrite', id: 'AnyObjectReadWrite' },
      ],
      placeholder:
        'ObjectRead/ObjectWrite/ObjectReadWrite for object scope; AnyObjectRead/AnyObjectWrite/AnyObjectReadWrite for prefix or bucket scope',
    },
    {
      id: 'timeExpires',
      title: 'Time Expires',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_create_preauthenticated_request'],
      },
      required: {
        field: 'operation',
        value: ['oci_object_storage_native_create_preauthenticated_request'],
      },
      placeholder: 'Required future ISO 8601 expiry timestamp with timezone',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt: 'Generate a future ISO 8601 expiry with timezone. Return only the timestamp.',
      },
    },
    {
      id: 'bucketListingAction',
      title: 'Bucket Listing Action',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_create_preauthenticated_request'],
      },
      mode: 'advanced',
      options: [
        { label: 'Deny', id: 'Deny' },
        { label: 'ListObjects', id: 'ListObjects' },
      ],
      value: () => 'Deny',
      placeholder: 'Deny (default) or ListObjects; listing requires bucket or prefix read scope',
    },
    {
      id: 'versionId',
      title: 'Version Id',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_restore_object',
          'oci_object_storage_native_update_object_storage_tier',
        ],
      },
      mode: 'advanced',
      placeholder: 'Explicit object version ID; deletion permanently removes this version',
    },
    {
      id: 'parId',
      title: 'Par Id',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_delete_preauthenticated_request',
          'oci_object_storage_native_get_preauthenticated_request',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oci_object_storage_native_delete_preauthenticated_request',
          'oci_object_storage_native_get_preauthenticated_request',
        ],
      },
      placeholder: 'Pre-authenticated request identifier to inspect or revoke',
    },
    {
      id: 'workRequestId',
      title: 'Work Request Id',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_get_work_request'],
      },
      required: {
        field: 'operation',
        value: ['oci_object_storage_native_get_work_request'],
      },
      placeholder: 'Work-request identifier returned by copy',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_list_buckets',
          'oci_object_storage_native_list_multipart_parts',
          'oci_object_storage_native_list_multipart_uploads',
          'oci_object_storage_native_list_object_versions',
          'oci_object_storage_native_list_objects',
          'oci_object_storage_native_list_preauthenticated_requests',
        ],
      },
      mode: 'advanced',
      placeholder: 'One-page result limit, default 100, maximum 1000',
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_list_buckets',
          'oci_object_storage_native_list_multipart_parts',
          'oci_object_storage_native_list_multipart_uploads',
          'oci_object_storage_native_list_object_versions',
          'oci_object_storage_native_list_preauthenticated_requests',
        ],
      },
      mode: 'advanced',
      placeholder: 'Opaque nextPage token from the previous response',
    },
    {
      id: 'prefix',
      title: 'Prefix',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_list_object_versions',
          'oci_object_storage_native_list_objects',
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_copy_object',
          'oci_object_storage_native_rename_object',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_restore_object',
          'oci_object_storage_native_update_object_storage_tier',
        ],
      },
      mode: 'advanced',
      placeholder: 'Exact object-name prefix; whitespace is significant',
    },
    {
      id: 'start',
      title: 'Start',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_list_object_versions',
          'oci_object_storage_native_list_objects',
        ],
      },
      mode: 'advanced',
      placeholder: 'Inclusive object-name start; use nextStartWith here',
    },
    {
      id: 'end',
      title: 'End',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_list_object_versions',
          'oci_object_storage_native_list_objects',
        ],
      },
      mode: 'advanced',
      placeholder: 'Exclusive object-name end',
    },
    {
      id: 'startAfter',
      title: 'Start After',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_list_object_versions',
          'oci_object_storage_native_list_objects',
        ],
      },
      mode: 'advanced',
      placeholder: 'Exclusive object-name start; do not use for nextStartWith',
    },
    {
      id: 'delimiter',
      title: 'Delimiter',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_list_object_versions',
          'oci_object_storage_native_list_objects',
        ],
      },
      mode: 'advanced',
      options: [{ label: '/', id: '/' }],
      placeholder: 'Set to / to group object prefixes',
    },
    {
      id: 'objectNamePrefix',
      title: 'Object Name Prefix',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_list_preauthenticated_requests'],
      },
      mode: 'advanced',
      placeholder: 'Filter pre-authenticated requests by exact object-name prefix',
    },
    {
      id: 'rules',
      title: 'Rules',
      type: 'code',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_put_lifecycle_policy'],
      },
      required: {
        field: 'operation',
        value: ['oci_object_storage_native_put_lifecycle_policy'],
      },
      placeholder:
        'Complete replacement lifecycle rule array, maximum 1000. Each rule: name, action, timeAmount, timeUnit, isEnabled; optional target and objectNameFilter. ABORT requires multipart-uploads target. Pattern lists support at most 20 entries.',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-array',
        prompt:
          'Generate only valid JSON. Complete replacement lifecycle rule array, maximum 1000. Each rule: name, action, timeAmount, timeUnit, isEnabled; optional target and objectNameFilter. ABORT requires multipart-uploads target. Pattern lists support at most 20 entries. Example: [{"name":"archive-reports","action":"ARCHIVE","timeAmount":30,"timeUnit":"DAYS","isEnabled":true,"target":"objects","objectNameFilter":{"inclusionPrefixes":["reports/"]}}]. Return ONLY the JSON array.',
      },
    },
    {
      id: 'newName',
      title: 'New Name',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_rename_object'],
      },
      required: {
        field: 'operation',
        value: ['oci_object_storage_native_rename_object'],
      },
      placeholder: 'Exact new object name in the same bucket',
    },
    {
      id: 'srcObjIfMatchETag',
      title: 'Src Obj If Match E Tag',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_rename_object'],
      },
      mode: 'advanced',
      placeholder: 'Require this source ETag before renaming',
    },
    {
      id: 'newObjIfMatchETag',
      title: 'New Obj If Match E Tag',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_rename_object'],
      },
      mode: 'advanced',
      placeholder: 'Require this destination ETag before renaming',
    },
    {
      id: 'newObjIfNoneMatchETag',
      title: 'New Obj If None Match E Tag',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_rename_object'],
      },
      mode: 'advanced',
      options: [{ label: '*', id: '*' }],
      placeholder: 'Set to * to prevent overwriting the rename destination',
    },
    {
      id: 'hours',
      title: 'Hours',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_restore_object'],
      },
      mode: 'advanced',
      placeholder: 'Restore duration in hours, 1–240, default 24',
    },
    {
      id: 'contentMd5',
      title: 'Content Md5',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_upload_object', 'oci_object_storage_native_upload_part'],
      },
      mode: 'advanced',
      placeholder: 'Optional base64 MD5 checksum of the exact uploaded bytes',
    },
    {
      id: 'partNumber',
      title: 'Part Number',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_upload_part'],
      },
      required: {
        field: 'operation',
        value: ['oci_object_storage_native_upload_part'],
      },
      placeholder: 'Multipart part number, 1–10000',
    },
  ],
  tools: {
    access: [
      'oci_object_storage_native_abort_multipart_upload',
      'oci_object_storage_native_batch_delete_objects',
      'oci_object_storage_native_commit_multipart_upload',
      'oci_object_storage_native_copy_object',
      'oci_object_storage_native_create_bucket',
      'oci_object_storage_native_create_multipart_upload',
      'oci_object_storage_native_create_preauthenticated_request',
      'oci_object_storage_native_delete_bucket',
      'oci_object_storage_native_delete_lifecycle_policy',
      'oci_object_storage_native_delete_object',
      'oci_object_storage_native_delete_preauthenticated_request',
      'oci_object_storage_native_download_object',
      'oci_object_storage_native_get_bucket',
      'oci_object_storage_native_get_lifecycle_policy',
      'oci_object_storage_native_get_namespace',
      'oci_object_storage_native_get_preauthenticated_request',
      'oci_object_storage_native_get_work_request',
      'oci_object_storage_native_head_object',
      'oci_object_storage_native_list_buckets',
      'oci_object_storage_native_list_multipart_parts',
      'oci_object_storage_native_list_multipart_uploads',
      'oci_object_storage_native_list_object_versions',
      'oci_object_storage_native_list_objects',
      'oci_object_storage_native_list_preauthenticated_requests',
      'oci_object_storage_native_put_lifecycle_policy',
      'oci_object_storage_native_rename_object',
      'oci_object_storage_native_restore_object',
      'oci_object_storage_native_update_bucket',
      'oci_object_storage_native_update_object_storage_tier',
      'oci_object_storage_native_upload_object',
      'oci_object_storage_native_upload_part',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const operation = params.operation
        if (typeof operation !== 'string' || !Object.hasOwn(OPERATION_FIELDS, operation)) {
          throw new Error('Select a native OCI Object Storage operation')
        }
        const operationParams = { ...params }
        if (operation === 'oci_object_storage_native_create_bucket') {
          operationParams.bucketName = params.newBucketName
          operationParams.versioning = params.createVersioning
          operationParams.storageTier = params.createStorageTier
        }
        if (
          [
            'oci_object_storage_native_abort_multipart_upload',
            'oci_object_storage_native_commit_multipart_upload',
            'oci_object_storage_native_create_multipart_upload',
            'oci_object_storage_native_list_multipart_parts',
            'oci_object_storage_native_upload_object',
            'oci_object_storage_native_upload_part',
          ].includes(operation)
        ) {
          operationParams.objectName = params.newObjectName
        }
        if (operation === 'oci_object_storage_native_create_preauthenticated_request') {
          operationParams.objectName = params.scope === 'bucket' ? undefined : params.grantObject
        }
        const result: Record<string, unknown> = {
          oauthCredential: params.oauthCredential,
          region: params.region || undefined,
          namespace: params.namespace || undefined,
        }
        for (const field of OPERATION_FIELDS[operation]) {
          const value = operationParams[field]
          if (value !== undefined && value !== null && value !== '') result[field] = value
        }
        for (const field of ['limit', 'partNumber', 'hours']) {
          if (result[field] !== undefined)
            result[field] = parseOptionalNumberInput(result[field], field, {
              integer: true,
              min: 1,
              max: field === 'limit' ? 1000 : field === 'hours' ? 240 : 10000,
            })
        }
        for (const field of ['objectEventsEnabled', 'isSkipDeletedResult']) {
          if (result[field] === 'true') result[field] = true
          if (result[field] === 'false') result[field] = false
        }
        if (
          operation === 'oci_object_storage_native_upload_object' ||
          operation === 'oci_object_storage_native_upload_part'
        ) {
          if (params.uploadSource === 'content') {
            result.file = undefined
            result.content = params.content ?? ''
          } else {
            result.content = undefined
            result.file = normalizeFileInput(params.file, { single: true })
          }
        }
        return result
      },
    },
  },
  inputs: {
    operation: {
      type: 'string',
      description: 'Native OCI operation',
    },
    oauthCredential: {
      type: 'string',
      description: 'OCI API signing-key service-account credential',
    },
    region: {
      type: 'string',
      description: 'Optional OCI region override',
    },
    namespace: {
      type: 'string',
      description: 'Optional namespace; discovered when omitted',
    },
    newBucketName: {
      type: 'string',
      description: 'Name of the bucket to create',
    },
    newObjectName: {
      type: 'string',
      description: 'Exact object name for upload or multipart operations',
    },
    grantObject: {
      type: 'string',
      description: 'Exact object name or prefix for the selected grant scope',
    },
    createVersioning: {
      type: 'string',
      description: 'Initial bucket versioning: Enabled or Disabled',
    },
    createStorageTier: {
      type: 'string',
      description: 'Initial bucket storage tier: Standard or Archive',
    },
    uploadSource: {
      type: 'string',
      description: 'File or inline text upload source',
    },
    bucketName: {
      type: 'string',
      description: 'OCI bucket name',
    },
    objectName: {
      type: 'string',
      description: 'Exact object name; preserve spaces, Unicode, separators and percent characters',
    },
    uploadId: {
      type: 'string',
      description: 'Native multipart upload identifier',
    },
    objects: {
      type: 'array',
      description: '1–1000 entries containing objectName and optional ifMatch; no versionId',
    },
    isSkipDeletedResult: {
      type: 'boolean',
      description: 'Omit successfully deleted entries from the result; failures remain visible',
    },
    partsToCommit: {
      type: 'array',
      description: '1–10000 unique {partNum, etag} entries in the completion manifest',
    },
    ifMatch: {
      type: 'string',
      description: 'Apply only if the entity tag matches',
    },
    ifNoneMatch: {
      type: 'string',
      description: 'Set to * to apply only when the destination does not exist',
    },
    partsToExclude: {
      type: 'array',
      description: 'Unique part numbers to exclude, disjoint from partsToCommit',
    },
    destinationRegion: {
      type: 'string',
      description: 'Destination OCI region',
    },
    destinationNamespace: {
      type: 'string',
      description: 'Destination Object Storage namespace',
    },
    destinationBucket: {
      type: 'string',
      description: 'Destination bucket name',
    },
    destinationObjectName: {
      type: 'string',
      description: 'Exact destination object name',
    },
    sourceVersionId: {
      type: 'string',
      description: 'Source object version to copy',
    },
    sourceObjectIfMatchETag: {
      type: 'string',
      description: 'Require the source object ETag',
    },
    destinationObjectIfMatchETag: {
      type: 'string',
      description: 'Require the destination object ETag',
    },
    destinationObjectIfNoneMatchETag: {
      type: 'string',
      description: 'Set to * to prevent overwriting the copy destination',
    },
    destinationObjectMetadata: {
      type: 'json',
      description: 'Replacement metadata with unprefixed keys, up to 4000 bytes',
    },
    destinationObjectStorageTier: {
      type: 'string',
      description: 'Standard, InfrequentAccess, or Archive',
    },
    compartmentId: {
      type: 'string',
      description: 'OCI compartment OCID',
    },
    metadata: {
      type: 'json',
      description:
        'Custom metadata object; object uploads use unprefixed header-safe keys and at most 4000 UTF-8 bytes including header names',
    },
    freeformTags: {
      type: 'json',
      description: 'Freeform tag name/value object',
    },
    definedTags: {
      type: 'json',
      description: 'Defined tag namespaces and values',
    },
    autoTiering: {
      type: 'string',
      description: 'Disabled or InfrequentAccess',
    },
    objectEventsEnabled: {
      type: 'boolean',
      description: 'Emit events for object state changes',
    },
    versioning: {
      type: 'string',
      description: 'Create: Enabled or Disabled; update: Enabled or Suspended',
    },
    storageTier: {
      type: 'string',
      description:
        'Standard, InfrequentAccess, or Archive; bucket creation supports Standard or Archive',
    },
    contentType: {
      type: 'string',
      description: 'Content MIME type; inferred for files, text/plain for inline content',
    },
    contentLanguage: {
      type: 'string',
      description: 'Content-Language header',
    },
    contentEncoding: {
      type: 'string',
      description: 'Content-Encoding header',
    },
    contentDisposition: {
      type: 'string',
      description: 'Content-Disposition header',
    },
    cacheControl: {
      type: 'string',
      description: 'Cache-Control header',
    },
    name: {
      type: 'string',
      description: 'Display name for the pre-authenticated access grant',
    },
    scope: {
      type: 'string',
      description: 'Required grant scope: object, prefix, or bucket',
    },
    accessType: {
      type: 'string',
      description:
        'ObjectRead/ObjectWrite/ObjectReadWrite for object scope; AnyObjectRead/AnyObjectWrite/AnyObjectReadWrite for prefix or bucket scope',
    },
    timeExpires: {
      type: 'string',
      description: 'Required future ISO 8601 expiry timestamp with timezone',
    },
    bucketListingAction: {
      type: 'string',
      description: 'Deny (default) or ListObjects; listing requires bucket or prefix read scope',
    },
    versionId: {
      type: 'string',
      description: 'Explicit object version ID; deletion permanently removes this version',
    },
    parId: {
      type: 'string',
      description: 'Pre-authenticated request identifier to inspect or revoke',
    },
    workRequestId: {
      type: 'string',
      description: 'Work-request identifier returned by copy',
    },
    limit: {
      type: 'number',
      description: 'One-page result limit, default 100, maximum 1000',
    },
    page: {
      type: 'string',
      description: 'Opaque nextPage token from the previous response',
    },
    prefix: {
      type: 'string',
      description: 'Exact object-name prefix; whitespace is significant',
    },
    start: {
      type: 'string',
      description: 'Inclusive object-name start; use nextStartWith here',
    },
    end: {
      type: 'string',
      description: 'Exclusive object-name end',
    },
    startAfter: {
      type: 'string',
      description: 'Exclusive object-name start; do not use for nextStartWith',
    },
    delimiter: {
      type: 'string',
      description: 'Set to / to group object prefixes',
    },
    objectNamePrefix: {
      type: 'string',
      description: 'Filter pre-authenticated requests by exact object-name prefix',
    },
    rules: {
      type: 'array',
      description:
        'Complete replacement lifecycle rule array, maximum 1000. Each rule: name, action, timeAmount, timeUnit, isEnabled; optional target and objectNameFilter. ABORT requires multipart-uploads target. Pattern lists support at most 20 entries.',
    },
    newName: {
      type: 'string',
      description: 'Exact new object name in the same bucket',
    },
    srcObjIfMatchETag: {
      type: 'string',
      description: 'Require this source ETag before renaming',
    },
    newObjIfMatchETag: {
      type: 'string',
      description: 'Require this destination ETag before renaming',
    },
    newObjIfNoneMatchETag: {
      type: 'string',
      description: 'Set to * to prevent overwriting the rename destination',
    },
    hours: {
      type: 'number',
      description: 'Restore duration in hours, 1–240, default 24',
    },
    file: {
      type: 'file',
      description: 'Uploaded workflow file; exactly one of file or content, maximum 100 MiB',
    },
    content: {
      type: 'string',
      description:
        'Inline UTF-8 text, including empty text; the complete JSON request must fit within 8 MiB, including escaping and other fields. Use a file for larger uploads.',
    },
    contentMd5: {
      type: 'string',
      description: 'Optional base64 MD5 checksum of the exact uploaded bytes',
    },
    partNumber: {
      type: 'number',
      description: 'Multipart part number, 1–10000',
    },
  },
  outputs: {
    uploadId: {
      type: 'string',
      description: 'Multipart upload identifier',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_abort_multipart_upload',
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_upload_part',
        ],
      },
    },
    aborted: {
      type: 'boolean',
      description: 'Upload aborted and parts discarded',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_abort_multipart_upload'],
      },
    },
    namespace: {
      type: 'string',
      description: 'Object Storage namespace',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_abort_multipart_upload',
          'oci_object_storage_native_batch_delete_objects',
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_copy_object',
          'oci_object_storage_native_delete_bucket',
          'oci_object_storage_native_delete_lifecycle_policy',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_delete_preauthenticated_request',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_get_lifecycle_policy',
          'oci_object_storage_native_get_namespace',
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_list_buckets',
          'oci_object_storage_native_list_multipart_parts',
          'oci_object_storage_native_list_multipart_uploads',
          'oci_object_storage_native_list_object_versions',
          'oci_object_storage_native_list_objects',
          'oci_object_storage_native_list_preauthenticated_requests',
          'oci_object_storage_native_put_lifecycle_policy',
          'oci_object_storage_native_rename_object',
          'oci_object_storage_native_restore_object',
          'oci_object_storage_native_update_object_storage_tier',
          'oci_object_storage_native_upload_object',
          'oci_object_storage_native_upload_part',
        ],
      },
    },
    bucketName: {
      type: 'string',
      description: 'Bucket name',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_abort_multipart_upload',
          'oci_object_storage_native_batch_delete_objects',
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_copy_object',
          'oci_object_storage_native_delete_bucket',
          'oci_object_storage_native_delete_lifecycle_policy',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_delete_preauthenticated_request',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_get_lifecycle_policy',
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_list_multipart_parts',
          'oci_object_storage_native_list_multipart_uploads',
          'oci_object_storage_native_list_object_versions',
          'oci_object_storage_native_list_objects',
          'oci_object_storage_native_list_preauthenticated_requests',
          'oci_object_storage_native_put_lifecycle_policy',
          'oci_object_storage_native_rename_object',
          'oci_object_storage_native_restore_object',
          'oci_object_storage_native_update_object_storage_tier',
          'oci_object_storage_native_upload_object',
          'oci_object_storage_native_upload_part',
        ],
      },
    },
    objectName: {
      type: 'string',
      description: 'Exact object name',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_abort_multipart_upload',
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_copy_object',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_list_multipart_parts',
          'oci_object_storage_native_rename_object',
          'oci_object_storage_native_restore_object',
          'oci_object_storage_native_update_object_storage_tier',
          'oci_object_storage_native_upload_object',
          'oci_object_storage_native_upload_part',
        ],
      },
    },
    etag: {
      type: 'string',
      description: 'Entity tag for conditional operations',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_abort_multipart_upload',
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_create_bucket',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_get_bucket',
          'oci_object_storage_native_get_lifecycle_policy',
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_put_lifecycle_policy',
          'oci_object_storage_native_rename_object',
          'oci_object_storage_native_update_bucket',
          'oci_object_storage_native_upload_object',
          'oci_object_storage_native_upload_part',
        ],
      },
    },
    versionId: {
      type: 'string',
      description: 'Object version ID',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_abort_multipart_upload',
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_rename_object',
          'oci_object_storage_native_restore_object',
          'oci_object_storage_native_update_object_storage_tier',
          'oci_object_storage_native_upload_object',
          'oci_object_storage_native_upload_part',
        ],
      },
    },
    isDeleteMarker: {
      type: 'boolean',
      description: 'Whether this result identifies a delete marker',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_abort_multipart_upload',
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_rename_object',
          'oci_object_storage_native_upload_object',
          'oci_object_storage_native_upload_part',
        ],
      },
    },
    contentLength: {
      type: 'number',
      description: 'Object byte length, when supplied by OCI',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_abort_multipart_upload',
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_rename_object',
          'oci_object_storage_native_upload_object',
          'oci_object_storage_native_upload_part',
        ],
      },
    },
    contentType: {
      type: 'string',
      description: 'Content MIME type',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_abort_multipart_upload',
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_rename_object',
          'oci_object_storage_native_upload_object',
          'oci_object_storage_native_upload_part',
        ],
      },
    },
    lastModified: {
      type: 'string',
      description: 'Last-Modified HTTP date',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_abort_multipart_upload',
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_rename_object',
          'oci_object_storage_native_upload_object',
          'oci_object_storage_native_upload_part',
        ],
      },
    },
    contentMd5: {
      type: 'string',
      description: 'Content MD5 header',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_abort_multipart_upload',
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_rename_object',
          'oci_object_storage_native_upload_object',
          'oci_object_storage_native_upload_part',
        ],
      },
    },
    opcContentMd5: {
      type: 'string',
      description: 'Oracle content MD5 checksum',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_abort_multipart_upload',
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_rename_object',
          'oci_object_storage_native_upload_object',
          'oci_object_storage_native_upload_part',
        ],
      },
    },
    multipartMd5: {
      type: 'string',
      description: 'Oracle multipart MD5 checksum',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_abort_multipart_upload',
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_rename_object',
          'oci_object_storage_native_upload_object',
          'oci_object_storage_native_upload_part',
        ],
      },
    },
    contentEncoding: {
      type: 'string',
      description: 'Content encoding',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_abort_multipart_upload',
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_rename_object',
          'oci_object_storage_native_upload_object',
          'oci_object_storage_native_upload_part',
        ],
      },
    },
    contentLanguage: {
      type: 'string',
      description: 'Content language',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_abort_multipart_upload',
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_rename_object',
          'oci_object_storage_native_upload_object',
          'oci_object_storage_native_upload_part',
        ],
      },
    },
    contentDisposition: {
      type: 'string',
      description: 'Content disposition',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_abort_multipart_upload',
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_rename_object',
          'oci_object_storage_native_upload_object',
          'oci_object_storage_native_upload_part',
        ],
      },
    },
    cacheControl: {
      type: 'string',
      description: 'Cache-Control value',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_abort_multipart_upload',
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_rename_object',
          'oci_object_storage_native_upload_object',
          'oci_object_storage_native_upload_part',
        ],
      },
    },
    storageTier: {
      type: 'string',
      description: 'Standard, InfrequentAccess, or Archive',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_abort_multipart_upload',
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_rename_object',
          'oci_object_storage_native_upload_object',
          'oci_object_storage_native_upload_part',
        ],
      },
    },
    archivalState: {
      type: 'string',
      description: 'Archived, Restoring, or Restored',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_abort_multipart_upload',
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_rename_object',
          'oci_object_storage_native_upload_object',
          'oci_object_storage_native_upload_part',
        ],
      },
    },
    timeOfArchival: {
      type: 'string',
      description: 'Time the object was archived',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_abort_multipart_upload',
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_rename_object',
          'oci_object_storage_native_upload_object',
          'oci_object_storage_native_upload_part',
        ],
      },
    },
    metadata: {
      type: 'json',
      description: 'Custom object metadata with opc-meta- prefixes removed',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_abort_multipart_upload',
          'oci_object_storage_native_commit_multipart_upload',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_download_object',
          'oci_object_storage_native_head_object',
          'oci_object_storage_native_rename_object',
          'oci_object_storage_native_upload_object',
          'oci_object_storage_native_upload_part',
        ],
      },
    },
    deleted: {
      type: 'json',
      description:
        'Deletion confirmation, or batch entries containing objectName and timeLastModified',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_batch_delete_objects',
          'oci_object_storage_native_delete_bucket',
          'oci_object_storage_native_delete_lifecycle_policy',
          'oci_object_storage_native_delete_object',
          'oci_object_storage_native_delete_preauthenticated_request',
        ],
      },
    },
    failed: {
      type: 'array',
      description: 'Failed entries: objectName, statusCode and errorMessage',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_batch_delete_objects'],
      },
    },
    allSucceeded: {
      type: 'boolean',
      description: 'False when any object deletion failed',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_batch_delete_objects'],
      },
    },
    accepted: {
      type: 'boolean',
      description: 'Storage-tier change accepted',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_copy_object',
          'oci_object_storage_native_restore_object',
          'oci_object_storage_native_update_object_storage_tier',
        ],
      },
    },
    workRequestId: {
      type: 'string',
      description: 'Identifier for get_work_request',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_copy_object'],
      },
    },
    bucket: {
      type: 'json',
      description:
        'Bucket configuration, including namespace, name, compartmentId, versioning, storageTier, metadata and tags',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_create_bucket',
          'oci_object_storage_native_get_bucket',
          'oci_object_storage_native_update_bucket',
        ],
      },
    },
    upload: {
      type: 'json',
      description:
        'Multipart upload: namespace, bucket, object, uploadId, timeCreated and storageTier',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_create_multipart_upload'],
      },
    },
    request: {
      type: 'json',
      description: 'Access-grant summary without the secret URL',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_create_preauthenticated_request',
          'oci_object_storage_native_get_preauthenticated_request',
        ],
      },
    },
    accessUrl: {
      type: 'string',
      description: 'Sensitive unauthenticated access-grant URL; returned only at creation',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_create_preauthenticated_request'],
      },
    },
    parId: {
      type: 'string',
      description: 'Revoked access-grant identifier',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_delete_preauthenticated_request'],
      },
    },
    file: {
      type: 'file',
      description: 'Downloaded file persisted in execution storage',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_download_object'],
      },
    },
    rules: {
      type: 'array',
      description: 'Complete lifecycle rules',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_get_lifecycle_policy',
          'oci_object_storage_native_put_lifecycle_policy',
        ],
      },
    },
    timeCreated: {
      type: 'string',
      description: 'Policy creation time',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_get_lifecycle_policy',
          'oci_object_storage_native_put_lifecycle_policy',
        ],
      },
    },
    workRequest: {
      type: 'json',
      description: 'id, compartmentId, operationType, status, percentComplete and timestamps',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_get_work_request'],
      },
    },
    resources: {
      type: 'array',
      description: 'Affected resource identifiers and actions',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_get_work_request'],
      },
    },
    retryAfter: {
      type: 'string',
      description: 'Provider retry guidance, when available',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_get_work_request'],
      },
    },
    buckets: {
      type: 'array',
      description: 'Bucket summaries',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_list_buckets'],
      },
    },
    nextPage: {
      type: 'string',
      description: 'Opaque next-page token',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_list_buckets',
          'oci_object_storage_native_list_multipart_parts',
          'oci_object_storage_native_list_multipart_uploads',
          'oci_object_storage_native_list_object_versions',
          'oci_object_storage_native_list_preauthenticated_requests',
        ],
      },
    },
    parts: {
      type: 'array',
      description: 'Uploaded parts: partNumber, etag, md5 and size',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_list_multipart_parts'],
      },
    },
    uploads: {
      type: 'array',
      description: 'Active multipart uploads',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_list_multipart_uploads'],
      },
    },
    versions: {
      type: 'array',
      description: 'Object versions with versionId and isDeleteMarker',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_list_object_versions'],
      },
    },
    prefixes: {
      type: 'array',
      description: 'Common prefixes for the delimiter',
      condition: {
        field: 'operation',
        value: [
          'oci_object_storage_native_list_object_versions',
          'oci_object_storage_native_list_objects',
        ],
      },
    },
    objects: {
      type: 'array',
      description: 'Objects with name, size, etag, md5, timestamps, storageTier and archivalState',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_list_objects'],
      },
    },
    nextStartWith: {
      type: 'string',
      description: 'Next inclusive start value',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_list_objects'],
      },
    },
    requests: {
      type: 'array',
      description: 'Access-grant summaries without secret URLs',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_list_preauthenticated_requests'],
      },
    },
    size: {
      type: 'number',
      description: 'Uploaded byte length',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_upload_object', 'oci_object_storage_native_upload_part'],
      },
    },
    partNumber: {
      type: 'number',
      description: 'Uploaded part number',
      condition: {
        field: 'operation',
        value: ['oci_object_storage_native_upload_part'],
      },
    },
    requestId: {
      type: 'string',
      description: 'Oracle request identifier',
    },
  },
}

export const OciObjectStorageNativeBlockMeta = {
  tags: ['automation', 'cloud'],
  url: 'https://www.oracle.com/cloud/storage/object-storage/',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Catalog bucket contents',
      prompt:
        'Build a workflow to list one page of native OCI objects under a configured prefix, save names and ETags in a table, and retain nextStartWith for a later bounded run.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['automation', 'cloud'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Archive workflow exports',
      prompt:
        'Build a workflow to upload an approved workflow file of at most 100 MiB to a private OCI bucket, set custom metadata, and record its ETag and version ID.',
      modules: ['files', 'workflows'],
      category: 'operations',
      tags: ['automation', 'cloud'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Process incoming documents',
      prompt:
        'Build a workflow to select an OCI object, read its metadata, download it within the 100 MiB limit, and pass the workflow file to a document-processing step.',
      modules: ['files', 'workflows'],
      category: 'operations',
      tags: ['automation', 'cloud'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Copy objects between buckets',
      prompt:
        'Build a workflow to copy a specific OCI object to an explicit destination, save its work-request ID, and check status on later scheduled runs until COMPLETED or FAILED.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['automation', 'cloud'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Restore archived reports',
      prompt:
        'Build a workflow to request a 24-hour restore of an archived OCI object version, check archival state on later runs, and download the restored report within 100 MiB.',
      modules: ['scheduled', 'files', 'workflows'],
      category: 'operations',
      tags: ['automation', 'cloud'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Manage multipart transfers',
      prompt:
        'Build a workflow to create an OCI multipart upload, upload explicitly supplied file parts of at most 100 MiB each, record part numbers and ETags, and commit a complete manifest or abort.',
      modules: ['files', 'tables', 'workflows'],
      category: 'operations',
      tags: ['automation', 'cloud'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Share an expiring report',
      prompt:
        'Build a workflow to create an object-read pre-authenticated request with an explicit expiry, retain its ID for revocation, and return the access-grant URL only to the intended recipient.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation', 'cloud'],
    },
  ],
  skills: [
    {
      name: 'inventory-oci-objects',
      description: 'Build bounded inventories of OCI objects and versions.',
      content:
        '# Inventory Oci Objects\n\n## Steps\n\n1. List Objects with a prefix and limit 100. Pass nextStartWith as start for the next explicitly requested page. List Object Versions uses nextPage as page. Return names and ETags without fetching every page.\n\n## Output\n\nReturn the requested resource identifiers, results, and any next-page or work-request token. State incomplete asynchronous work and partial failures explicitly.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/managingobjects.htm',
    },
    {
      name: 'transfer-oci-files',
      description: 'Transfer authorized workflow files with conditional writes.',
      content:
        '# Transfer Oci Files\n\n## Steps\n\n1. Upload exactly one file up to 100 MiB or UTF-8 text, including empty text, within the 8 MiB JSON request budget including escaping and other fields. Use a file for larger uploads. Use If-None-Match * to prevent overwriting or If-Match with a known ETag. Download Object returns a workflow file and does not grant public access.\n\n## Output\n\nReturn the requested resource identifiers, results, and any next-page or work-request token. State incomplete asynchronous work and partial failures explicitly.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/managingobjects.htm',
    },
    {
      name: 'copy-oci-objects',
      description: 'Copy objects and track asynchronous completion.',
      content:
        '# Copy Oci Objects\n\n## Steps\n\n1. Choose destination region, namespace, bucket and object explicitly. Save the copy work-request ID and check it on later runs. COMPLETED means success; FAILED means failure. Verify source, destination and regional service permissions.\n\n## Output\n\nReturn the requested resource identifiers, results, and any next-page or work-request token. State incomplete asynchronous work and partial failures explicitly.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/copyingobjects.htm',
    },
    {
      name: 'manage-oci-versions',
      description: 'Inspect version history before permanent deletion.',
      content:
        '# Manage Oci Versions\n\n## Steps\n\n1. List versions one page at a time. Deleting the current object in a versioned bucket creates a delete marker; deleting an explicit version permanently removes it. Use ETag conditions when available and never infer permission to purge historical versions.\n\n## Output\n\nReturn the requested resource identifiers, results, and any next-page or work-request token. State incomplete asynchronous work and partial failures explicitly.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/usingversioning.htm',
    },
    {
      name: 'recover-oci-archives',
      description: 'Restore archived objects for a bounded access window.',
      content:
        '# Recover Oci Archives\n\n## Steps\n\n1. Inspect archivalState with Head Object. Restore an explicit object or version for 1–240 hours, default 24. Check status on later runs and download only after restoration, within 100 MiB.\n\n## Output\n\nReturn the requested resource identifiers, results, and any next-page or work-request token. State incomplete asynchronous work and partial failures explicitly.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/managingobjects.htm',
    },
    {
      name: 'maintain-oci-lifecycle-and-multipart',
      description: 'Maintain complete policies and explicit multipart manifests.',
      content:
        '# Maintain Oci Lifecycle And Multipart\n\n## Steps\n\n1. Read the lifecycle policy before editing. PUT replaces all rules; preserve desired rules and use its ETag. ABORT rules target multipart-uploads. For transfers, save each part number and ETag; commit a unique explicit manifest or abort. Each file part is limited to 100 MiB; inline parts must fit within the 8 MiB JSON request budget including escaping and other fields.\n\n## Output\n\nReturn the requested resource identifiers, results, and any next-page or work-request token. State incomplete asynchronous work and partial failures explicitly.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/usinglifecyclepolicies.htm',
    },
    {
      name: 'grant-expiring-oci-access',
      description: 'Create and revoke deliberate pre-authenticated access grants.',
      content:
        '# Grant Expiring Oci Access\n\n## Steps\n\n1. Require explicit scope, access type and future expiry. Default listing to Deny. Anyone holding the URL can use the grant. Return the URL only at creation and retain the request ID for revocation. Get and List do not recover secret URLs.\n\n## Output\n\nReturn the requested resource identifiers, results, and any next-page or work-request token. State incomplete asynchronous work and partial failures explicitly.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/usingpreauthenticatedrequests.htm',
    },
  ],
} satisfies BlockMeta
