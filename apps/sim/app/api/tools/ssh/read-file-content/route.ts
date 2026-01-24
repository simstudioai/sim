import { randomUUID } from 'crypto'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import type { Client, SFTPWrapper } from 'ssh2'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { createSSHConnection, sanitizePath } from '@/app/api/tools/ssh/utils'

const logger = createLogger('SSHReadFileContentAPI')

const ReadFileContentSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive().default(22),
  username: z.string().min(1, 'Username is required'),
  password: z.string().nullish(),
  privateKey: z.string().nullish(),
  passphrase: z.string().nullish(),
  path: z.string().min(1, 'Path is required'),
  encoding: z.string().default('utf-8'),
  maxSize: z.coerce.number().default(10), // MB
})

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

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized SSH read file content attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const params = ReadFileContentSchema.parse(body)

    if (!params.password && !params.privateKey) {
      return NextResponse.json(
        { error: 'Either password or privateKey must be provided' },
        { status: 400 }
      )
    }

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
        const readStream = sftp.createReadStream(filePath)

        readStream.on('data', (chunk: Buffer) => {
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
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    logger.error(`[${requestId}] SSH read file content failed:`, error)

    return NextResponse.json(
      { error: `SSH read file content failed: ${errorMessage}` },
      { status: 500 }
    )
  }
}
