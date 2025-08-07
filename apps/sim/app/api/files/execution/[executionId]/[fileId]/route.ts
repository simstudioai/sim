import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { generateExecutionFileDownloadUrl } from '@/lib/workflows/execution-file-storage'
import { getExecutionFiles } from '@/lib/workflows/execution-files-server'
import type { UserFile } from '@/executor/types'

const logger = createLogger('ExecutionFileDownloadAPI')

/**
 * Generate a short-lived presigned URL for secure execution file download
 * GET /api/files/execution/[executionId]/[fileId]
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ executionId: string; fileId: string }> }
) {
  try {
    const { executionId, fileId } = await params

    if (!executionId || !fileId) {
      return NextResponse.json({ error: 'Execution ID and File ID are required' }, { status: 400 })
    }

    logger.info(`Generating download URL for file ${fileId} in execution ${executionId}`)

    // Get files for this execution
    const executionFiles = await getExecutionFiles(executionId)

    if (executionFiles.length === 0) {
      return NextResponse.json({ error: 'No files found for this execution' }, { status: 404 })
    }

    // Find the specific file
    const file = executionFiles.find((f) => f.id === fileId)
    if (!file) {
      return NextResponse.json({ error: 'File not found in this execution' }, { status: 404 })
    }

    // Check if file is expired
    if (new Date(file.expiresAt) < new Date()) {
      return NextResponse.json({ error: 'File has expired' }, { status: 410 })
    }

    // Since ExecutionFileMetadata is now just UserFile, no conversion needed
    const userFile: UserFile = file

    // Generate a new short-lived presigned URL (5 minutes)
    const downloadUrl = await generateExecutionFileDownloadUrl(userFile)

    logger.info(`Generated download URL for file ${file.name} (execution: ${executionId})`)

    const response = NextResponse.json({
      downloadUrl,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      expiresIn: 300, // 5 minutes
    })

    // Ensure no caching of download URLs
    response.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate')
    response.headers.set('Pragma', 'no-cache')
    response.headers.set('Expires', '0')

    return response
  } catch (error) {
    logger.error('Error generating execution file download URL:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
