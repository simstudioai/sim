import { randomUUID } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { createSSHConnection, executeSSHCommand } from '@/app/api/tools/ssh/utils'

const logger = createLogger('SSHExecuteScriptAPI')

const ExecuteScriptSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive().default(22),
  username: z.string().min(1, 'Username is required'),
  password: z.string().optional(),
  privateKey: z.string().optional(),
  passphrase: z.string().optional(),
  script: z.string().min(1, 'Script content is required'),
  interpreter: z.string().default('/bin/bash'),
  workingDirectory: z.string().optional(),
})

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)

  try {
    const body = await request.json()
    const params = ExecuteScriptSchema.parse(body)

    // Validate authentication
    if (!params.password && !params.privateKey) {
      return NextResponse.json(
        { error: 'Either password or privateKey must be provided' },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Executing SSH script on ${params.host}:${params.port}`)

    const client = await createSSHConnection({
      host: params.host,
      port: params.port,
      username: params.username,
      password: params.password,
      privateKey: params.privateKey,
      passphrase: params.passphrase,
    })

    try {
      // Create a temporary script file, execute it, and clean up
      const scriptPath = `/tmp/sim_script_${requestId}.sh`

      // Escape the script content for use in a heredoc
      const escapedScript = params.script.replace(/'/g, "'\\''")

      // Build the command to create, execute, and clean up the script
      let command = `cat > '${scriptPath}' << 'SIMEOF'
${params.script}
SIMEOF
chmod +x '${scriptPath}'`

      if (params.workingDirectory) {
        command += `
cd "${params.workingDirectory}"`
      }

      command += `
'${params.interpreter}' '${scriptPath}'
exit_code=$?
rm -f '${scriptPath}'
exit $exit_code`

      const result = await executeSSHCommand(client, command)

      logger.info(`[${requestId}] Script executed successfully with exit code ${result.exitCode}`)

      return NextResponse.json({
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        success: result.exitCode === 0,
        scriptPath: scriptPath,
        message: `Script executed with exit code ${result.exitCode}`,
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
    logger.error(`[${requestId}] SSH script execution failed:`, error)

    return NextResponse.json(
      { error: `SSH script execution failed: ${errorMessage}` },
      { status: 500 }
    )
  }
}
