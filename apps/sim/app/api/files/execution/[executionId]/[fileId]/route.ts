import { db } from '@sim/db'
import { workflow, workflowExecutionLogs } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import {
  generateExecutionFileDownloadUrl,
  getExecutionFiles,
} from '@/lib/uploads/contexts/execution'
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
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn('Unauthorized execution file download request', {
        error: authResult.error || 'Missing userId',
      })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authResult.userId
    const { executionId, fileId } = await params

    if (!executionId || !fileId) {
      return NextResponse.json({ error: 'Execution ID and File ID are required' }, { status: 400 })
    }

    logger.info(`Generating download URL for file ${fileId} in execution ${executionId}`)

    const [executionLog] = await db
      .select({
        workflowId: workflowExecutionLogs.workflowId,
      })
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.executionId, executionId))
      .limit(1)

    if (!executionLog) {
      return NextResponse.json({ error: 'Execution not found' }, { status: 404 })
    }

    const [workflowData] = await db
      .select({
        workspaceId: workflow.workspaceId,
      })
      .from(workflow)
      .where(eq(workflow.id, executionLog.workflowId))
      .limit(1)

    if (!workflowData) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    if (!workflowData.workspaceId) {
      logger.warn('Workflow missing workspaceId', {
        workflowId: executionLog.workflowId,
        executionId,
      })
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    const permission = await getUserEntityPermissions(userId, 'workspace', workflowData.workspaceId)
    if (permission === null) {
      logger.warn('User does not have workspace access for execution file', {
        userId,
        workspaceId: workflowData.workspaceId,
        executionId,
        fileId,
      })
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    const executionFiles = await getExecutionFiles(executionId)

    if (executionFiles.length === 0) {
      return NextResponse.json({ error: 'No files found for this execution' }, { status: 404 })
    }

    const file = executionFiles.find((f) => f.id === fileId)
    if (!file) {
      return NextResponse.json({ error: 'File not found in this execution' }, { status: 404 })
    }

    if (new Date(file.expiresAt) < new Date()) {
      return NextResponse.json({ error: 'File has expired' }, { status: 410 })
    }

    const userFile: UserFile = file

    const downloadUrl = await generateExecutionFileDownloadUrl(userFile)

    logger.info(`Generated download URL for file ${file.name} (execution: ${executionId})`)

    const response = NextResponse.json({
      downloadUrl,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      expiresIn: 300, // 5 minutes
    })

    response.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate')
    response.headers.set('Pragma', 'no-cache')
    response.headers.set('Expires', '0')

    return response
  } catch (error) {
    logger.error('Error generating execution file download URL:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
