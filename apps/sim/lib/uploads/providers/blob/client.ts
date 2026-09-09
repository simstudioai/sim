import type { Readable } from 'node:stream'
import type { BlobServiceClient as BlobServiceClientType } from '@azure/storage-blob'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import {
  assertKnownSizeWithinLimit,
  readNodeStreamToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { BLOB_CONFIG } from '@/lib/uploads/config'
import { isObjectNotFoundError } from '@/lib/uploads/core/errors'
import type {
  AzureMultipartPart,
  AzureMultipartUploadInit,
  AzurePartUploadUrl,
  BlobConfig,
} from '@/lib/uploads/providers/blob/types'
import type {
  FileInfo,
  MultipartCompletionPolicy,
  StoredObjectInfo,
} from '@/lib/uploads/shared/types'
import { sanitizeStorageMetadata } from '@/lib/uploads/utils/file-utils'
import { sanitizeFileName } from '@/executor/constants'

const logger = createLogger('BlobClient')
const MULTIPART_UPLOAD_ID_METADATA_KEY = 'sim_upload_id'
const MULTIPART_STATUS_METADATA_KEY = 'sim_multipart_status'

let _blobServiceClient: BlobServiceClientType | null = null

interface ParsedCredentials {
  accountName: string
  accountKey: string
}

function isBlobCreateConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const record = error as { statusCode?: unknown; code?: unknown }
  return (
    record.statusCode === 409 ||
    record.statusCode === 412 ||
    record.code === 'BlobAlreadyExists' ||
    record.code === 'ConditionNotMet'
  )
}

/**
 * Extract account name and key from an Azure connection string.
 * Connection strings have the format: DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=...
 */
export function parseConnectionString(connectionString: string): ParsedCredentials {
  const accountNameMatch = connectionString.match(/AccountName=([^;]+)/)
  if (!accountNameMatch) {
    throw new Error('Cannot extract account name from connection string')
  }

  const accountKeyMatch = connectionString.match(/AccountKey=([^;]+)/)
  if (!accountKeyMatch) {
    throw new Error('Cannot extract account key from connection string')
  }

  return {
    accountName: accountNameMatch[1],
    accountKey: accountKeyMatch[1],
  }
}

/**
 * Get account credentials from BLOB_CONFIG, extracting from connection string if necessary.
 */
function getAccountCredentials(): ParsedCredentials {
  if (BLOB_CONFIG.connectionString) {
    return parseConnectionString(BLOB_CONFIG.connectionString)
  }

  if (BLOB_CONFIG.accountName && BLOB_CONFIG.accountKey) {
    return {
      accountName: BLOB_CONFIG.accountName,
      accountKey: BLOB_CONFIG.accountKey,
    }
  }

  throw new Error(
    'Azure Blob Storage credentials are missing – set AZURE_CONNECTION_STRING or both AZURE_ACCOUNT_NAME and AZURE_ACCOUNT_KEY'
  )
}

export async function getBlobServiceClient(): Promise<BlobServiceClientType> {
  if (_blobServiceClient) return _blobServiceClient

  const { BlobServiceClient, StorageSharedKeyCredential } = await import('@azure/storage-blob')
  const { accountName, accountKey, connectionString } = BLOB_CONFIG

  if (connectionString) {
    _blobServiceClient = BlobServiceClient.fromConnectionString(connectionString)
  } else if (accountName && accountKey) {
    const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey)
    _blobServiceClient = new BlobServiceClient(
      `https://${accountName}.blob.core.windows.net`,
      sharedKeyCredential
    )
  } else {
    throw new Error(
      'Azure Blob Storage credentials are missing – set AZURE_STORAGE_CONNECTION_STRING or both AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_ACCOUNT_KEY in your environment.'
    )
  }

  return _blobServiceClient
}

/**
 * Upload a file to Azure Blob Storage
 * @param file Buffer containing file data
 * @param fileName Original file name
 * @param contentType MIME type of the file
 * @param configOrSize Custom Blob configuration OR file size in bytes (optional)
 * @param size File size in bytes (required if configOrSize is BlobConfig, optional otherwise)
 * @param preserveKey Preserve the fileName as the storage key without adding timestamp prefix (default: false)
 * @param metadata Optional metadata to store with the file
 * @param createOnly Reject an existing key instead of replacing its object
 * @returns Object with file information
 */
