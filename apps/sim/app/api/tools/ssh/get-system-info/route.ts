import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { sshGetSystemInfoContract } from '@/lib/api/contracts/storage-transfer'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSSHConnection, executeSSHCommand } from '@/app/api/tools/ssh/utils'

const logger = createLogger('SSHGetSystemInfoAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized SSH get system info attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(sshGetSystemInfoContract, request, {})
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`[${requestId}] Getting system info from ${params.host}:${params.port}`)

    const client = await createSSHConnection({
      host: params.host,
      port: params.port,
      username: params.username,
      password: params.password,
      privateKey: params.privateKey,
      passphrase: params.passphrase,
    })

    try {
      // Get hostname
      const hostnameResult = await executeSSHCommand(client, 'hostname')
      const hostname = hostnameResult.stdout.trim()

      // Get OS info
      const osResult = await executeSSHCommand(client, 'uname -s')
      const os = osResult.stdout.trim()

      // Get architecture
      const archResult = await executeSSHCommand(client, 'uname -m')
      const architecture = archResult.stdout.trim()

      // Get uptime in seconds
      const uptimeResult = await executeSSHCommand(
        client,
        "cat /proc/uptime 2>/dev/null | awk '{print int($1)}' || sysctl -n kern.boottime 2>/dev/null | awk '{print int(($(date +%s)) - $4)}'"
      )
      const uptime = Number.parseInt(uptimeResult.stdout.trim()) || 0

      // Get memory info
      const memoryResult = await executeSSHCommand(
        client,
        "free -b 2>/dev/null | awk '/Mem:/ {print $2, $7, $3}' || vm_stat 2>/dev/null | awk '/Pages free|Pages active|Pages speculative|Pages wired|page size/ {gsub(/[^0-9]/, \"\"); print}'"
      )
      const memParts = memoryResult.stdout.trim().split(/\s+/)
      let memory = { total: 0, free: 0, used: 0 }
      if (memParts.length >= 3) {
        memory = {
          total: Number.parseInt(memParts[0]) || 0,
          free: Number.parseInt(memParts[1]) || 0,
          used: Number.parseInt(memParts[2]) || 0,
        }
      }

      // Get disk space
      const diskResult = await executeSSHCommand(
        client,
        "df -B1 / 2>/dev/null | awk 'NR==2 {print $2, $4, $3}' || df -k / 2>/dev/null | awk 'NR==2 {print $2*1024, $4*1024, $3*1024}'"
      )
      const diskParts = diskResult.stdout.trim().split(/\s+/)
      let diskSpace = { total: 0, free: 0, used: 0 }
      if (diskParts.length >= 3) {
        diskSpace = {
          total: Number.parseInt(diskParts[0]) || 0,
          free: Number.parseInt(diskParts[1]) || 0,
          used: Number.parseInt(diskParts[2]) || 0,
        }
      }

      logger.info(`[${requestId}] System info retrieved successfully`)

      return NextResponse.json({
        hostname,
        os,
        architecture,
        uptime,
        memory,
        diskSpace,
        message: `System info retrieved for ${hostname}`,
      })
    } finally {
      client.end()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] SSH get system info failed:`, error)

    return NextResponse.json(
      { error: `SSH get system info failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
