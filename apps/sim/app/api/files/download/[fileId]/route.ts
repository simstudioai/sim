import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('FileDownloadAPI')

/**
 * Generate a short-lived presigned URL for secure file download
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const { fileId } = await params

    if (!fileId) {
      return NextResponse.json({ error: 'File ID is required' }, { status: 400 })
    }

    // The fileId parameter can be either:
    // 1. An execution ID (returns first file)
    // 2. A file ID in format "executionId_fileId"
    let executionId: string
    let targetFileId: string | undefined

    // Check if this looks like "executionId_file_timestamp_random" format
    if (fileId.includes('_file_')) {
      // Split on "_file_" to separate execution ID from file ID
      const parts = fileId.split('_file_')
      if (parts.length === 2) {
        executionId = parts[0]
        targetFileId = `file_${parts[1]}`
      } else {
        executionId = fileId
      }
    } else if (fileId.startsWith('file_')) {
      // This is just a file ID - we need the execution ID too
      return NextResponse.json(
        {
          error: 'Please provide file ID in format: executionId_fileId',
        },
        { status: 400 }
      )
    } else {
      // This is an execution ID
      executionId = fileId
    }

    // Get files for this execution
    const { getExecutionFiles } = await import('@/lib/workflows/execution-files-server')
    const executionFiles = await getExecutionFiles(executionId)

    if (executionFiles.length === 0) {
      return NextResponse.json({ error: 'No files found for this execution' }, { status: 404 })
    }

    // Find the specific file or use the first one
    let file: any
    if (targetFileId) {
      file = executionFiles.find((f) => f.id === targetFileId)
      if (!file) {
        return NextResponse.json(
          { error: 'Specific file not found in this execution' },
          { status: 404 }
        )
      }
    } else {
      file = executionFiles[0] // Default to first file
    }

    if (!file.directUrl) {
      return NextResponse.json({ error: 'File download URL not available' }, { status: 404 })
    }

    // Check if file is expired
    if (new Date(file.expiresAt) < new Date()) {
      return NextResponse.json({ error: 'File has expired' }, { status: 410 })
    }

    // Generate a new short-lived presigned URL (5 minutes)
    // Use the storage provider from the file metadata
    const storageProvider = file.storageProvider
    let downloadUrl: string

    if (storageProvider === 's3') {
      try {
        const { getS3Client } = await import('@/lib/uploads/s3/s3-client')
        const { S3_EXECUTION_FILES_CONFIG } = await import('@/lib/uploads/setup')
        const { GetObjectCommand } = await import('@aws-sdk/client-s3')
        const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')

        const s3Client = getS3Client()
        const command = new GetObjectCommand({
          Bucket: S3_EXECUTION_FILES_CONFIG.bucket,
          Key: file.fileKey,
        })

        downloadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 }) // 5 minutes
      } catch (error) {
        logger.error('Failed to generate S3 download URL:', error)
        return NextResponse.json({ error: 'Failed to generate download URL' }, { status: 500 })
      }
    } else if (storageProvider === 'blob') {
      try {
        const { getBlobServiceClient } = await import('@/lib/uploads/blob/blob-client')
        const { BLOB_CONFIG } = await import('@/lib/uploads/setup')
        const { generateBlobSASQueryParameters, BlobSASPermissions, StorageSharedKeyCredential } =
          await import('@azure/storage-blob')

        const blobServiceClient = getBlobServiceClient()
        const containerClient = blobServiceClient.getContainerClient(BLOB_CONFIG.containerName)
        const blockBlobClient = containerClient.getBlockBlobClient(file.fileKey)

        const sharedKeyCredential = new StorageSharedKeyCredential(
          BLOB_CONFIG.accountName,
          BLOB_CONFIG.accountKey
        )

        const sasToken = generateBlobSASQueryParameters(
          {
            containerName: BLOB_CONFIG.containerName,
            blobName: file.fileKey,
            permissions: BlobSASPermissions.parse('r'), // Read permission only
            startsOn: new Date(),
            expiresOn: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
          },
          sharedKeyCredential
        ).toString()

        downloadUrl = `${blockBlobClient.url}?${sasToken}`
      } catch (error) {
        logger.error('Failed to generate Azure Blob download URL:', error)
        return NextResponse.json({ error: 'Failed to generate download URL' }, { status: 500 })
      }
    } else {
      // For local files, return the existing direct URL (it should be a full URL)
      downloadUrl = file.directUrl
    }

    logger.info(`Generated download URL for file ${file.fileName} (execution: ${executionId})`)

    return NextResponse.json({
      downloadUrl,
      fileName: file.fileName,
      fileSize: file.fileSize,
      fileType: file.fileType,
      expiresIn: 300, // 5 minutes
    })
  } catch (error) {
    logger.error('Error generating file download URL:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