export async function uploadToBlob(
  file: Buffer,
  fileName: string,
  contentType: string,
  configOrSize?: BlobConfig | number,
  size?: number,
  preserveKey?: boolean,
  metadata?: Record<string, string>,
  createOnly = false,
  signal?: AbortSignal
): Promise<FileInfo> {
  signal?.throwIfAborted()
  let config: BlobConfig
  let fileSize: number
  let shouldPreserveKey: boolean

  if (typeof configOrSize === 'object') {
    config = configOrSize
    fileSize = size ?? file.length
    shouldPreserveKey = preserveKey ?? false
  } else {
    config = {
      containerName: BLOB_CONFIG.containerName,
      accountName: BLOB_CONFIG.accountName,
      accountKey: BLOB_CONFIG.accountKey,
      connectionString: BLOB_CONFIG.connectionString,
    }
    fileSize = configOrSize ?? file.length
    shouldPreserveKey = preserveKey ?? false
  }

  const safeFileName = sanitizeFileName(fileName)
  const uniqueKey = shouldPreserveKey ? fileName : `${Date.now()}-${safeFileName}`

  const blobServiceClient = await getBlobServiceClient()
  const containerClient = blobServiceClient.getContainerClient(config.containerName)
  const blockBlobClient = containerClient.getBlockBlobClient(uniqueKey)

  const blobMetadata: Record<string, string> = {
    originalName: encodeURIComponent(fileName), // Encode filename to prevent invalid characters in HTTP headers
    uploadedAt: new Date().toISOString(),
  }

  if (metadata) {
    Object.assign(blobMetadata, sanitizeStorageMetadata(metadata, 8000))
  }

  signal?.throwIfAborted()
  await blockBlobClient.upload(file, fileSize, {
    ...(signal ? { abortSignal: signal } : {}),
    blobHTTPHeaders: {
      blobContentType: contentType,
    },
    metadata: blobMetadata,
    ...(createOnly ? { conditions: { ifNoneMatch: '*' } } : {}),
  })
  signal?.throwIfAborted()

  const servePath = `/api/files/serve/${encodeURIComponent(uniqueKey)}`

  return {
    path: servePath,
    key: uniqueKey,
    name: fileName,
    size: fileSize,
    type: contentType,
  }
}

/**
 * Generate a presigned URL for direct file access
 * @param key Blob name
 * @param expiresIn Time in seconds until URL expires
 * @returns Presigned URL
 */
export async function getPresignedUrl(key: string, expiresIn = 3600) {
  const { BlobSASPermissions, generateBlobSASQueryParameters, StorageSharedKeyCredential } =
    await import('@azure/storage-blob')
  const blobServiceClient = await getBlobServiceClient()
  const containerClient = blobServiceClient.getContainerClient(BLOB_CONFIG.containerName)
  const blockBlobClient = containerClient.getBlockBlobClient(key)

  const { accountName, accountKey } = getAccountCredentials()

  const sasOptions = {
    containerName: BLOB_CONFIG.containerName,
    blobName: key,
    permissions: BlobSASPermissions.parse('r'), // Read permission
    startsOn: new Date(),
    expiresOn: new Date(Date.now() + expiresIn * 1000),
  }

  const sasToken = generateBlobSASQueryParameters(
    sasOptions,
    new StorageSharedKeyCredential(accountName, accountKey)
  ).toString()

  return `${blockBlobClient.url}?${sasToken}`
}

/**
 * Generate a presigned URL for direct file access with custom container
 * @param key Blob name
 * @param customConfig Custom Blob configuration
 * @param expiresIn Time in seconds until URL expires
 * @returns Presigned URL
 */
