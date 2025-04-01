import { NextRequest, NextResponse } from 'next/server'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import { UPLOAD_DIR } from '@/lib/uploads/setup'
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

    // Log upload directory for debugging
    console.log(`Uploading files to: ${UPLOAD_DIR}`)

    const uploadResults = []

    // Process each file
    for (const file of files) {
      // Generate a unique filename with original extension
      const originalName = file.name
      const extension = originalName.split('.').pop() || ''
      const uniqueFilename = `${uuidv4()}.${extension}`
      const filePath = join(UPLOAD_DIR, uniqueFilename)

      // Log the full file path
      console.log(`Full file path for upload: ${filePath}`)

      // Convert file to buffer
      const bytes = await file.arrayBuffer()
      const buffer = Buffer.from(bytes)

      // Write the file to the uploads directory
      await writeFile(filePath, buffer)
      console.log(`Successfully wrote file to: ${filePath}`)

      // Add file info to results
      uploadResults.push({
        path: `/api/files/serve/${uniqueFilename}`,
        name: originalName,
        size: file.size,
        type: file.type,
      })
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
