import { OciObjectStorageIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput, parseOptionalNumberInput } from '@/blocks/utils'
import type { OciObjectStorageResponse } from '@/tools/oci_object_storage/types'

const OBJECT_OPERATIONS = [
  'oci_object_storage_upload_object',
  'oci_object_storage_download_object',
  'oci_object_storage_head_object',
  'oci_object_storage_delete_object',
]

const EXISTING_OBJECT_OPERATIONS = [
  'oci_object_storage_download_object',
  'oci_object_storage_head_object',
  'oci_object_storage_delete_object',
]

const BUCKET_OPERATIONS = ['oci_object_storage_list_objects', ...OBJECT_OPERATIONS]

const UPLOAD_SOURCE_FIELD = ['uploadFile', 'fileReference', 'content'] as const

export const OciObjectStorageBlock: BlockConfig<OciObjectStorageResponse> = {
  type: 'oci_object_storage',
  name: 'OCI Object Storage',
  description: 'List, upload, download, inspect, and delete objects in Oracle Cloud',
  longDescription:
    'Connect an Oracle Cloud Infrastructure Customer Secret Key to work with real Object Storage buckets and objects through Oracle’s S3 Compatibility API. Includes bucket and object listing, uploads, downloads, metadata inspection, and deletion, with a 100 MiB Sim transfer limit. Minimum IAM permissions are BUCKET_INSPECT, OBJECT_INSPECT, OBJECT_READ, OBJECT_CREATE, OBJECT_OVERWRITE, and OBJECT_DELETE; customer-managed encryption keys require additional Vault permissions.',
  docsLink: 'https://docs.sim.ai/integrations/oci_object_storage',
  authMode: AuthMode.ApiKey,
  category: 'tools',
  integrationType: IntegrationType.Documents,
  bgColor: '#FFFFFF',
  icon: OciObjectStorageIcon,
  canvasPresentation: {
    defaultTitle: 'OCI Object Storage',
    sentences: {
      byOperation: {
        oci_object_storage_list_buckets: ['List OCI Object Storage buckets'],
        oci_object_storage_list_objects: [
          {
            text: 'List objects in',
            field: ['bucketSelector', 'manualBucketName'],
            core: true,
          },
          { text: ', under', field: 'prefix' },
          { text: ', grouped by', field: 'delimiter' },
          { text: ', up to', field: 'maxKeys', after: 'results' },
        ],
        oci_object_storage_upload_object: [
          { text: 'Upload', field: UPLOAD_SOURCE_FIELD, core: true },
          { text: 'to', field: ['bucketSelector', 'manualBucketName'], core: true },
          { text: 'as', field: 'uploadObjectKey', core: true },
        ],
        oci_object_storage_download_object: [
          {
            text: 'Download an object from',
            field: ['bucketSelector', 'manualBucketName'],
            core: true,
          },
          {
            text: 'at',
            field: ['objectSelector', 'manualObjectKey'],
          },
        ],
        oci_object_storage_head_object: [
          {
            text: 'Inspect object metadata in',
            field: ['bucketSelector', 'manualBucketName'],
            core: true,
          },
          {
            text: 'at',
            field: ['objectSelector', 'manualObjectKey'],
          },
        ],
        oci_object_storage_delete_object: [
          {
            text: 'Delete an object from',
            field: ['bucketSelector', 'manualBucketName'],
            core: true,
          },
          { text: 'at', field: ['objectSelector', 'manualObjectKey'] },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'credential',
      title: 'OCI Object Storage Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
      serviceId: 'oci_object_storage',
      credentialKind: 'service-account',
      requiredScopes: getScopesForService('oci_object_storage'),
      placeholder: 'Select OCI Object Storage credential',
    },
    {
      id: 'manualCredential',
      title: 'OCI Object Storage Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      required: true,
      placeholder: 'Enter credential ID',
    },
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Buckets', id: 'oci_object_storage_list_buckets' },
        { label: 'List Objects', id: 'oci_object_storage_list_objects' },
        { label: 'Upload Object', id: 'oci_object_storage_upload_object' },
        { label: 'Download Object', id: 'oci_object_storage_download_object' },
        { label: 'Inspect Object Metadata', id: 'oci_object_storage_head_object' },
        { label: 'Delete Object', id: 'oci_object_storage_delete_object' },
      ],
      value: () => 'oci_object_storage_list_objects',
      required: true,
    },
    {
      id: 'bucketSelector',
      title: 'Bucket',
      type: 'project-selector',
      canonicalParamId: 'bucketName',
      serviceId: 'oci_object_storage',
      selectorKey: 'oci_object_storage.buckets',
      placeholder: 'Select bucket',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: BUCKET_OPERATIONS },
      required: { field: 'operation', value: BUCKET_OPERATIONS },
    },
    {
      id: 'manualBucketName',
      title: 'Bucket Name',
      type: 'short-input',
      canonicalParamId: 'bucketName',
      placeholder: 'Enter bucket name',
      mode: 'advanced',
      condition: { field: 'operation', value: BUCKET_OPERATIONS },
      required: { field: 'operation', value: BUCKET_OPERATIONS },
    },
    {
      id: 'objectSelector',
      title: 'Object',
      type: 'project-selector',
      canonicalParamId: 'objectKey',
      serviceId: 'oci_object_storage',
      selectorKey: 'oci_object_storage.objects',
      placeholder: 'Select object',
      dependsOn: ['credential', 'bucketSelector'],
      mode: 'basic',
      condition: { field: 'operation', value: EXISTING_OBJECT_OPERATIONS },
      required: { field: 'operation', value: EXISTING_OBJECT_OPERATIONS },
    },
    {
      id: 'manualObjectKey',
      title: 'Object Key',
      type: 'short-input',
      canonicalParamId: 'objectKey',
      placeholder: 'folder/report.pdf',
      mode: 'advanced',
      condition: { field: 'operation', value: EXISTING_OBJECT_OPERATIONS },
      required: { field: 'operation', value: EXISTING_OBJECT_OPERATIONS },
    },
    {
      id: 'uploadObjectKey',
      title: 'Object Key',
      type: 'short-input',
      placeholder: 'folder/report.pdf',
      condition: { field: 'operation', value: 'oci_object_storage_upload_object' },
      required: { field: 'operation', value: 'oci_object_storage_upload_object' },
    },
    {
      id: 'uploadFile',
      title: 'File to Upload',
      canvasNoun: 'a file',
      type: 'file-upload',
      canonicalParamId: 'file',
      placeholder: 'Upload a file',
      condition: { field: 'operation', value: 'oci_object_storage_upload_object' },
      mode: 'basic',
      multiple: false,
    },
    {
      id: 'fileReference',
      title: 'File Reference',
      type: 'short-input',
      canonicalParamId: 'file',
      placeholder: 'Reference a file from a previous block',
      condition: { field: 'operation', value: 'oci_object_storage_upload_object' },
      mode: 'advanced',
    },
    {
      id: 'content',
      title: 'Inline Text',
      type: 'long-input',
      placeholder: 'Or enter text to upload instead of a file',
      condition: { field: 'operation', value: 'oci_object_storage_upload_object' },
      mode: 'advanced',
    },
    {
      id: 'contentType',
      title: 'Content Type',
      type: 'short-input',
      placeholder: 'text/plain or application/json',
      condition: { field: 'operation', value: 'oci_object_storage_upload_object' },
      mode: 'advanced',
    },
    {
      id: 'prefix',
      title: 'Prefix',
      type: 'short-input',
      placeholder: 'folder/',
      condition: { field: 'operation', value: 'oci_object_storage_list_objects' },
    },
    {
      id: 'delimiter',
      title: 'Delimiter',
      type: 'short-input',
      placeholder: '/',
      condition: { field: 'operation', value: 'oci_object_storage_list_objects' },
      mode: 'advanced',
    },
    {
      id: 'maxKeys',
      title: 'Maximum Results',
      type: 'short-input',
      placeholder: '100 (maximum 1000)',
      condition: { field: 'operation', value: 'oci_object_storage_list_objects' },
      mode: 'advanced',
    },
    {
      id: 'startAfter',
      title: 'Start After',
      type: 'short-input',
      placeholder: 'Object key after which listing begins',
      condition: { field: 'operation', value: 'oci_object_storage_list_objects' },
      mode: 'advanced',
    },
    {
      id: 'continuationToken',
      title: 'Continuation Token',
      type: 'short-input',
      placeholder: 'Opaque token from the previous page',
      condition: { field: 'operation', value: 'oci_object_storage_list_objects' },
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'oci_object_storage_list_buckets',
      'oci_object_storage_list_objects',
      'oci_object_storage_upload_object',
      'oci_object_storage_download_object',
      'oci_object_storage_head_object',
      'oci_object_storage_delete_object',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => ({
        oauthCredential: params.oauthCredential,
        bucketName: params.bucketName,
        objectKey: params.objectKey ?? params.uploadObjectKey,
        file: normalizeFileInput(params.file, { single: true }),
        content: params.content,
        contentType: params.contentType,
        prefix: params.prefix,
        delimiter: params.delimiter,
        maxKeys: parseOptionalNumberInput(params.maxKeys, 'Maximum results', {
          integer: true,
          min: 1,
          max: 1_000,
        }),
        startAfter: params.startAfter,
        continuationToken: params.continuationToken,
      }),
    },
  },
  inputs: {
    operation: { type: 'string', description: 'OCI Object Storage operation to perform' },
    oauthCredential: {
      type: 'string',
      description: 'Connected OCI Object Storage Customer Secret Key credential',
    },
    bucketName: { type: 'string', description: 'OCI Object Storage bucket name' },
    objectKey: { type: 'string', description: 'OCI object key' },
    file: { type: 'file', description: 'Authorized Sim file to upload' },
    content: { type: 'string', description: 'Inline text upload source' },
    contentType: { type: 'string', description: 'Object Content-Type' },
    prefix: { type: 'string', description: 'Object key prefix filter' },
    delimiter: { type: 'string', description: 'Slash delimiter for grouping common prefixes' },
    maxKeys: { type: 'number', description: 'Page size from 1 to 1000' },
    startAfter: { type: 'string', description: 'Key after which listing begins' },
    continuationToken: { type: 'string', description: 'Opaque Oracle pagination token' },
  },
  outputs: {
    buckets: { type: 'array', description: 'Buckets visible to the connected credential' },
    owner: { type: 'json', description: 'Oracle owner identity for the credential' },
    objects: { type: 'array', description: 'Objects returned in the current listing page' },
    commonPrefixes: { type: 'array', description: 'Grouped prefixes returned for a delimiter' },
    file: { type: 'file', description: 'Downloaded object stored in execution files' },
    bucket: { type: 'string', description: 'Bucket used by the operation' },
    key: { type: 'string', description: 'Object key used by the operation' },
    deleted: { type: 'boolean', description: 'Whether Oracle accepted the deletion' },
    size: { type: 'number', description: 'Uploaded object size in bytes' },
    contentLength: { type: 'number', description: 'Object size in bytes' },
    contentType: { type: 'string', description: 'Object Content-Type' },
    contentEncoding: { type: 'string', description: 'Object Content-Encoding' },
    contentLanguage: { type: 'string', description: 'Object Content-Language' },
    cacheControl: { type: 'string', description: 'Object Cache-Control value' },
    contentDisposition: { type: 'string', description: 'Object Content-Disposition value' },
    etag: { type: 'string', description: 'Object entity tag' },
    lastModified: { type: 'string', description: 'Object last modification time' },
    storageClass: { type: 'string', description: 'Object storage class' },
    metadata: { type: 'json', description: 'User-defined object metadata' },
    checksumSha256: {
      type: 'string',
      description: 'Base64 SHA-256 checksum when returned by Oracle',
    },
    requestId: { type: 'string', description: 'Oracle request identifier' },
    keyCount: { type: 'number', description: 'Number of results in the listing page' },
    maxKeys: { type: 'number', description: 'Page size applied by Oracle' },
    isTruncated: { type: 'boolean', description: 'Whether another listing page is available' },
    nextContinuationToken: { type: 'string', description: 'Opaque token for the next page' },
    continuationToken: { type: 'string', description: 'Opaque token used for the current page' },
    startAfter: { type: 'string', description: 'Start-after key used for the listing' },
    prefix: { type: 'string', description: 'Prefix applied to the listing' },
    delimiter: { type: 'string', description: 'Delimiter applied to the listing' },
  },
}