export async function getPresignedUrlWithConfig(
  key: string,
  customConfig: BlobConfig,
  expiresIn = 3600
) {
  const {
    BlobServiceClient,
    BlobSASPermissions,
    generateBlobSASQueryParameters,
    StorageSharedKeyCredential,
  } = await import('@azure/storage-blob')
  let tempBlobServiceClient: BlobServiceClientType
  let accountName: string
  let accountKey: string

  if (customConfig.connectionString) {
    tempBlobServiceClient = BlobServiceClient.fromConnectionString(customConfig.connectionString)
    const credentials = parseConnectionString(customConfig.connectionString)
    accountName = credentials.accountName
    accountKey = credentials.accountKey
  } else if (customConfig.accountName && customConfig.accountKey) {
    const sharedKeyCredential = new StorageSharedKeyCredential(
      customConfig.accountName,
      customConfig.accountKey
    )
    tempBlobServiceClient = new BlobServiceClient(
      `https://${customConfig.accountName}.blob.core.windows.net`,
      sharedKeyCredential
    )
    accountName = customConfig.accountName
    accountKey = customConfig.accountKey
  } else {
    throw new Error(
      'Custom blob config must include either connectionString or accountName + accountKey'
    )
  }

  const containerClient = tempBlobServiceClient.getContainerClient(customConfig.containerName)
  const blockBlobClient = containerClient.getBlockBlobClient(key)

  const sasOptions = {
    containerName: customConfig.containerName,
    blobName: key,
    permissions: BlobSASPermissions.parse('r'), // Read permission
    startsOn: new Date(),
    expiresOn: new Date(Date.now() + expiresIn * 1000),
  }

  const sasToken = generateBlobSASQueryParameters(
    sasOptions,
    new StorageSharedKeyCredential(accountName, accountKey)
  ).toString()

  return `${blockBlobClient.url}?${sasToken}`
}

/**
 * Generates a create-only SAS-backed single-object PUT for a caller-selected final key.
 *
 * The permission must stay `c` (create), not `w`: `w` is "create or write
 * content" and authorizes overwriting an existing blob, so a still-valid
 * signature could replace a completed upload. `If-None-Match` is returned for
 * parity with the S3 and GCS signers, but Azure does not cover request headers
 * in a service-SAS string-to-sign, so it is advisory and cannot carry this on
 * its own.
 */
export async function getBlobPresignedUploadUrl(params: {
  key: string
  contentType: string
  metadata: Record<string, string>
  customConfig: BlobConfig
  expiresIn: number
}): Promise<{ url: string; headers: Record<string, string> }> {
  const { BlobSASPermissions, generateBlobSASQueryParameters, StorageSharedKeyCredential } =
    await import('@azure/storage-blob')
  const client = await getBlockBlobClientFor(params.key, params.customConfig)
  const credentials = params.customConfig.connectionString
    ? parseConnectionString(params.customConfig.connectionString)
    : {
        accountName: params.customConfig.accountName,
        accountKey: params.customConfig.accountKey,
      }
  if (!credentials.accountName || !credentials.accountKey) {
    throw new Error('Azure Blob SAS generation requires accountName and accountKey')
  }
  const startsOn = new Date()
  const expiresOn = new Date(startsOn.getTime() + params.expiresIn * 1000)
  const sasToken = generateBlobSASQueryParameters(
    {
      containerName: params.customConfig.containerName,
      blobName: params.key,
      permissions: BlobSASPermissions.parse('c'),
      startsOn,
      expiresOn,
    },
    new StorageSharedKeyCredential(credentials.accountName, credentials.accountKey)
  ).toString()
  const metadata = sanitizeStorageMetadata(params.metadata, 8000)
  return {
    url: `${client.url}?${sasToken}`,
    headers: {
      'Content-Type': params.contentType,
      'If-None-Match': '*',
      'x-ms-blob-type': 'BlockBlob',
      'x-ms-blob-content-type': params.contentType,
      ...Object.fromEntries(
        Object.entries(metadata).map(([key, value]) => [`x-ms-meta-${key}`, value])
      ),
    },
  }
}

/**
 * Download a file from Azure Blob Storage
 * @param key Blob name
 * @returns File buffer
 */
export async function downloadFromBlob(key: string): Promise<Buffer>

/**
 * Download a file from Azure Blob Storage with custom configuration
 * @param key Blob name
 * @param customConfig Custom Blob configuration
 * @returns File buffer
 */
export async function downloadFromBlob(key: string, customConfig: BlobConfig): Promise<Buffer>

export async function downloadFromBlob(
  key: string,
  customConfig: BlobConfig,
  maxBytes: number
): Promise<Buffer>

export async function downloadFromBlob(
  key: string,
  customConfig: BlobConfig | undefined,
  maxBytes: number | undefined,
  signal: AbortSignal | undefined
): Promise<Buffer>

