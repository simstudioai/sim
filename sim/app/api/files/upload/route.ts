import { NextRequest, NextResponse } from 'next/server'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import { uploadToS3 } from '@/lib/uploads/s3-client'
import { UPLOAD_DIR, USE_S3_STORAGE } from '@/lib/uploads/setup'
// Import to ensure the uploads directory is created
import '@/lib/uploads/setup.server'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()

    // Check if multiple files are being uploaded or a single file
    const files = formData.getAll('file') as File[]

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 })
    }

    // Log storage mode
    console.log(`Using storage mode: ${USE_S3_STORAGE ? 'S3' : 'Local'} for file upload`)

    const uploadResults = []

    // Process each file
    for (const file of files) {
      const originalName = file.name
      const bytes = await file.arrayBuffer()
      const buffer = Buffer.from(bytes)

      if (USE_S3_STORAGE) {
        // Upload to S3 in production
        try {
          console.log(`Uploading file to S3: ${originalName}`)
          const result = await uploadToS3(buffer, originalName, file.type, file.size)
          console.log(`Successfully uploaded to S3: ${result.key}`)
          uploadResults.push(result)
        } catch (error) {
          console.error('Error uploading to S3:', error)
          throw error
        }
      } else {
        // Upload to local file system in development
        const extension = originalName.split('.').pop() || ''
        const uniqueFilename = `${uuidv4()}.${extension}`
        const filePath = join(UPLOAD_DIR, uniqueFilename)

        console.log(`Uploading file to local storage: ${filePath}`)
        await writeFile(filePath, buffer)
        console.log(`Successfully wrote file to: ${filePath}`)

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
    console.error('Error uploading files:', error)
    return NextResponse.json(
      { error: 'Failed to upload files', message: (error as Error).message },
      { status: 500 }
    )
  }
}

// Handle preflight requests
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}
