import { NextRequest, NextResponse } from 'next/server'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console-logger'
import { uploadToS3 } from '@/lib/uploads/s3-client'
import { UPLOAD_DIR, USE_S3_STORAGE } from '@/lib/uploads/setup'
// Import to ensure the uploads directory is created
import '@/lib/uploads/setup.server'
import { createErrorResponse, createOptionsResponse, InvalidRequestError } from '../utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('FilesUploadAPI')

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()

    // Check if multiple files are being uploaded or a single file
    const files = formData.getAll('file') as File[]

    if (!files || files.length === 0) {
      throw new InvalidRequestError('No files provided')
    }

    // Log storage mode
    logger.info(`Using storage mode: ${USE_S3_STORAGE ? 'S3' : 'Local'} for file upload`)

    const uploadResults = []

    // Process each file
    for (const file of files) {
      const originalName = file.name
      const bytes = await file.arrayBuffer()
      const buffer = Buffer.from(bytes)

      if (USE_S3_STORAGE) {
        // Upload to S3 in production
        try {
          logger.info(`Uploading file to S3: ${originalName}`)
          const result = await uploadToS3(buffer, originalName, file.type, file.size)
          logger.info(`Successfully uploaded to S3: ${result.key}`)
          uploadResults.push(result)
        } catch (error) {
          logger.error('Error uploading to S3:', error)
          throw error
        }
      } else {
        // Upload to local file system in development
        const extension = originalName.split('.').pop() || ''
        const uniqueFilename = `${uuidv4()}.${extension}`
        const filePath = join(UPLOAD_DIR, uniqueFilename)

        logger.info(`Uploading file to local storage: ${filePath}`)
        await writeFile(filePath, buffer)
        logger.info(`Successfully wrote file to: ${filePath}`)

        uploadResults.push({
          path: `/api/files/serve/${uniqueFilename}`,
          name: originalName,
          size: file.size,
          type: file.type,
        })
      }
    }

    // Return all file information
    return NextResponse.json(files.length === 1 ? uploadResults[0] : uploadResults)
  } catch (error) {
    logger.error('Error uploading files:', error)
    return createErrorResponse(error instanceof Error ? error : new Error('Failed to upload files'))
  }
}

// Handle preflight requests
export async function OPTIONS() {
  return createOptionsResponse()
}