export async function downloadFromBlob(
  key: string,
  customConfig?: BlobConfig,
  maxBytes?: number,
  signal?: AbortSignal
): Promise<Buffer> {
  const { BlobServiceClient, StorageSharedKeyCredential } = await import('@azure/storage-blob')
  let blobServiceClient: BlobServiceClientType
  let containerName: string

  if (customConfig) {
    if (customConfig.connectionString) {
      blobServiceClient = BlobServiceClient.fromConnectionString(customConfig.connectionString)
    } else if (customConfig.accountName && customConfig.accountKey) {
      const credential = new StorageSharedKeyCredential(
        customConfig.accountName,
        customConfig.accountKey
      )
      blobServiceClient = new BlobServiceClient(
        `https://${customConfig.accountName}.blob.core.windows.net`,
        credential
      )
    } else {
      throw new Error('Invalid custom blob configuration')
    }
    containerName = customConfig.containerName
  } else {
    blobServiceClient = await getBlobServiceClient()
    containerName = BLOB_CONFIG.containerName
  }

  const containerClient = blobServiceClient.getContainerClient(containerName)
  const blockBlobClient = containerClient.getBlockBlobClient(key)

  const downloadBlockBlobResponse = await blockBlobClient.download(0, undefined, {
    abortSignal: signal,
  })
  if (maxBytes !== undefined && downloadBlockBlobResponse.contentLength !== undefined) {
    try {
      assertKnownSizeWithinLimit(
        downloadBlockBlobResponse.contentLength,
        maxBytes,
        'storage download'
      )
    } catch (error) {
      const stream = downloadBlockBlobResponse.readableStreamBody as
        | { destroy?: (error?: Error) => void }
        | undefined
      stream?.destroy?.(error instanceof Error ? error : undefined)
      throw error
    }
  }

  if (!downloadBlockBlobResponse.readableStreamBody) {
    throw new Error('Failed to get readable stream from blob download')
  }
  const downloaded = await readNodeStreamToBufferWithLimit(
    downloadBlockBlobResponse.readableStreamBody,
    {
      maxBytes: maxBytes ?? Number.MAX_SAFE_INTEGER,
      label: 'storage download',
      signal,
    }
  )

  return downloaded
}

/**
 * Stream a blob out of storage without buffering it. The caller MUST fully consume or
 * `destroy()` the returned stream. Used by the large-CSV import worker.
 */
export async function downloadFromBlobStream(
  key: string,
  customConfig?: BlobConfig
): Promise<Readable> {
  const { BlobServiceClient, StorageSharedKeyCredential } = await import('@azure/storage-blob')
  let blobServiceClient: BlobServiceClientType
  let containerName: string

  if (customConfig) {
    if (customConfig.connectionString) {
      blobServiceClient = BlobServiceClient.fromConnectionString(customConfig.connectionString)
    } else if (customConfig.accountName && customConfig.accountKey) {
      const credential = new StorageSharedKeyCredential(
        customConfig.accountName,
        customConfig.accountKey
      )
      blobServiceClient = new BlobServiceClient(
        `https://${customConfig.accountName}.blob.core.windows.net`,
        credential
      )
    } else {
      throw new Error('Invalid custom blob configuration')
    }
    containerName = customConfig.containerName
  } else {
    blobServiceClient = await getBlobServiceClient()
    containerName = BLOB_CONFIG.containerName
  }

  const containerClient = blobServiceClient.getContainerClient(containerName)
  const blockBlobClient = containerClient.getBlockBlobClient(key)

  const downloadBlockBlobResponse = await blockBlobClient.download()
  if (!downloadBlockBlobResponse.readableStreamBody) {
    throw new Error('Failed to get readable stream from blob download')
  }
  return downloadBlockBlobResponse.readableStreamBody as Readable
}

/**
 * Check whether a blob exists (and return its size when it does).
 * Returns null when the blob is missing.
 */
