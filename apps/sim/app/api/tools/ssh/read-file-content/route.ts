import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import type { Client, SFTPWrapper } from 'ssh2'
import { sshReadFileContentContract } from '@/lib/api/contracts/storage-transfer'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSSHConnection, sanitizePath } from '@/app/api/tools/ssh/utils'

const logger = createLogger('SSHReadFileContentAPI')

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
      logger.warn(`[${requestId}] Unauthorized SSH read file content attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(sshReadFileContentContract, request, {})
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `[${requestId}] Reading file content from ${params.path} on ${params.host}:${params.port}`
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
      const maxBytes = params.maxSize * 1024 * 1024 // Convert MB to bytes

      const stats = await new Promise<{ size: number }>((resolve, reject) => {
        sftp.stat(filePath, (err, stats) => {
          if (err) {
            reject(new Error(`File not found: ${filePath}`))
          } else {
            resolve(stats)
          }
        })
      })

      if (stats.size > maxBytes) {
        return NextResponse.json(
          { error: `File size (${stats.size} bytes) exceeds maximum allowed (${maxBytes} bytes)` },
          { status: 400 }
        )
      }

      const content = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = []
        let totalBytes = 0
        const readStream = sftp.createReadStream(filePath)

        readStream.on('data', (chunk: Buffer) => {
          totalBytes += chunk.length
          if (totalBytes > maxBytes) {
            readStream.destroy()
            reject(new Error(`File exceeds maximum allowed size of ${params.maxSize}MB`))
            return
          }
          chunks.push(chunk)
        })

        readStream.on('end', () => {
          const buffer = Buffer.concat(chunks)
          resolve(buffer.toString(params.encoding as BufferEncoding))
        })

        readStream.on('error', reject)
      })

      const lines = content.split('\n').length

      logger.info(
        `[${requestId}] File content read successfully: ${stats.size} bytes, ${lines} lines`
      )

      return NextResponse.json({
        content,
        size: stats.size,
        lines,
        path: filePath,
        message: `File read successfully: ${stats.size} bytes, ${lines} lines`,
      })
    } finally {
      client.end()
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    logger.error(`[${requestId}] SSH read file content failed:`, error)

    return NextResponse.json(
      { error: `SSH read file content failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
