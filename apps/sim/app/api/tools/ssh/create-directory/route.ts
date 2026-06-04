import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { sshCreateDirectoryContract } from '@/lib/api/contracts/storage-transfer'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  createSSHConnection,
  escapeShellArg,
  executeSSHCommand,
  sanitizePath,
} from '@/app/api/tools/ssh/utils'

const logger = createLogger('SSHCreateDirectoryAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized SSH create directory attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(sshCreateDirectoryContract, request, {})
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`[${requestId}] Creating directory ${params.path} on ${params.host}:${params.port}`)

    const client = await createSSHConnection({
      host: params.host,
      port: params.port,
      username: params.username,
      password: params.password,
      privateKey: params.privateKey,
      passphrase: params.passphrase,
    })

    try {
      const dirPath = sanitizePath(params.path)
      const escapedPath = escapeShellArg(dirPath)

      const checkResult = await executeSSHCommand(
        client,
        `test -d '${escapedPath}' && echo "exists"`
      )
      const alreadyExists = checkResult.stdout.trim() === 'exists'

      if (alreadyExists) {
        logger.info(`[${requestId}] Directory already exists: ${dirPath}`)
        return NextResponse.json({
          created: false,
          path: dirPath,
          alreadyExists: true,
          message: `Directory already exists: ${dirPath}`,
        })
      }

      const mkdirFlag = params.recursive ? '-p' : ''
      const command = `mkdir ${mkdirFlag} -m ${params.permissions} '${escapedPath}'`
      const result = await executeSSHCommand(client, command)

      if (result.exitCode !== 0) {
        throw new Error(result.stderr || 'Failed to create directory')
      }

      logger.info(`[${requestId}] Directory created successfully: ${dirPath}`)

      return NextResponse.json({
        created: true,
        path: dirPath,
        alreadyExists: false,
        message: `Directory created successfully: ${dirPath}`,
      })
    } finally {
      client.end()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] SSH create directory failed:`, error)

    return NextResponse.json(
      { error: `SSH create directory failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