export async function headBlobObject(
  key: string,
  customConfig?: BlobConfig
): Promise<StoredObjectInfo | null> {
  const { BlobServiceClient, StorageSharedKeyCredential } = await import('@azure/storage-blob')
  let blobServiceClient: BlobServiceClientType
  let containerName: string

  if (customConfig) {
    if (customConfig.connectionString) {
      blobServiceClient = BlobServiceClient.fromConnectionString(customConfig.connectionString)
    } else if (customConfig.accountName && customConfig.accountKey) {
      const credential = new StorageSharedKeyCredential(
        customConfig.accountName,
        customConfig.accountKey
      )
      blobServiceClient = new BlobServiceClient(
        `https://${customConfig.accountName}.blob.core.windows.net`,
        credential
      )
    } else {
      throw new Error('Invalid custom blob configuration')
    }
    containerName = customConfig.containerName
  } else {
    blobServiceClient = await getBlobServiceClient()
    containerName = BLOB_CONFIG.containerName
  }

  const containerClient = blobServiceClient.getContainerClient(containerName)
  const blockBlobClient = containerClient.getBlockBlobClient(key)

  try {
    const properties = await blockBlobClient.getProperties()
    if (properties.copyStatus && properties.copyStatus !== 'success') {
      throw new Error(`Blob copy for ${key} is ${properties.copyStatus}`)
    }
    const uploadId = readUploadId(properties.metadata)
    return {
      size: properties.contentLength ?? 0,
      contentType: properties.contentType,
      ...(uploadId ? { uploadId } : {}),
      ...(properties.etag ? { version: properties.etag } : {}),
      ...(properties.metadata ? { metadata: properties.metadata } : {}),
    }
  } catch (err) {
    if (isObjectNotFoundError(err)) {
      return null
    }
    throw err
  }
}

/** Deletes an upload blob only if it is still the version the caller inspected. */
export async function deleteBlobObjectVersion(params: {
  key: string
  etag: string
  customConfig: BlobConfig
}): Promise<void> {
  if (!params.etag) throw new Error('Blob upload object is missing its ETag')
  const client = await getBlockBlobClientFor(params.key, params.customConfig)
  await client.deleteIfExists({ conditions: { ifMatch: params.etag } })
}

/**
 * Delete a file from Azure Blob Storage
 * @param key Blob name
 */
export async function deleteFromBlob(key: string): Promise<void>

/**
 * Delete a file from Azure Blob Storage with custom configuration
 * @param key Blob name
 * @param customConfig Custom Blob configuration
 */
export async function deleteFromBlob(
  key: string,
  customConfig: BlobConfig | undefined,
  signal?: AbortSignal
): Promise<void>

export async function deleteFromBlob(
  key: string,
  customConfig?: BlobConfig,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted()
  const { BlobServiceClient, StorageSharedKeyCredential } = await import('@azure/storage-blob')
  let blobServiceClient: BlobServiceClientType
  let containerName: string

  if (customConfig) {
    if (customConfig.connectionString) {
      blobServiceClient = BlobServiceClient.fromConnectionString(customConfig.connectionString)
    } else if (customConfig.accountName && customConfig.accountKey) {
      const credential = new StorageSharedKeyCredential(
        customConfig.accountName,
        customConfig.accountKey
      )
      blobServiceClient = new BlobServiceClient(
        `https://${customConfig.accountName}.blob.core.windows.net`,
        credential
      )
    } else {
      throw new Error('Invalid custom blob configuration')
    }
    containerName = customConfig.containerName
  } else {
    blobServiceClient = await getBlobServiceClient()
    containerName = BLOB_CONFIG.containerName
  }

  const containerClient = blobServiceClient.getContainerClient(containerName)
  const blockBlobClient = containerClient.getBlockBlobClient(key)

  signal?.throwIfAborted()
  await blockBlobClient.deleteIfExists(...(signal ? [{ abortSignal: signal }] : []))
  signal?.throwIfAborted()
}

/**
 * Derive the deterministic Azure block id for a given part number.
 * Block ids must be base64-encoded and equal length within an upload; using a
 * fixed-width zero-padded counter gives both properties for free, and lets the
 * server reconstruct the id from `partNumber` alone when completing an upload.
 */
export function deriveBlobBlockId(partNumber: number): string {
  return Buffer.from(`block-${partNumber.toString().padStart(6, '0')}`).toString('base64')
}

/**
 * Initiate a multipart upload for Azure Blob Storage
 */
export async function initiateMultipartUpload(
  options: AzureMultipartUploadInit
): Promise<{ uploadId: string; key: string }> {
  const { fileName, customConfig, customKey } = options

  if (customConfig) {
    if (!customConfig.connectionString && !(customConfig.accountName && customConfig.accountKey)) {
      throw new Error('Invalid custom blob configuration')
    }
  } else {
    await getBlobServiceClient()
  }

  const safeFileName = sanitizeFileName(fileName)
  const uniqueKey = customKey || `kb/${generateId()}-${safeFileName}`

  const uploadId = generateId()

  return {
    uploadId,
    key: uniqueKey,
  }
}

