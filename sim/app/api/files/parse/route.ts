import { NextRequest, NextResponse } from 'next/server'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
import path from 'path'
import { isSupportedFileType, parseFile } from '@/lib/file-parsers'
import { UPLOAD_DIR } from '@/lib/uploads/setup'
import '@/lib/uploads/setup.server'

export async function POST(request: NextRequest) {
  try {
    const requestData = await request.json()
    const { filePath, fileType } = requestData

    console.log('File parse request received:', { filePath, fileType })
    console.log('Upload directory:', UPLOAD_DIR)

    if (!filePath) {
      console.error('No file path provided in request')
      return NextResponse.json({ error: 'No file path provided' }, { status: 400 })
    }

    // Handle both single file path and array of file paths
    const filePaths = Array.isArray(filePath) ? filePath : [filePath]

    // Parse each file
    const results = []
    for (const singleFilePath of filePaths) {
      try {
        const result = await parseFileSingle(singleFilePath, fileType)
        results.push(result)
      } catch (error) {
        console.error(`Error parsing file ${singleFilePath}:`, error)
        results.push({
          success: false,
          error: (error as Error).message,
          filePath: singleFilePath,
        })
      }
    }

    // If it was a single file request, return a single result
    // Otherwise return an array of results
    if (!Array.isArray(filePath)) {
      // Single file was requested
      const result = results[0]
      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 })
      }
      return NextResponse.json(result)
    }

    // Multiple files were requested
    return NextResponse.json({
      success: true,
      results,
    })
  } catch (error) {
    console.error('Error parsing file(s):', error)
    return NextResponse.json(
      { error: 'Failed to parse file(s)', message: (error as Error).message },
      { status: 500 }
    )
  }
}

/**
 * Parse a single file and return its content
 */
async function parseFileSingle(filePath: string, fileType?: string) {
  // Extract the filename from the path
  const filename = filePath.startsWith('/api/files/serve/')
    ? filePath.substring('/api/files/serve/'.length)
    : path.basename(filePath)

  console.log('Extracted filename:', filename)

  const fullPath = join(UPLOAD_DIR, filename)
  console.log('Full file path:', fullPath, 'UPLOAD_DIR:', UPLOAD_DIR)

  // Check all possible file paths
  const possiblePaths = [fullPath, join(process.cwd(), 'uploads', filename)]

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
    return {
      success: false,
      error: `File not found: ${filename}`,
      filePath,
    }
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
      // PDF files should not be treated as binary when successfully parsed
      if (extension === 'pdf') {
        console.log('PDF file parsed successfully, not treating as binary')
        isBinary = false

        // Additional validation for PDF content
        // If the content appears to be binary/corrupted, provide a clearer message
        if (
          fileContent &&
          (fileContent.includes('\u0000') ||
            fileContent.match(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\xFF]{10,}/g))
        ) {
          console.log('PDF content appears to be binary/corrupted, providing a clearer message')

          // Read file size for the message
          const fileBuffer = await readFile(actualPath)
          const fileSize = fileBuffer.length

          // Replace with a helpful message
          fileContent = `This PDF document could not be parsed for text content. It contains ${result.metadata?.pageCount || 'unknown number of'} pages. File size: ${fileSize} bytes.

To view this PDF properly, you can:
1. Download it directly using this URL: ${filePath}
2. Try a dedicated PDF text extraction service or tool
3. Open it with a PDF reader like Adobe Acrobat

PDF parsing failed because the document appears to use an encoding or compression method that our parser cannot handle.`
        }
      }
      console.log(`Successfully parsed ${extension} file with specialized parser`)
    } catch (error) {
      console.error(`Specialized parser failed for ${extension} file:`, error)
      // Special handling for PDFs
      if (extension === 'pdf') {
        // Create a direct download link as fallback
        const fileBuffer = await readFile(actualPath)
        const fileSize = fileBuffer.length

        // Get page count using a simple regex pattern for a rough estimate
        let pageCount = 0
        const pdfContent = fileBuffer.toString('utf-8')
        const pageMatches = pdfContent.match(/\/Type\s*\/Page\b/gi)
        if (pageMatches) {
          pageCount = pageMatches.length
        }

        fileContent = `PDF parsing failed: ${(error as Error).message}

This PDF document contains ${pageCount || 'an unknown number of'} pages and is ${fileSize} bytes in size.

To view this PDF properly, you can:
1. Download it directly using this URL: ${filePath}
2. Try a dedicated PDF text extraction service or tool
3. Open it with a PDF reader like Adobe Acrobat

Common causes of PDF parsing failures:
- The PDF uses an unsupported compression algorithm
- The PDF is protected or encrypted
- The PDF content uses non-standard encodings
- The PDF was created with features our parser doesn't support`

        isBinary = false
        console.log('Created fallback message for PDF parsing failure')
      } else {
        // Fall back to default handling for other file types
        const genericResult = await handleGenericFile(actualPath, filename, extension, fileType)
        return genericResult
      }
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
      txt: 'text/plain',
      csv: 'text/csv',
      json: 'application/json',
      xml: 'application/xml',
      md: 'text/markdown',
      html: 'text/html',
      css: 'text/css',
      js: 'application/javascript',
      ts: 'application/typescript',
      // Document formats
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      // Spreadsheet formats
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      // Presentation formats
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      // Image formats
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      // Archive formats
      zip: 'application/zip',
    }

    detectedFileType = fileTypeMap[extension] || 'application/octet-stream'
  }

  console.log('Sending successful response with parsed content')

  // Return the parsed content
  return {
    success: true,
    output: {
      content: fileContent,
      fileType: detectedFileType,
      size: fileSize,
      name: originalName,
      binary: isBinary,
      metadata,
    },
    filePath,
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
    // Remove PDF from binary extensions since we have a specialized parser
    const binaryExtensions = [
      'doc',
      'docx',
      'xls',
      'xlsx',
      'ppt',
      'pptx',
      'zip',
      'png',
      'jpg',
      'jpeg',
      'gif',
    ]
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
        txt: 'text/plain',
        csv: 'text/csv',
        json: 'application/json',
        xml: 'application/xml',
        md: 'text/markdown',
        html: 'text/html',
        css: 'text/css',
        js: 'application/javascript',
        ts: 'application/typescript',
        // Document formats
        pdf: 'application/pdf',
        doc: 'application/msword',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        // Spreadsheet formats
        xls: 'application/vnd.ms-excel',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        // Presentation formats
        ppt: 'application/vnd.ms-powerpoint',
        pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        // Image formats
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        // Archive formats
        zip: 'application/zip',
      }

      detectedFileType = fileTypeMap[extension] || 'application/octet-stream'
    }

    return {
      success: true,
      output: {
        content: fileContent,
        fileType: detectedFileType,
        size: fileSize,
        name: originalName,
        binary: isBinary,
      },
    }
  } catch (error) {
    console.error('Error handling generic file:', error)
    return {
      success: false,
      error: `Failed to parse file: ${(error as Error).message}`,
    }
  }
}
