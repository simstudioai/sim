import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { sshDeleteFileContract } from '@/lib/api/contracts/storage-transfer'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  createSSHConnection,
  escapeShellArg,
  executeSSHCommand,
  sanitizePath,
} from '@/app/api/tools/ssh/utils'

const logger = createLogger('SSHDeleteFileAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized SSH delete file attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(sshDeleteFileContract, request, {})
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`[${requestId}] Deleting ${params.path} on ${params.host}:${params.port}`)

    const client = await createSSHConnection({
      host: params.host,
      port: params.port,
      username: params.username,
      password: params.password,
      privateKey: params.privateKey,
      passphrase: params.passphrase,
    })

    try {
      const filePath = sanitizePath(params.path)
      const escapedPath = escapeShellArg(filePath)

      const checkResult = await executeSSHCommand(
        client,
        `test -e '${escapedPath}' && echo "exists"`
      )
      if (checkResult.stdout.trim() !== 'exists') {
        return NextResponse.json({ error: `Path does not exist: ${filePath}` }, { status: 404 })
      }

      let command: string
      if (params.recursive) {
        command = params.force ? `rm -rf '${escapedPath}'` : `rm -r '${escapedPath}'`
      } else {
        command = params.force ? `rm -f '${escapedPath}'` : `rm '${escapedPath}'`
      }

      const result = await executeSSHCommand(client, command)

      if (result.exitCode !== 0) {
        throw new Error(result.stderr || 'Failed to delete path')
      }

      logger.info(`[${requestId}] Path deleted successfully: ${filePath}`)

      return NextResponse.json({
        deleted: true,
        path: filePath,
        message: `Successfully deleted: ${filePath}`,
      })
    } finally {
      client.end()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] SSH delete file failed:`, error)

    return NextResponse.json({ error: `SSH delete file failed: ${errorMessage}` }, { status: 500 })
  }
})
