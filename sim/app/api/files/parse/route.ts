import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { UPLOAD_DIR } from '@/lib/uploads/setup'
import '@/lib/uploads/setup.server'
import path from 'path'
import { parseFile, isSupportedFileType } from '@/lib/file-parsers'

export async function POST(request: NextRequest) {
  try {
    const requestData = await request.json()
    const { filePath, fileType } = requestData

    console.log('File parse request received:', { filePath, fileType })
    console.log('Upload directory:', UPLOAD_DIR)

    if (!filePath) {
      console.error('No file path provided in request')
      return NextResponse.json(
        { error: 'No file path provided' },
        { status: 400 }
      )
    }

    // Extract the filename from the path
    const filename = filePath.startsWith('/api/files/serve/') 
      ? filePath.substring('/api/files/serve/'.length) 
      : path.basename(filePath)
    
    console.log('Extracted filename:', filename)
    
    const fullPath = join(UPLOAD_DIR, filename)
    console.log('Full file path:', fullPath, 'UPLOAD_DIR:', UPLOAD_DIR)
    
    // Check all possible file paths
    const possiblePaths = [
      fullPath,
      join(process.cwd(), 'uploads', filename),
      join(process.cwd(), 'sim', 'uploads', filename)
    ]
    
    let actualPath = ''
    for (const p of possiblePaths) {
      if (existsSync(p)) {
        actualPath = p
        console.log(`Found file at: ${actualPath}`)
        break
      }
    }
    
    if (!actualPath) {
      console.error(`File not found in any of the checked paths for: ${filename}`)
      return NextResponse.json(
        { error: `File not found: ${filename}` },
        { status: 404 }
      )
    }
    
    const extension = path.extname(filename).toLowerCase().substring(1)
    console.log('File extension:', extension)
    
    let fileContent: string
    let metadata: Record<string, any> = {}
    let isBinary = false
    
    // Try to use specialized parsers for supported file types
    if (isSupportedFileType(extension)) {
      try {
        console.log(`Attempting to parse ${filename} with specialized parser for ${extension}`)
        const result = await parseFile(actualPath)
        fileContent = result.content
        if (result.metadata) {
          metadata = result.metadata
        }
        console.log(`Successfully parsed ${extension} file with specialized parser`)
      } catch (error) {
        console.error(`Specialized parser failed for ${extension} file:`, error)
        // Fall back to default handling
        const genericResult = await handleGenericFile(actualPath, filename, extension, fileType)
        return genericResult
      }
    } else {
      // For unsupported file types, use the generic approach
      console.log(`Using generic parser for unsupported file type: ${extension}`)
      return handleGenericFile(actualPath, filename, extension, fileType)
    }
    
    // Get file stats
    const fileBuffer = await readFile(actualPath)
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
    
    console.log('Sending successful response with parsed content')
    
    // Return the parsed content
    return NextResponse.json({
      success: true,
      output: {
        content: fileContent,
        fileType: detectedFileType,
        size: fileSize,
        name: originalName,
        binary: isBinary,
        metadata
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

/**
 * Handle generic file types with basic parsing
 */
async function handleGenericFile(
  fullPath: string, 
  filename: string, 
  extension: string,
  fileType?: string
) {
  try {
    // Read the file
    const fileBuffer = await readFile(fullPath)
    
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
    console.error('Error in generic file handling:', error)
    return NextResponse.json(
      { error: 'Failed to read file', message: (error as Error).message },
      { status: 500 }
    )
  }
} 