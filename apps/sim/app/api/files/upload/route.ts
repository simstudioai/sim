import { writeFile } from 'fs/promises'
import { join } from 'path'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console/logger'
import { isUsingCloudStorage, uploadFile } from '@/lib/uploads'
import { UPLOAD_DIR } from '@/lib/uploads/setup'
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
    const usingCloudStorage = isUsingCloudStorage()
    logger.info(`Using storage mode: ${usingCloudStorage ? 'Cloud' : 'Local'} for file upload`)

    const uploadResults = []

    // Process each file
    for (const file of files) {
      const originalName = file.name
      const bytes = await file.arrayBuffer()
      const buffer = Buffer.from(bytes)

      if (usingCloudStorage) {
        // Upload to cloud storage (S3 or Azure Blob)
        try {
          logger.info(`Uploading file to cloud storage: ${originalName}`)
          const result = await uploadFile(buffer, originalName, file.type, file.size)
          logger.info(`Successfully uploaded to cloud storage: ${result.key}`)
          uploadResults.push(result)
        } catch (error) {
          logger.error('Error uploading to cloud storage:', error)
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
    if (uploadResults.length === 1) {
      return NextResponse.json(uploadResults[0])
    }
    return NextResponse.json({ files: uploadResults })
  } catch (error) {
    logger.error('Error in file upload:', error)
    return createErrorResponse(error instanceof Error ? error : new Error('File upload failed'))
  }
}

// Handle preflight requests
export async function OPTIONS() {
  return createOptionsResponse()
}
