import { NextRequest, NextResponse } from 'next/server'
import { existsSync } from 'fs'
import { unlink } from 'fs/promises'
import { join } from 'path'
import { deleteFromS3 } from '@/lib/uploads/s3-client'
import { UPLOAD_DIR, USE_S3_STORAGE } from '@/lib/uploads/setup'
// Import to ensure the uploads directory is created
import '@/lib/uploads/setup.server'

export async function POST(request: NextRequest) {
  try {
    const requestData = await request.json()
    const { filePath } = requestData

    console.log('File delete request received:', { filePath })

    if (!filePath) {
      console.error('No file path provided in delete request')
      return NextResponse.json({ error: 'No file path provided' }, { status: 400 })
    }

    // Check if this is an S3 path
    const isS3Path = filePath.includes('/api/files/serve/s3/')

    // Use S3 if in production mode or path explicitly specifies S3
    if (USE_S3_STORAGE || isS3Path) {
      try {
        // Extract the S3 key from the path
        let s3Key: string

        if (isS3Path) {
          // For paths like /api/files/serve/s3/YYYY-MM/timestamp-filename.ext
          s3Key = decodeURIComponent(filePath.split('/api/files/serve/s3/')[1])
        } else {
          // For raw S3 keys
          s3Key = filePath
        }

        console.log(`Deleting file from S3: ${s3Key}`)

        // Delete from S3
        await deleteFromS3(s3Key)
        console.log(`File successfully deleted from S3: ${s3Key}`)

        return NextResponse.json({
          success: true,
          message: 'File deleted successfully from S3',
        })
      } catch (error) {
        console.error('Error deleting file from S3:', error)
        return NextResponse.json(
          { error: 'Failed to delete file from S3', message: (error as Error).message },
          { status: 500 }
        )
      }
    }

    // For local storage:
    // Extract the filename from the path
    const filename = filePath.startsWith('/api/files/serve/')
      ? filePath.substring('/api/files/serve/'.length)
      : filePath

    console.log('Extracted filename for deletion:', filename)

    const fullPath = join(UPLOAD_DIR, filename)
    console.log('Full file path for deletion:', fullPath)

    // Check if file exists
    if (!existsSync(fullPath)) {
      console.log(`File not found for deletion at path: ${fullPath}`)
      return NextResponse.json(
        { success: true, message: "File not found, but that's okay" },
        { status: 200 }
      )
    }

    // Delete the file
    await unlink(fullPath)
    console.log(`File successfully deleted: ${fullPath}`)

    return NextResponse.json({
      success: true,
      message: 'File deleted successfully',
    })
  } catch (error) {
    console.error('Error deleting file:', error)
    return NextResponse.json(
      { error: 'Failed to delete file', message: (error as Error).message },
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
