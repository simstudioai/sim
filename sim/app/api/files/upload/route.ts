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
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }

    // Log upload directory for debugging
    console.log(`Uploading file to: ${UPLOAD_DIR}`)

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
    
    // Return the file path relative to the uploads directory
    return NextResponse.json({ 
      path: `/api/files/serve/${uniqueFilename}`,
      name: originalName,
      size: file.size,
      type: file.type
    })
  } catch (error) {
    console.error('Error uploading file:', error)
    return NextResponse.json(
      { error: 'Failed to upload file', message: (error as Error).message },
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
    }
  })
} 