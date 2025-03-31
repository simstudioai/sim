import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { UPLOAD_DIR } from '@/lib/uploads/setup'
// Import to ensure the uploads directory is created
import '@/lib/uploads/setup.server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    // Extract params
    const { path } = await params
    
    // Join the path segments to get the filename
    const filename = path.join('/')
    console.log(`Serving file: ${filename}`)
    console.log(`Upload directory: ${UPLOAD_DIR}`)
    
    // Try multiple possible paths
    const possiblePaths = [
      join(UPLOAD_DIR, ...path),
      join(process.cwd(), 'uploads', ...path)
    ]
    
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
      console.error(`File not found in any of the checked paths for: ${filename}`)
      return NextResponse.json(
        { error: 'File not found' },
        { status: 404 }
      )
    }
    
    // Read the file
    const file = await readFile(filePath)
    
    // Determine the content type based on file extension
    const extension = filePath.split('.').pop()?.toLowerCase() || ''
    let contentType = 'application/octet-stream' // Default content type
    
    // Map common extensions to content types
    const contentTypeMap: Record<string, string> = {
      'pdf': 'application/pdf',
      'csv': 'text/csv',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'svg': 'image/svg+xml',
      'txt': 'text/plain',
      'html': 'text/html',
      'css': 'text/css',
      'js': 'application/javascript',
      'json': 'application/json',
      'xml': 'application/xml',
      'zip': 'application/zip',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'ppt': 'application/vnd.ms-powerpoint',
      'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    }
    
    if (extension in contentTypeMap) {
      contentType = contentTypeMap[extension]
    }
    
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