import {
  BlobSASPermissions,
  BlobServiceClient,
  generateBlobSASQueryParameters,
  StorageSharedKeyCredential,
} from '@azure/storage-blob'
import { BLOB_CONFIG } from '@/lib/uploads/setup'

// Lazily create a single Blob service client instance.
let _blobServiceClient: BlobServiceClient | null = null

export function getBlobServiceClient(): BlobServiceClient {
  if (_blobServiceClient) return _blobServiceClient

  const { accountName, accountKey, connectionString } = BLOB_CONFIG

  if (connectionString) {
    // Use connection string if provided
    _blobServiceClient = BlobServiceClient.fromConnectionString(connectionString)
  } else if (accountName && accountKey) {
    // Use account name and key
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
 * Sanitize a filename for use in blob metadata headers
 * Azure blob metadata headers must contain only ASCII printable characters
 * and cannot contain certain special characters
 */
export function sanitizeFilenameForMetadata(filename: string): string {
  return (
    filename
      // Remove non-ASCII characters (keep only printable ASCII 0x20-0x7E)
      .replace(/[^\x20-\x7E]/g, '')
      // Remove characters that are problematic in HTTP headers
      .replace(/["\\]/g, '')
      // Replace multiple spaces with single space
      .replace(/\s+/g, ' ')
      // Trim whitespace
      .trim() ||
    // Provide fallback if completely sanitized
    'file'
  )
}

/**
 * File information structure
 */
export interface FileInfo {
  path: string // Path to access the file
  key: string // Blob name or local filename
  name: string // Original filename
  size: number // File size in bytes
  type: string // MIME type
}

/**
 * Custom Blob configuration
 */
export interface CustomBlobConfig {
  containerName: string
  accountName: string
  accountKey?: string
  connectionString?: string
}

/**
 * Upload a file to Azure Blob Storage
 * @param file Buffer containing file data
 * @param fileName Original file name
 * @param contentType MIME type of the file
 * @param size File size in bytes (optional, will use buffer length if not provided)
 * @returns Object with file information
 */
export async function uploadToBlob(
  file: Buffer,
  fileName: string,
  contentType: string,
  size?: number
): Promise<FileInfo>

/**
 * Upload a file to Azure Blob Storage with custom container configuration
 * @param file Buffer containing file data
 * @param fileName Original file name
 * @param contentType MIME type of the file
 * @param customConfig Custom Blob configuration (container and account info)
 * @param size File size in bytes (optional, will use buffer length if not provided)
 * @returns Object with file information
 */
export async function uploadToBlob(
  file: Buffer,
  fileName: string,
  contentType: string,
  customConfig: CustomBlobConfig,
  size?: number
): Promise<FileInfo>

export async function uploadToBlob(
  file: Buffer,
  fileName: string,
  contentType: string,
  configOrSize?: CustomBlobConfig | number,
  size?: number
): Promise<FileInfo> {
  // Handle overloaded parameters
  let config: CustomBlobConfig
  let fileSize: number

  if (typeof configOrSize === 'object') {
    // Custom config provided
    config = configOrSize
    fileSize = size ?? file.length
  } else {
    // Use default config
    config = {
      containerName: BLOB_CONFIG.containerName,
      accountName: BLOB_CONFIG.accountName,
      accountKey: BLOB_CONFIG.accountKey,
      connectionString: BLOB_CONFIG.connectionString,
    }
    fileSize = configOrSize ?? file.length
  }

  // Create a unique filename with timestamp to prevent collisions
  // Use a simple timestamp without directory structure
  const safeFileName = fileName.replace(/\s+/g, '-') // Replace spaces with hyphens
  const uniqueKey = `${Date.now()}-${safeFileName}`

  const blobServiceClient = getBlobServiceClient()
  const containerClient = blobServiceClient.getContainerClient(config.containerName)
  const blockBlobClient = containerClient.getBlockBlobClient(uniqueKey)

  // Upload the file to Azure Blob Storage
  await blockBlobClient.upload(file, fileSize, {
    blobHTTPHeaders: {
      blobContentType: contentType,
    },
    metadata: {
      originalName: encodeURIComponent(fileName), // Encode filename to prevent invalid characters in HTTP headers
      uploadedAt: new Date().toISOString(),
    },
  })

  // Create a path for API to serve the file
  const servePath = `/api/files/serve/blob/${encodeURIComponent(uniqueKey)}`

  return {
    path: servePath,
    key: uniqueKey,
    name: fileName, // Return the actual original filename in the response
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
  const blobServiceClient = getBlobServiceClient()
  const containerClient = blobServiceClient.getContainerClient(BLOB_CONFIG.containerName)
  const blockBlobClient = containerClient.getBlockBlobClient(key)

  // Generate SAS token for the blob
  const sasOptions = {
    containerName: BLOB_CONFIG.containerName,
    blobName: key,
    permissions: BlobSASPermissions.parse('r'), // Read permission
    startsOn: new Date(),
    expiresOn: new Date(Date.now() + expiresIn * 1000),
  }

  const sasToken = generateBlobSASQueryParameters(
    sasOptions,
    new StorageSharedKeyCredential(
      BLOB_CONFIG.accountName,
      BLOB_CONFIG.accountKey ??
        (() => {
          throw new Error('AZURE_ACCOUNT_KEY is required when using account name authentication')
        })()
    )
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
  customConfig: CustomBlobConfig,
  expiresIn = 3600
) {
  // Create a temporary client for the custom config
  let tempBlobServiceClient: BlobServiceClient

  if (customConfig.connectionString) {
    tempBlobServiceClient = BlobServiceClient.fromConnectionString(customConfig.connectionString)
  } else if (customConfig.accountName && customConfig.accountKey) {
    const sharedKeyCredential = new StorageSharedKeyCredential(
      customConfig.accountName,
      customConfig.accountKey
    )
    tempBlobServiceClient = new BlobServiceClient(
      `https://${customConfig.accountName}.blob.core.windows.net`,
      sharedKeyCredential
    )
  } else {
    throw new Error(
      'Custom blob config must include either connectionString or accountName + accountKey'
    )
  }

  const containerClient = tempBlobServiceClient.getContainerClient(customConfig.containerName)
  const blockBlobClient = containerClient.getBlockBlobClient(key)

  // Generate SAS token for the blob
  const sasOptions = {
    containerName: customConfig.containerName,
    blobName: key,
    permissions: BlobSASPermissions.parse('r'), // Read permission
    startsOn: new Date(),
    expiresOn: new Date(Date.now() + expiresIn * 1000),
  }

  const sasToken = generateBlobSASQueryParameters(
    sasOptions,
    new StorageSharedKeyCredential(
      customConfig.accountName,
      customConfig.accountKey ??
        (() => {
          throw new Error('Account key is required when using account name authentication')
        })()
    )
  ).toString()

  return `${blockBlobClient.url}?${sasToken}`
}

/**
 * Download a file from Azure Blob Storage
 * @param key Blob name
 * @returns File buffer
 */
export async function downloadFromBlob(key: string) {
  const blobServiceClient = getBlobServiceClient()
  const containerClient = blobServiceClient.getContainerClient(BLOB_CONFIG.containerName)
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
export async function deleteFromBlob(key: string) {
  const blobServiceClient = getBlobServiceClient()
  const containerClient = blobServiceClient.getContainerClient(BLOB_CONFIG.containerName)
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