/**
 * Generate presigned URLs for uploading parts.
 *
 * `expiresOn` is required rather than defaulted: the caller owns the part-URL lifetime and
 * advertises the matching `expiresAt` to the client, so a local default would be a second
 * source of truth that silently keeps signing 1h SAS tokens after the caller's window changed.
 */
export async function getMultipartPartUrls(
  key: string,
  partNumbers: number[],
  customConfig: BlobConfig | undefined,
  /** Absolute instant the SAS token stops being valid. */
  expiresOn: Date
): Promise<AzurePartUploadUrl[]> {
  const {
    BlobServiceClient,
    BlobSASPermissions,
    generateBlobSASQueryParameters,
    StorageSharedKeyCredential,
  } = await import('@azure/storage-blob')
  let blobServiceClient: BlobServiceClientType
  let containerName: string
  let accountName: string
  let accountKey: string

  if (customConfig) {
    if (customConfig.connectionString) {
      blobServiceClient = BlobServiceClient.fromConnectionString(customConfig.connectionString)
      const credentials = parseConnectionString(customConfig.connectionString)
      accountName = credentials.accountName
      accountKey = credentials.accountKey
    } else if (customConfig.accountName && customConfig.accountKey) {
      const credential = new StorageSharedKeyCredential(
        customConfig.accountName,
        customConfig.accountKey
      )
      blobServiceClient = new BlobServiceClient(
        `https://${customConfig.accountName}.blob.core.windows.net`,
        credential
      )
      accountName = customConfig.accountName
      accountKey = customConfig.accountKey
    } else {
      throw new Error('Invalid custom blob configuration')
    }
    containerName = customConfig.containerName
  } else {
    blobServiceClient = await getBlobServiceClient()
    containerName = BLOB_CONFIG.containerName
    const credentials = getAccountCredentials()
    accountName = credentials.accountName
    accountKey = credentials.accountKey
  }

  const containerClient = blobServiceClient.getContainerClient(containerName)
  const blockBlobClient = containerClient.getBlockBlobClient(key)

  return partNumbers.map((partNumber) => {
    const blockId = deriveBlobBlockId(partNumber)

    const sasOptions = {
      containerName,
      blobName: key,
      permissions: BlobSASPermissions.parse('w'), // Write permission
      startsOn: new Date(),
      expiresOn,
    }

    const sasToken = generateBlobSASQueryParameters(
      sasOptions,
      new StorageSharedKeyCredential(accountName, accountKey)
    ).toString()

    return {
      partNumber,
      blockId,
      url: `${blockBlobClient.url}?comp=block&blockid=${encodeURIComponent(blockId)}&${sasToken}`,
    }
  })
}

/** Lists uncommitted blocks and maps canonical block ids back to part numbers. */
export async function listMultipartParts(
  key: string,
  customConfig?: BlobConfig
): Promise<Array<{ partNumber: number; size: number }>> {
  const blockBlobClient = await getBlockBlobClientFor(key, customConfig)
  const response = await blockBlobClient.getBlockList('uncommitted')
  return (response.uncommittedBlocks ?? []).map((block) => {
    const decoded = Buffer.from(block.name, 'base64').toString('utf8')
    const match = decoded.match(/^block-(\d{6})$/)
    if (!match || deriveBlobBlockId(Number(match[1])) !== block.name) {
      throw new Error(`Azure returned an invalid block id for ${key}`)
    }
    return { partNumber: Number(match[1]), size: block.size }
  })
}

async function getBlockBlobClientFor(key: string, customConfig?: BlobConfig) {
  const { BlobServiceClient, StorageSharedKeyCredential } = await import('@azure/storage-blob')
  let blobServiceClient: BlobServiceClientType
  let containerName: string

  if (customConfig) {
    if (customConfig.connectionString) {
      blobServiceClient = BlobServiceClient.fromConnectionString(customConfig.connectionString)
    } else if (customConfig.accountName && customConfig.accountKey) {
      const credential = new StorageSharedKeyCredential(
        customConfig.accountName,
        customConfig.accountKey
      )
      blobServiceClient = new BlobServiceClient(
        `https://${customConfig.accountName}.blob.core.windows.net`,
        credential
      )
    } else {
      throw new Error('Invalid custom blob configuration')
    }
    containerName = customConfig.containerName
  } else {
    blobServiceClient = await getBlobServiceClient()
    containerName = BLOB_CONFIG.containerName
  }

  return blobServiceClient.getContainerClient(containerName).getBlockBlobClient(key)
}

