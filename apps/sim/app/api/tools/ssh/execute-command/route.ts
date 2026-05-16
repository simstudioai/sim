import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { sshExecuteCommandContract } from '@/lib/api/contracts/storage-transfer'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  createSSHConnection,
  escapeShellArg,
  executeSSHCommand,
  sanitizeCommand,
} from '@/app/api/tools/ssh/utils'

const logger = createLogger('SSHExecuteCommandAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized SSH execute command attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(sshExecuteCommandContract, request, {})
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`[${requestId}] Executing SSH command on ${params.host}:${params.port}`)

    const client = await createSSHConnection({
      host: params.host,
      port: params.port,
      username: params.username,
      password: params.password,
      privateKey: params.privateKey,
      passphrase: params.passphrase,
    })

    try {
      let command = sanitizeCommand(params.command)
      if (params.workingDirectory) {
        const escapedWorkDir = escapeShellArg(params.workingDirectory)
        command = `cd '${escapedWorkDir}' && ${command}`
      }

      const result = await executeSSHCommand(client, command)

      logger.info(`[${requestId}] Command executed successfully with exit code ${result.exitCode}`)

      return NextResponse.json({
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        success: result.exitCode === 0,
        message: `Command executed with exit code ${result.exitCode}`,
      })
    } finally {
      client.end()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] SSH command execution failed:`, error)

    return NextResponse.json(
      { error: `SSH command execution failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
