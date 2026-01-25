import { createLogger } from '@sim/logger'
import { BLOB_CONFIG } from '@/lib/uploads/config'
import type {
  AzureMultipartPart,
  AzureMultipartUploadInit,
  AzurePartUploadUrl,
  BlobConfig,
} from '@/lib/uploads/providers/blob/types'
import type { FileInfo } from '@/lib/uploads/shared/types'
import { sanitizeStorageMetadata } from '@/lib/uploads/utils/file-utils'
import { sanitizeFileName } from '@/executor/constants'

type BlobServiceClientInstance = Awaited<
  ReturnType<typeof import('@azure/storage-blob').BlobServiceClient.fromConnectionString>
>

const logger = createLogger('BlobClient')

let _blobServiceClient: BlobServiceClientInstance | null = null

interface ParsedCredentials {
  accountName: string
  accountKey: string
}

/**
 * Extract account name and key from an Azure connection string.
 * Connection strings have the format: DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=...
 */
function parseConnectionString(connectionString: string): ParsedCredentials {
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

export async function getBlobServiceClient(): Promise<BlobServiceClientInstance> {
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
 * @returns Object with file information
 */
export async function uploadToBlob(
  file: Buffer,
  fileName: string,
  contentType: string,
  configOrSize?: BlobConfig | number,
  size?: number,
  preserveKey?: boolean,
  metadata?: Record<string, string>
): Promise<FileInfo> {
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

  await blockBlobClient.upload(file, fileSize, {
    blobHTTPHeaders: {
      blobContentType: contentType,
    },
    metadata: blobMetadata,
  })

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
  let tempBlobServiceClient: BlobServiceClientInstance
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

export async function downloadFromBlob(key: string, customConfig?: BlobConfig): Promise<Buffer> {
  const { BlobServiceClient, StorageSharedKeyCredential } = await import('@azure/storage-blob')
  let blobServiceClient: BlobServiceClientInstance
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
  const downloaded = await streamToBuffer(downloadBlockBlobResponse.readableStreamBody)

  return downloaded
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
export async function deleteFromBlob(key: string, customConfig: BlobConfig): Promise<void>

export async function deleteFromBlob(key: string, customConfig?: BlobConfig): Promise<void> {
  const { BlobServiceClient, StorageSharedKeyCredential } = await import('@azure/storage-blob')
  let blobServiceClient: BlobServiceClientInstance
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

  await blockBlobClient.delete()
}

/**
 * Helper function to convert a readable stream to a Buffer
 */
async function streamToBuffer(readableStream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    readableStream.on('data', (data) => {
      chunks.push(data instanceof Buffer ? data : Buffer.from(data))
    })
    readableStream.on('end', () => {
      resolve(Buffer.concat(chunks))
    })
    readableStream.on('error', reject)
  })
}

/**
 * Initiate a multipart upload for Azure Blob Storage
 */
export async function initiateMultipartUpload(
  options: AzureMultipartUploadInit
): Promise<{ uploadId: string; key: string }> {
  const { BlobServiceClient, StorageSharedKeyCredential } = await import('@azure/storage-blob')
  const { fileName, contentType, customConfig } = options

  let blobServiceClient: BlobServiceClientInstance
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

  const safeFileName = sanitizeFileName(fileName)
  const { v4: uuidv4 } = await import('uuid')
  const uniqueKey = `kb/${uuidv4()}-${safeFileName}`

  const uploadId = uuidv4()

  const containerClient = blobServiceClient.getContainerClient(containerName)
  const blockBlobClient = containerClient.getBlockBlobClient(uniqueKey)

  await blockBlobClient.setMetadata({
    uploadId,
    fileName: encodeURIComponent(fileName),
    contentType,
    uploadStarted: new Date().toISOString(),
    multipartUpload: 'true',
  })

  return {
    uploadId,
    key: uniqueKey,
  }
}

/**
 * Generate presigned URLs for uploading parts
 */
export async function getMultipartPartUrls(
  key: string,
  partNumbers: number[],
  customConfig?: BlobConfig
): Promise<AzurePartUploadUrl[]> {
  const {
    BlobServiceClient,
    BlobSASPermissions,
    generateBlobSASQueryParameters,
    StorageSharedKeyCredential,
  } = await import('@azure/storage-blob')
  let blobServiceClient: BlobServiceClientInstance
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
    const blockId = Buffer.from(`block-${partNumber.toString().padStart(6, '0')}`).toString(
      'base64'
    )

    const sasOptions = {
      containerName,
      blobName: key,
      permissions: BlobSASPermissions.parse('w'), // Write permission
      startsOn: new Date(),
      expiresOn: new Date(Date.now() + 3600 * 1000), // 1 hour
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

/**
 * Complete multipart upload by committing all blocks
 */
export async function completeMultipartUpload(
  key: string,
  parts: AzureMultipartPart[],
  customConfig?: BlobConfig
): Promise<{ location: string; path: string; key: string }> {
  const { BlobServiceClient, StorageSharedKeyCredential } = await import('@azure/storage-blob')
  let blobServiceClient: BlobServiceClientInstance
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

  await blockBlobClient.commitBlockList(sortedBlockIds, {
    metadata: {
      multipartUpload: 'completed',
      uploadCompletedAt: new Date().toISOString(),
    },
  })

  const location = blockBlobClient.url
  const path = `/api/files/serve/${encodeURIComponent(key)}`

  return {
    location,
    path,
    key,
  }
}

/**
 * Abort multipart upload by deleting the blob if it exists
 */
export async function abortMultipartUpload(key: string, customConfig?: BlobConfig): Promise<void> {
  const { BlobServiceClient, StorageSharedKeyCredential } = await import('@azure/storage-blob')
  let blobServiceClient: BlobServiceClientInstance
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
    await blockBlobClient.deleteIfExists()
  } catch (error) {
    logger.warn('Error cleaning up multipart upload:', error)
  }
}
