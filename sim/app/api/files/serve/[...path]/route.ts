import { NextRequest, NextResponse } from 'next/server'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { downloadFromS3, getPresignedUrl } from '@/lib/uploads/s3-client'
import { UPLOAD_DIR, USE_S3_STORAGE } from '@/lib/uploads/setup'
// Import to ensure the uploads directory is created
import '@/lib/uploads/setup.server'

export async function GET(request: NextRequest, { params }: { params: { path: string[] } }) {
  try {
    // Extract params
    const { path } = params

    // Join the path segments to get the filename or S3 key
    const pathString = path.join('/')
    console.log(`Serving file: ${pathString}`)

    // Check if this is an S3 file (path starts with 's3/')
    const isS3Path = path[0] === 's3'

    // Use S3 if in production or path explicitly specifies S3
    if (USE_S3_STORAGE || isS3Path) {
      // If path starts with s3/, remove that prefix to get the actual key
      const s3Key = isS3Path ? decodeURIComponent(path.slice(1).join('/')) : pathString
      console.log(`Serving file from S3: ${s3Key}`)

      // Use fast redirect to presigned URL for better performance
      // instead of proxying the file through our server
      try {
        // Generate a presigned URL for direct S3 access
        const presignedUrl = await getPresignedUrl(s3Key)

        // Redirect to the presigned URL for direct S3 access
        return NextResponse.redirect(presignedUrl)
      } catch (error) {
        console.error('Error generating presigned URL:', error)

        // Fallback to proxying through the server if presigned URL fails
        try {
          const fileBuffer = await downloadFromS3(s3Key)

          // Determine content type based on file extension
          const extension = s3Key.split('.').pop()?.toLowerCase() || ''
          const contentType = getContentTypeFromExtension(extension)

          // Extract the original filename from the key (last part after last /)
          const originalFilename = s3Key.split('/').pop() || 'download'

          return new NextResponse(fileBuffer, {
            status: 200,
            headers: {
              'Content-Type': contentType,
              'Content-Disposition': `inline; filename="${originalFilename}"`,
              'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
            },
          })
        } catch (s3Error) {
          console.error('Error downloading from S3:', s3Error)
          return NextResponse.json(
            { error: 'Failed to serve file from S3', message: (s3Error as Error).message },
            { status: 500 }
          )
        }
      }
    }

    // For local storage:
    console.log(`Serving from local storage. Upload directory: ${UPLOAD_DIR}`)

    // Try multiple possible paths
    const possiblePaths = [join(UPLOAD_DIR, ...path), join(process.cwd(), 'uploads', ...path)]

    let filePath = ''
    for (const p of possiblePaths) {
      if (existsSync(p)) {
        filePath = p
        console.log(`Found file at: ${filePath}`)
        break
      } else {
        console.log(`File not found at path: ${p}`)
      }
    }

    // Check if file exists
    if (!filePath) {
      console.error(`File not found in any of the checked paths for: ${pathString}`)
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // Read the file
    const file = await readFile(filePath)

    // Determine the content type based on file extension
    const extension = filePath.split('.').pop()?.toLowerCase() || ''
    const contentType = getContentTypeFromExtension(extension)

    // Return the file with appropriate content type
    return new NextResponse(file, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${path[path.length - 1]}"`,
        'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
      },
    })
  } catch (error) {
    console.error('Error serving file:', error)
    return NextResponse.json(
      { error: 'Failed to serve file', message: (error as Error).message },
      { status: 500 }
    )
  }
}

/**
 * Helper to determine content type from file extension
 */
function getContentTypeFromExtension(extension: string): string {
  // Map common extensions to content types
  const contentTypeMap: Record<string, string> = {
    pdf: 'application/pdf',
    csv: 'text/csv',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    txt: 'text/plain',
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    json: 'application/json',
    xml: 'application/xml',
    zip: 'application/zip',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  }

  return contentTypeMap[extension] || 'application/octet-stream' // Default content type
}
