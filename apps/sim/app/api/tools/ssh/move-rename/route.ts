import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { sshMoveRenameContract } from '@/lib/api/contracts/storage-transfer'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  createSSHConnection,
  escapeShellArg,
  executeSSHCommand,
  sanitizePath,
} from '@/app/api/tools/ssh/utils'

const logger = createLogger('SSHMoveRenameAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized SSH move/rename attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(sshMoveRenameContract, request, {})
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `[${requestId}] Moving ${params.sourcePath} to ${params.destinationPath} on ${params.host}:${params.port}`
    )

    const client = await createSSHConnection({
      host: params.host,
      port: params.port,
      username: params.username,
      password: params.password,
      privateKey: params.privateKey,
      passphrase: params.passphrase,
    })

    try {
      const sourcePath = sanitizePath(params.sourcePath)
      const destPath = sanitizePath(params.destinationPath)
      const escapedSource = escapeShellArg(sourcePath)
      const escapedDest = escapeShellArg(destPath)

      const sourceCheck = await executeSSHCommand(
        client,
        `test -e '${escapedSource}' && echo "exists"`
      )
      if (sourceCheck.stdout.trim() !== 'exists') {
        return NextResponse.json(
          { error: `Source path does not exist: ${sourcePath}` },
          { status: 404 }
        )
      }

      if (!params.overwrite) {
        const destCheck = await executeSSHCommand(
          client,
          `test -e '${escapedDest}' && echo "exists"`
        )
        if (destCheck.stdout.trim() === 'exists') {
          return NextResponse.json(
            { error: `Destination already exists and overwrite is disabled: ${destPath}` },
            { status: 409 }
          )
        }
      }

      const command = params.overwrite
        ? `mv -f '${escapedSource}' '${escapedDest}'`
        : `mv '${escapedSource}' '${escapedDest}'`
      const result = await executeSSHCommand(client, command)

      if (result.exitCode !== 0) {
        throw new Error(result.stderr || 'Failed to move/rename')
      }

      logger.info(`[${requestId}] Successfully moved ${sourcePath} to ${destPath}`)

      return NextResponse.json({
        success: true,
        sourcePath,
        destinationPath: destPath,
        message: `Successfully moved ${sourcePath} to ${destPath}`,
      })
    } finally {
      client.end()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] SSH move/rename failed:`, error)

    return NextResponse.json({ error: `SSH move/rename failed: ${errorMessage}` }, { status: 500 })
  }
})
