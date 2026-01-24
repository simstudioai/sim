import { randomUUID } from 'crypto'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import type { Client, SFTPWrapper } from 'ssh2'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { createSSHConnection, sanitizePath } from '@/app/api/tools/ssh/utils'

const logger = createLogger('SSHWriteFileContentAPI')

const WriteFileContentSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive().default(22),
  username: z.string().min(1, 'Username is required'),
  password: z.string().nullish(),
  privateKey: z.string().nullish(),
  passphrase: z.string().nullish(),
  path: z.string().min(1, 'Path is required'),
  content: z.string(),
  mode: z.enum(['overwrite', 'append', 'create']).default('overwrite'),
  permissions: z.string().nullish(),
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
      logger.warn(`[${requestId}] Unauthorized SSH write file content attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const params = WriteFileContentSchema.parse(body)

    if (!params.password && !params.privateKey) {
      return NextResponse.json(
        { error: 'Either password or privateKey must be provided' },
        { status: 400 }
      )
    }

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
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    logger.error(`[${requestId}] SSH write file content failed:`, error)

    return NextResponse.json(
      { error: `SSH write file content failed: ${errorMessage}` },
      { status: 500 }
    )
  }
}
