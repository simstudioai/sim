import type {
  OciNativeInput,
  OciNativeOperation,
} from '@/lib/internal/oci-object-storage-native/schema'
import type { UserFile } from '@/executor/types'
import type { ToolOutputProperty, ToolResponse } from '@/tools/types'

/** Public operation parameters reuse the native domain types without importing server code at runtime. */
type NativeParams<O extends OciNativeOperation> = Omit<
  Extract<OciNativeInput, { operation: O }>,
  'operation' | 'credentialId'
>
type DefaultedParams<O extends OciNativeOperation> = Extract<
  keyof NativeParams<O>,
  | 'limit'
  | 'hours'
  | 'isSkipDeletedResult'
  | 'bucketListingAction'
  | (O extends 'create_bucket' ? 'versioning' | 'storageTier' : never)
>
export type OciObjectStorageNativeParams<O extends OciNativeOperation> = Omit<
  NativeParams<O>,
  DefaultedParams<O>
> &
  Partial<Pick<NativeParams<O>, DefaultedParams<O>>> & {
    oauthCredential: string
    accessToken?: string
  }

export interface NativeBucket {
  namespace: string
  name: string
  compartmentId: string
  createdBy: string
  timeCreated: string
  etag: string
  metadata?: Record<string, string>
  freeformTags?: Record<string, string>
  definedTags?: Record<string, Record<string, unknown>>
  storageTier?: string
  versioning?: string
  autoTiering?: string
  objectEventsEnabled?: boolean
  approximateCount?: number
  approximateSize?: number
  isReadOnly?: boolean
  publicAccessType?: string
  objectLifecyclePolicyEtag?: string
}

