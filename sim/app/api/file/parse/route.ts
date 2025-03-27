import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { UPLOAD_DIR } from '@/lib/uploads/setup'
import '@/lib/uploads/setup.server'
import path from 'path'

export async function POST(request: NextRequest) {
  try {
    const requestData = await request.json()
    const { filePath, fileType } = requestData

    if (!filePath) {
      return NextResponse.json(
        { error: 'No file path provided' },
        { status: 400 }
      )
    }

    // Extract the filename from the path
    // The path should be in format /uploads/{filename}
    const filename = filePath.startsWith('/uploads/') 
      ? filePath.substring('/uploads/'.length) 
      : filePath
    
    const fullPath = join(UPLOAD_DIR, filename)
    
    // Check if file exists
    if (!existsSync(fullPath)) {
      return NextResponse.json(
        { error: 'File not found' },
        { status: 404 }
      )
    }
    
    // Read the file
    const fileBuffer = await readFile(fullPath)
    const extension = path.extname(filename).toLowerCase().substring(1)
    
    // Determine if file should be treated as binary
    const binaryExtensions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'png', 'jpg', 'jpeg', 'gif']
    const isBinary = binaryExtensions.includes(extension)
    
    // For binary files, we don't attempt to parse as text
    let fileContent: string
    if (isBinary) {
      fileContent = `[Binary ${extension.toUpperCase()} file - ${fileBuffer.length} bytes]`
    } else {
      // For text files, convert to string
      try {
        fileContent = fileBuffer.toString('utf-8')
      } catch (error) {
        fileContent = `[Unable to parse file as text: ${(error as Error).message}]`
      }
    }
    
    // Get file stats
    const fileSize = fileBuffer.length
    const originalName = path.basename(filename)
    
    // Detect file type from extension if not provided
    let detectedFileType = fileType
    if (!detectedFileType) {
      const fileTypeMap: Record<string, string> = {
        // Text formats
        'txt': 'text/plain',
        'csv': 'text/csv',
        'json': 'application/json',
        'xml': 'application/xml',
        'md': 'text/markdown',
        'html': 'text/html',
        'css': 'text/css',
        'js': 'application/javascript',
        'ts': 'application/typescript',
        // Document formats
        'pdf': 'application/pdf',
        'doc': 'application/msword',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        // Spreadsheet formats
        'xls': 'application/vnd.ms-excel',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        // Presentation formats
        'ppt': 'application/vnd.ms-powerpoint',
        'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        // Image formats
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        // Archive formats
        'zip': 'application/zip',
      }
      
      detectedFileType = fileTypeMap[extension] || 'application/octet-stream'
    }
    
    // Return the parsed content
    return NextResponse.json({
      success: true,
      output: {
        content: fileContent,
        fileType: detectedFileType,
        size: fileSize,
        name: originalName,
        binary: isBinary
      }
    })
  } catch (error) {
    console.error('Error parsing file:', error)
    return NextResponse.json(
      { error: 'Failed to parse file', message: (error as Error).message },
      { status: 500 }
    )
  }
} 