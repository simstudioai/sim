import { NextRequest, NextResponse } from 'next/server'
import { unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { UPLOAD_DIR } from '@/lib/uploads/setup'
// Import to ensure the uploads directory is created
import '@/lib/uploads/setup.server'

export async function POST(request: NextRequest) {
  try {
    const requestData = await request.json()
    const { filePath } = requestData

    console.log('File delete request received:', { filePath })

    if (!filePath) {
      console.error('No file path provided in delete request')
      return NextResponse.json(
        { error: 'No file path provided' },
        { status: 400 }
      )
    }

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
        { success: true, message: 'File not found, but that\'s okay' },
        { status: 200 }
      )
    }
    
    // Delete the file
    await unlink(fullPath)
    console.log(`File successfully deleted: ${fullPath}`)
    
    return NextResponse.json({
      success: true,
      message: 'File deleted successfully'
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
    }
  })
} 