export interface NativeObject {
  name: string
  size?: number
  etag?: string
  md5?: string
  timeCreated?: string
  timeModified?: string
  storageTier?: string
  archivalState?: string
}
export interface NativeObjectVersion extends NativeObject {
  versionId: string
  isDeleteMarker: boolean
  timeModified: string
}
export interface NativeMultipartUpload {
  namespace: string
  bucket: string
  object: string
  uploadId: string
  timeCreated: string
  storageTier?: string
}
export interface NativeMultipartPart {
  partNumber: number
  etag: string
  md5: string
  size: number
}
export interface NativePreauthenticatedRequest {
  id: string
  name: string
  accessType: string
  objectName?: string
  timeExpires: string
  timeCreated: string
  bucketListingAction?: string
}
export interface NativeLifecycleRule {
  name: string
  action: string
  timeAmount: number
  timeUnit: string
  isEnabled: boolean
  target?: string
  objectNameFilter?: {
    inclusionPrefixes?: string[]
    inclusionPatterns?: string[]
    exclusionPatterns?: string[]
  }
}
export interface NativeObjectHeaders {
  etag: string | null
  contentLength: number | null
  contentType: string | null
  lastModified: string | null
  versionId: string | null
  isDeleteMarker: boolean | null
  contentMd5: string | null
  opcContentMd5: string | null
  multipartMd5: string | null
  contentEncoding: string | null
  contentLanguage: string | null
  contentDisposition: string | null
  cacheControl: string | null
  storageTier: string | null
  archivalState: string | null
  timeOfArchival: string | null
  metadata: Record<string, string>
}
type BucketIdentity = { namespace: string; bucketName: string }
type ObjectIdentity = BucketIdentity & { objectName: string }
type ObjectResult = ObjectIdentity & NativeObjectHeaders
interface NativeOutputs {
  get_namespace: { namespace: string }
  list_buckets: { namespace: string; buckets: NativeBucket[]; nextPage: string | null }
  get_bucket: { bucket: NativeBucket; etag: string | null }
  create_bucket: NativeOutputs['get_bucket']
  update_bucket: NativeOutputs['get_bucket']
  delete_bucket: BucketIdentity & { deleted: boolean }
  list_objects: BucketIdentity & {
    objects: NativeObject[]
    prefixes: string[]
    nextStartWith: string | null
  }
  head_object: ObjectResult
  upload_object: ObjectResult & { size: number }
  download_object: ObjectResult & { file: UserFile }
  copy_object: ObjectIdentity & { accepted: boolean; workRequestId: string | null }
  rename_object: ObjectResult
  delete_object: ObjectResult & { deleted: boolean }
  batch_delete_objects: BucketIdentity & {
    deleted: { objectName: string; timeLastModified: string }[]
    failed: { objectName: string; statusCode: number; errorMessage: string }[]
    allSucceeded: boolean
  }
  list_object_versions: BucketIdentity & {
    versions: NativeObjectVersion[]
    prefixes: string[]
    nextPage: string | null
  }
  restore_object: ObjectIdentity & { accepted: boolean; versionId: string | null }
  update_object_storage_tier: NativeOutputs['restore_object']
  get_lifecycle_policy: BucketIdentity & {
    rules: NativeLifecycleRule[]
    timeCreated: string | null
    etag: string | null
  }
  put_lifecycle_policy: NativeOutputs['get_lifecycle_policy']
  delete_lifecycle_policy: BucketIdentity & { deleted: boolean }
  create_multipart_upload: { upload: NativeMultipartUpload }
  upload_part: ObjectResult & { uploadId: string; partNumber: number; size: number }
  list_multipart_uploads: BucketIdentity & {
    uploads: NativeMultipartUpload[]
    nextPage: string | null
  }
  list_multipart_parts: ObjectIdentity & { parts: NativeMultipartPart[]; nextPage: string | null }
  commit_multipart_upload: ObjectResult & { uploadId: string }
  abort_multipart_upload: ObjectResult & { uploadId: string; aborted: boolean }
  create_preauthenticated_request: { request: NativePreauthenticatedRequest; accessUrl: string }
  list_preauthenticated_requests: BucketIdentity & {
    requests: NativePreauthenticatedRequest[]
    nextPage: string | null
  }
  get_preauthenticated_request: { request: NativePreauthenticatedRequest }
  delete_preauthenticated_request: BucketIdentity & { parId: string; deleted: boolean }
  get_work_request: {
    workRequest: {
      id?: string
      compartmentId?: string
      operationType?: string
      status?: string
      percentComplete?: number
      timeAccepted?: string
      timeStarted?: string
      timeFinished?: string
    }
    resources: {
      entityType?: string
      actionType?: string
      entityUri?: string
      identifier?: string
    }[]
    retryAfter: string | null
  }
}
export interface OciObjectStorageNativeResponse<O extends OciNativeOperation = OciNativeOperation>
  extends ToolResponse {
  output: NativeOutputs[O] & { requestId: string | null }
}