/**
 * Stage a single block from the server (body in hand), returning its
 * `{ partNumber, blockId }`. The server-side streaming counterpart to the
 * presigned {@link getMultipartPartUrls}.
 */
export async function stageBlobPart(
  key: string,
  partNumber: number,
  body: Buffer,
  customConfig?: BlobConfig
): Promise<AzureMultipartPart> {
  const blockBlobClient = await getBlockBlobClientFor(key, customConfig)
  const blockId = deriveBlobBlockId(partNumber)
  await blockBlobClient.stageBlock(blockId, body, body.length)
  return { partNumber, blockId }
}

/**
 * Commit staged blocks into the final blob, setting the content type. Used by the
 * server-side streaming uploader (the KB flow uses {@link completeMultipartUpload}).
 */
export async function commitBlobBlockList(
  key: string,
  uploadId: string,
  parts: AzureMultipartPart[],
  contentType: string,
  customConfig?: BlobConfig,
  completionPolicy: MultipartCompletionPolicy = 'create-only'
): Promise<void> {
  const blockBlobClient = await getBlockBlobClientFor(key, customConfig)
  const sortedBlockIds = parts.sort((a, b) => a.partNumber - b.partNumber).map((p) => p.blockId)
  try {
    await blockBlobClient.commitBlockList(sortedBlockIds, {
      blobHTTPHeaders: { blobContentType: contentType },
      ...(completionPolicy === 'replace' ? {} : { conditions: { ifNoneMatch: '*' } }),
      metadata: {
        [MULTIPART_UPLOAD_ID_METADATA_KEY]: uploadId,
        [MULTIPART_STATUS_METADATA_KEY]: 'completed',
      },
    })
  } catch (error) {
    const properties = await blockBlobClient.getProperties().catch(() => null)
    const isSameUpload = properties?.metadata?.[MULTIPART_UPLOAD_ID_METADATA_KEY] === uploadId
    const canReuseExisting =
      completionPolicy === 'reuse-existing' && isBlobCreateConflict(error) && properties !== null
    if (!isSameUpload && !canReuseExisting) {
      throw error
    }
  }
}

/**
 * Complete multipart upload by committing all blocks
 */