export const OciObjectStorageBlockMeta = {
  tags: ['cloud', 'automation', 'content-management'],
  url: 'https://www.oracle.com/cloud/storage/object-storage/',
  templates: [
    {
      icon: OciObjectStorageIcon,
      title: 'Archive generated reports in OCI',
      prompt:
        'Build a scheduled workflow that generates a report, uploads the file to a dated OCI Object Storage key, and inspects the uploaded object metadata to confirm its size and content type.',
      modules: ['scheduled', 'files', 'workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
    {
      icon: OciObjectStorageIcon,
      title: 'Process new objects under a prefix',
      prompt:
        'Create a workflow that lists one page of OCI objects under an incoming/ prefix, downloads each selected object, processes the file, and uploads the result under processed/.',
      modules: ['files', 'workflows'],
      category: 'operations',
      tags: ['automation', 'document-processing'],
    },
    {
      icon: OciObjectStorageIcon,
      title: 'Publish application exports',
      prompt:
        'Build a workflow that converts application data to inline JSON, uploads it to an OCI bucket with an application/json content type, and returns the uploaded bucket and key.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['automation', 'data-export'],
    },
    {
      icon: OciObjectStorageIcon,
      title: 'Audit object metadata',
      prompt:
        'Create a scheduled workflow that lists objects under a compliance prefix, inspects the metadata of selected keys, and records object size, content type, ETag, storage class, and last modified time.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'reporting'],
    },
    {
      icon: OciObjectStorageIcon,
      title: 'Clean up processed objects',
      prompt:
        'Build a reviewed workflow that lists one bounded page under a processed/ prefix, inspects each candidate, and deletes only the explicitly approved object keys.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation', 'cleanup'],
    },
    {
      icon: OciObjectStorageIcon,
      title: 'Download customer documents',
      prompt:
        'Create a workflow that lets an operator select an OCI bucket and object, downloads the object into Sim as a canonical file, and sends it to the next document-processing step.',
      modules: ['files', 'workflows'],
      category: 'support',
      tags: ['document-processing', 'automation'],
    },
    {
      icon: OciObjectStorageIcon,
      title: 'Inventory OCI buckets and prefixes',
      prompt:
        'Build a workflow that lists OCI buckets, selects a bucket, lists one page of top-level prefixes with the slash delimiter, and stores the inventory in a table.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'cloud'],
    },
  ],
  skills: [
    {
      name: 'browse-oci-object-storage',
      description: 'Browse OCI buckets and bounded object pages without losing pagination state.',
      content:
        '# Browse OCI Object Storage\n\n1. Use List Buckets to identify the regional bucket.\n2. Use List Objects with the narrowest useful prefix and a maximum of 1000.\n3. Use `/` as the delimiter when the user wants folder-like common prefixes.\n4. If the page is truncated, preserve the opaque next continuation token exactly and ask before fetching another page.\n\nReturn bucket names, object keys, common prefixes, and pagination state.',
    },
    {
      name: 'upload-one-oci-object',
      description: 'Upload exactly one authorized file or one inline text value to OCI.',
      content:
        '# Upload One OCI Object\n\n1. Choose the destination bucket and full object key.\n2. Supply exactly one source: a Sim file or inline text.\n3. Set Content-Type when the intended type is known; otherwise keep the detected file type.\n4. Treat an existing key as an intentional overwrite and confirm that intent first.\n5. Keep the source within the 100 MiB Sim limit.\n\nReturn the bucket, key, size, Content-Type, and ETag.',
    },
    {
      name: 'download-oci-object-safely',
      description: 'Download an OCI object into Sim with metadata preflight and size enforcement.',
      content:
        '# Download an OCI Object Safely\n\n1. Select the exact bucket and object key.\n2. Use Download Object; it preflights metadata before streaming.\n3. Do not attempt objects above the 100 MiB Sim limit.\n4. Pass the returned canonical file to later workflow steps rather than fetching an external URL.\n\nReturn the canonical file plus its key, size, Content-Type, ETag, and last modified time.',
    },
    {
      name: 'inspect-oci-object-metadata',
      description: 'Inspect object headers and user metadata without downloading the body.',
      content:
        '# Inspect OCI Object Metadata\n\n1. Use Inspect Object Metadata for the exact bucket and key.\n2. Read Content-Length before deciding whether a later download is appropriate.\n3. Use ETag and Last-Modified for change detection; do not describe ETag as a guaranteed content hash.\n4. Preserve user-defined metadata as key-value pairs.\n\nReturn only the documented metadata relevant to the decision.',
    },
    {
      name: 'delete-oci-object-with-review',
      description: 'Delete one explicitly reviewed OCI object key.',
      content:
        '# Delete an OCI Object with Review\n\n1. Identify the exact bucket and full object key.\n2. Inspect metadata when identity or recency must be confirmed.\n3. Ask for confirmation before destructive deletion unless approval is already part of the workflow.\n4. Use Delete Object once and report its explicit deleted result.\n\nNever infer additional keys or perform bulk deletion.',
    },
    {
      name: 'page-through-oci-prefixes',
      description: 'Continue an OCI object listing using Oracle opaque cursors correctly.',
      content:
        '# Page Through OCI Object Prefixes\n\n1. Start with List Objects using a stable bucket, prefix, delimiter, and maximum page size.\n2. When isTruncated is true, pass nextContinuationToken unchanged as continuationToken.\n3. Do not combine a continuation token with a newly invented start-after key.\n4. Stop when isTruncated is false or the requested bound is reached.\n\nRecord each page token without exposing credential references.',
    },
  ],
} as const satisfies BlockMeta