export const OCI_NATIVE_REQUEST_ID_OUTPUT = {
  requestId: { type: 'string', description: 'Oracle request identifier', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const OCI_NATIVE_OBJECT_OUTPUTS = {
  namespace: { type: 'string', description: 'Object Storage namespace' },
  bucketName: { type: 'string', description: 'Bucket name' },
  objectName: { type: 'string', description: 'Exact object name' },
  etag: { type: 'string', description: 'Entity tag for conditional operations', nullable: true },
  versionId: { type: 'string', description: 'Object version ID', nullable: true },
  isDeleteMarker: {
    type: 'boolean',
    description: 'Whether this result identifies a delete marker',
    nullable: true,
  },
  contentLength: {
    type: 'number',
    description: 'Object byte length, when supplied by OCI',
    nullable: true,
  },
  contentType: { type: 'string', description: 'Content MIME type', nullable: true },
  lastModified: { type: 'string', description: 'Last-Modified HTTP date', nullable: true },
  contentMd5: { type: 'string', description: 'Content MD5 header', nullable: true },
  opcContentMd5: { type: 'string', description: 'Oracle content MD5 checksum', nullable: true },
  multipartMd5: { type: 'string', description: 'Oracle multipart MD5 checksum', nullable: true },
  contentEncoding: { type: 'string', description: 'Content encoding', nullable: true },
  contentLanguage: { type: 'string', description: 'Content language', nullable: true },
  contentDisposition: { type: 'string', description: 'Content disposition', nullable: true },
  cacheControl: { type: 'string', description: 'Cache-Control value', nullable: true },
  storageTier: {
    type: 'string',
    description: 'Standard, InfrequentAccess, or Archive',
    nullable: true,
  },
  archivalState: {
    type: 'string',
    description: 'Archived, Restoring, or Restored',
    nullable: true,
  },
  timeOfArchival: { type: 'string', description: 'Time the object was archived', nullable: true },
  metadata: { type: 'json', description: 'Custom object metadata with opc-meta- prefixes removed' },
} satisfies Record<string, ToolOutputProperty>

export const OCI_NATIVE_BUCKET_PROPERTIES = {
  namespace: { type: 'string', description: 'Namespace' },
  name: { type: 'string', description: 'Name' },
  compartmentId: { type: 'string', description: 'Compartment id' },
  createdBy: { type: 'string', description: 'Created by' },
  timeCreated: { type: 'string', description: 'Time created' },
  etag: { type: 'string', description: 'Etag' },
  metadata: { type: 'json', description: 'Metadata', optional: true },
  freeformTags: { type: 'json', description: 'Freeform tags', optional: true },
  definedTags: { type: 'json', description: 'Defined tags', optional: true },
  storageTier: { type: 'string', description: 'Storage tier', optional: true },
  versioning: { type: 'string', description: 'Versioning', optional: true },
  autoTiering: { type: 'string', description: 'Auto tiering', optional: true },
  objectEventsEnabled: { type: 'boolean', description: 'Object events enabled', optional: true },
  approximateCount: { type: 'number', description: 'Approximate count', optional: true },
  approximateSize: { type: 'number', description: 'Approximate size', optional: true },
  isReadOnly: { type: 'boolean', description: 'Is read only', optional: true },
  publicAccessType: { type: 'string', description: 'Public access type', optional: true },
  objectLifecyclePolicyEtag: {
    type: 'string',
    description: 'Object lifecycle policy etag',
    optional: true,
  },
} satisfies Record<string, ToolOutputProperty>

export const OCI_NATIVE_OBJECT_PROPERTIES = {
  name: { type: 'string', description: 'Name' },
  size: { type: 'number', description: 'Size', optional: true },
  etag: { type: 'string', description: 'Etag', optional: true },
  md5: { type: 'string', description: 'Md5', optional: true },
  timeCreated: { type: 'string', description: 'Time created', optional: true },
  timeModified: { type: 'string', description: 'Time modified', optional: true },
  storageTier: { type: 'string', description: 'Storage tier', optional: true },
  archivalState: { type: 'string', description: 'Archival state', optional: true },
} satisfies Record<string, ToolOutputProperty>

export const OCI_NATIVE_OBJECT_VERSION_PROPERTIES = {
  name: { type: 'string', description: 'Name' },
  size: { type: 'number', description: 'Size', optional: true },
  etag: { type: 'string', description: 'Etag', optional: true },
  md5: { type: 'string', description: 'Md5', optional: true },
  timeCreated: { type: 'string', description: 'Time created', optional: true },
  timeModified: { type: 'string', description: 'Time modified' },
  storageTier: { type: 'string', description: 'Storage tier', optional: true },
  archivalState: { type: 'string', description: 'Archival state', optional: true },
  versionId: { type: 'string', description: 'Version id' },
  isDeleteMarker: { type: 'boolean', description: 'Is delete marker' },
} satisfies Record<string, ToolOutputProperty>

export const OCI_NATIVE_UPLOAD_PROPERTIES = {
  namespace: { type: 'string', description: 'Namespace' },
  bucket: { type: 'string', description: 'Bucket' },
  object: { type: 'string', description: 'Object' },
  uploadId: { type: 'string', description: 'Upload id' },
  timeCreated: { type: 'string', description: 'Time created' },
  storageTier: { type: 'string', description: 'Storage tier', optional: true },
} satisfies Record<string, ToolOutputProperty>

export const OCI_NATIVE_PART_PROPERTIES = {
  partNumber: { type: 'number', description: 'Part number' },
  etag: { type: 'string', description: 'Etag' },
  md5: { type: 'string', description: 'Md5' },
  size: { type: 'number', description: 'Size' },
} satisfies Record<string, ToolOutputProperty>

export const OCI_NATIVE_PAR_PROPERTIES = {
  id: { type: 'string', description: 'Id' },
  name: { type: 'string', description: 'Name' },
  accessType: { type: 'string', description: 'Access type' },
  objectName: { type: 'string', description: 'Object name', optional: true },
  timeExpires: { type: 'string', description: 'Time expires' },
  timeCreated: { type: 'string', description: 'Time created' },
  bucketListingAction: { type: 'string', description: 'Bucket listing action', optional: true },
} satisfies Record<string, ToolOutputProperty>

export const OCI_NATIVE_RULE_PROPERTIES = {
  name: { type: 'string', description: 'Name' },
  action: { type: 'string', description: 'Action' },
  timeAmount: { type: 'number', description: 'Time amount' },
  timeUnit: { type: 'string', description: 'Time unit' },
  isEnabled: { type: 'boolean', description: 'Is enabled' },
  target: { type: 'string', description: 'Target', optional: true },
  objectNameFilter: {
    type: 'object',
    description: 'Object-name matching conditions',
    optional: true,
    properties: {
      inclusionPrefixes: {
        type: 'array',
        description: 'inclusionPrefixes',
        optional: true,
        items: { type: 'string' },
      },
      inclusionPatterns: {
        type: 'array',
        description: 'inclusionPatterns',
        optional: true,
        items: { type: 'string' },
      },
      exclusionPatterns: {
        type: 'array',
        description: 'exclusionPatterns',
        optional: true,
        items: { type: 'string' },
      },
    },
  },
} satisfies Record<string, ToolOutputProperty>

export const OCI_NATIVE_WORK_REQUEST_PROPERTIES = {
  id: { type: 'string', description: 'Id', optional: true },
  compartmentId: { type: 'string', description: 'Compartment id', optional: true },
  operationType: { type: 'string', description: 'Operation type', optional: true },
  status: {
    type: 'string',
    description: 'ACCEPTED, IN_PROGRESS, FAILED, COMPLETED, CANCELING or CANCELED',
    optional: true,
  },
  percentComplete: { type: 'number', description: 'Percent complete', optional: true },
  timeAccepted: { type: 'string', description: 'Time accepted', optional: true },
  timeStarted: { type: 'string', description: 'Time started', optional: true },
  timeFinished: { type: 'string', description: 'Time finished', optional: true },
} satisfies Record<string, ToolOutputProperty>

export const OCI_NATIVE_RESOURCE_PROPERTIES = {
  entityType: { type: 'string', description: 'Entity type', optional: true },
  actionType: { type: 'string', description: 'Action type', optional: true },
  entityUri: { type: 'string', description: 'Entity uri', optional: true },
  identifier: { type: 'string', description: 'Identifier', optional: true },
} satisfies Record<string, ToolOutputProperty>

export const OCI_NATIVE_DELETED_PROPERTIES = {
  objectName: { type: 'string', description: 'Object name' },
  timeLastModified: { type: 'string', description: 'Time last modified' },
} satisfies Record<string, ToolOutputProperty>

export const OCI_NATIVE_FAILED_PROPERTIES = {
  objectName: { type: 'string', description: 'Object name' },
  statusCode: { type: 'number', description: 'Status code' },
  errorMessage: { type: 'string', description: 'Error message' },
} satisfies Record<string, ToolOutputProperty>
