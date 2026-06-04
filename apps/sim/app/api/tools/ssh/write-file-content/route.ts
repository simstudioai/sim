import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import type { Client, SFTPWrapper } from 'ssh2'
import { sshWriteFileContentContract } from '@/lib/api/contracts/storage-transfer'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSSHConnection, sanitizePath } from '@/app/api/tools/ssh/utils'

const logger = createLogger('SSHWriteFileContentAPI')

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
      logger.warn(`[${requestId}] Unauthorized SSH write file content attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(sshWriteFileContentContract, request, {})
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `[${requestId}] Writing file content to ${params.path} on ${params.host}:${params.port} (mode: ${params.mode})`
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
      const filePath = sanitizePath(params.path)

      // Check if file exists for 'create' mode
      if (params.mode === 'create') {
        const exists = await new Promise<boolean>((resolve) => {
          sftp.stat(filePath, (err) => {
            resolve(!err)
          })
        })

        if (exists) {
          return NextResponse.json(
            { error: `File already exists and mode is 'create': ${filePath}` },
            { status: 409 }
          )
        }
      }

      // Handle append mode by reading existing content first
      let finalContent = params.content
      if (params.mode === 'append') {
        const existingContent = await new Promise<string>((resolve) => {
          const chunks: Buffer[] = []
          const readStream = sftp.createReadStream(filePath)

          readStream.on('data', (chunk: Buffer) => {
            chunks.push(chunk)
          })

          readStream.on('end', () => {
            resolve(Buffer.concat(chunks).toString('utf-8'))
          })

          readStream.on('error', () => {
            resolve('')
          })
        })
        finalContent = existingContent + params.content
      }

      // Write file
      const fileMode = params.permissions ? Number.parseInt(params.permissions, 8) : 0o644
      await new Promise<void>((resolve, reject) => {
        const writeStream = sftp.createWriteStream(filePath, { mode: fileMode })

        writeStream.on('error', reject)
        writeStream.on('close', () => resolve())

        writeStream.end(Buffer.from(finalContent, 'utf-8'))
      })

      // Get final file size
      const stats = await new Promise<{ size: number }>((resolve, reject) => {
        sftp.stat(filePath, (err, stats) => {
          if (err) reject(err)
          else resolve(stats)
        })
      })

      logger.info(`[${requestId}] File written successfully: ${stats.size} bytes`)

      return NextResponse.json({
        written: true,
        path: filePath,
        size: stats.size,
        message: `File written successfully: ${stats.size} bytes`,
      })
    } finally {
      client.end()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] SSH write file content failed:`, error)

    return NextResponse.json(
      { error: `SSH write file content failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