export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: AzureMultipartPart[],
  customConfig?: BlobConfig,
  contentType?: string,
  metadata?: Record<string, string>,
  completionPolicy: MultipartCompletionPolicy = 'create-only'
): Promise<{ location: string; path: string; key: string }> {
  const { BlobServiceClient, StorageSharedKeyCredential } = await import('@azure/storage-blob')
  let blobServiceClient: BlobServiceClientType
  let containerName: string

  if (customConfig) {
    if (customConfig.connectionString) {
      blobServiceClient = BlobServiceClient.fromConnectionString(customConfig.connectionString)
    } else if (customConfig.accountName && customConfig.accountKey) {
      const credential = new StorageSharedKeyCredential(
        customConfig.accountName,
        customConfig.accountKey
      )
      blobServiceClient = new BlobServiceClient(
        `https://${customConfig.accountName}.blob.core.windows.net`,
        credential
      )
    } else {
      throw new Error('Invalid custom blob configuration')
    }
    containerName = customConfig.containerName
  } else {
    blobServiceClient = await getBlobServiceClient()
    containerName = BLOB_CONFIG.containerName
  }

  const containerClient = blobServiceClient.getContainerClient(containerName)
  const blockBlobClient = containerClient.getBlockBlobClient(key)

  const sortedBlockIds = parts
    .sort((a, b) => a.partNumber - b.partNumber)
    .map((part) => part.blockId)

  try {
    await blockBlobClient.commitBlockList(sortedBlockIds, {
      ...(contentType ? { blobHTTPHeaders: { blobContentType: contentType } } : {}),
      ...(completionPolicy === 'replace' ? {} : { conditions: { ifNoneMatch: '*' } }),
      metadata: {
        [MULTIPART_UPLOAD_ID_METADATA_KEY]: uploadId,
        [MULTIPART_STATUS_METADATA_KEY]: 'completed',
        uploadCompletedAt: new Date().toISOString(),
        ...sanitizeStorageMetadata(metadata ?? {}, 8000),
      },
    })
  } catch (error) {
    const properties = await blockBlobClient.getProperties().catch(() => null)
    const isSameUpload = properties?.metadata?.[MULTIPART_UPLOAD_ID_METADATA_KEY] === uploadId
    const canReuseExisting =
      completionPolicy === 'reuse-existing' && isBlobCreateConflict(error) && properties !== null
    if (!isSameUpload && !canReuseExisting) {
      const existingMetadata = properties?.metadata ?? {}
      const legacyUploadId = existingMetadata.uploadId ?? existingMetadata.uploadid
      const legacyStatus = existingMetadata.multipartUpload ?? existingMetadata.multipartupload
      if (
        completionPolicy !== 'create-only' ||
        !isBlobCreateConflict(error) ||
        legacyUploadId !== uploadId ||
        legacyStatus !== 'true' ||
        !properties?.etag
      ) {
        throw error
      }
      await blockBlobClient.commitBlockList(sortedBlockIds, {
        conditions: { ifMatch: properties.etag },
        ...(contentType ? { blobHTTPHeaders: { blobContentType: contentType } } : {}),
        metadata: {
          [MULTIPART_UPLOAD_ID_METADATA_KEY]: uploadId,
          [MULTIPART_STATUS_METADATA_KEY]: 'completed',
          uploadCompletedAt: new Date().toISOString(),
          ...sanitizeStorageMetadata(metadata ?? {}, 8000),
        },
      })
    }
  }

  const location = blockBlobClient.url
  const path = `/api/files/serve/${encodeURIComponent(key)}`

  return {
    location,
    path,
    key,
  }
}

/**
 * Aborts without deleting committed bytes. New uploads only stage uncommitted
 * blocks, which Azure expires automatically. The guarded delete is retained
 * solely for legacy pending placeholders created by older application nodes.
 */
export async function abortMultipartUpload(
  key: string,
  uploadId: string,
  customConfig?: BlobConfig
): Promise<void> {
  const { BlobServiceClient, StorageSharedKeyCredential } = await import('@azure/storage-blob')
  let blobServiceClient: BlobServiceClientType
  let containerName: string

  if (customConfig) {
    if (customConfig.connectionString) {
      blobServiceClient = BlobServiceClient.fromConnectionString(customConfig.connectionString)
    } else if (customConfig.accountName && customConfig.accountKey) {
      const credential = new StorageSharedKeyCredential(
        customConfig.accountName,
        customConfig.accountKey
      )
      blobServiceClient = new BlobServiceClient(
        `https://${customConfig.accountName}.blob.core.windows.net`,
        credential
      )
    } else {
      throw new Error('Invalid custom blob configuration')
    }
    containerName = customConfig.containerName
  } else {
    blobServiceClient = await getBlobServiceClient()
    containerName = BLOB_CONFIG.containerName
  }

  const containerClient = blobServiceClient.getContainerClient(containerName)
  const blockBlobClient = containerClient.getBlockBlobClient(key)

  try {
    const properties = await blockBlobClient.getProperties()
    const metadata = properties.metadata ?? {}
    const boundUploadId =
      metadata[MULTIPART_UPLOAD_ID_METADATA_KEY] ?? metadata.uploadId ?? metadata.uploadid
    const status =
      metadata[MULTIPART_STATUS_METADATA_KEY] ??
      metadata.multipartUpload ??
      metadata.multipartupload
    if (boundUploadId === uploadId && status !== 'completed') {
      await blockBlobClient.deleteIfExists()
    }
  } catch (error) {
    if (!isObjectNotFoundError(error)) {
      logger.warn('Error cleaning up multipart upload:', error)
    }
  }
}

function readUploadId(metadata?: Record<string, string>): string | undefined {
  if (!metadata) return undefined
  return (
    metadata[MULTIPART_UPLOAD_ID_METADATA_KEY] ??
    Object.entries(metadata).find(([key]) => key.toLowerCase() === 'uploadid')?.[1]
  )
}
