import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import type { Client, SFTPWrapper } from 'ssh2'
import { sshUploadFileContract } from '@/lib/api/contracts/storage-transfer'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSSHConnection, sanitizePath } from '@/app/api/tools/ssh/utils'

const logger = createLogger('SSHUploadFileAPI')

function getSFTP(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) {
        reject(err)
      } else {
        resolve(sftp)
      }
    })
  })
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized SSH upload file attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(sshUploadFileContract, request, {})
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `[${requestId}] Uploading file to ${params.host}:${params.port}${params.remotePath}`
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
      const sftp = await getSFTP(client)
      const remotePath = sanitizePath(params.remotePath)

      if (!params.overwrite) {
        const exists = await new Promise<boolean>((resolve) => {
          sftp.stat(remotePath, (err) => {
            resolve(!err)
          })
        })

        if (exists) {
          return NextResponse.json(
            { error: 'File already exists and overwrite is disabled' },
            { status: 409 }
          )
        }
      }

      let content: Buffer
      try {
        content = Buffer.from(params.fileContent, 'base64')
        const reEncoded = content.toString('base64')
        if (reEncoded !== params.fileContent) {
          content = Buffer.from(params.fileContent, 'utf-8')
        }
      } catch {
        content = Buffer.from(params.fileContent, 'utf-8')
      }

      await new Promise<void>((resolve, reject) => {
        const writeStream = sftp.createWriteStream(remotePath, {
          mode: params.permissions ? Number.parseInt(params.permissions, 8) : 0o644,
        })

        writeStream.on('error', reject)
        writeStream.on('close', () => resolve())

        writeStream.end(content)
      })

      logger.info(`[${requestId}] File uploaded successfully to ${remotePath}`)

      return NextResponse.json({
        uploaded: true,
        remotePath: remotePath,
        size: content.length,
        message: `File uploaded successfully to ${remotePath}`,
      })
    } finally {
      client.end()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] SSH file upload failed:`, error)

    return NextResponse.json({ error: `SSH file upload failed: ${errorMessage}` }, { status: 500 })
  }
})
