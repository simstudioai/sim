import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { healthContract } from '@/lib/api/contracts/health'
import { parseRequest } from '@/lib/api/server'
import appPackage from '@/package.json'

const DEFAULT_VERSION = appPackage.version

function getAppVersion(): string {
  return process.env.APP_VERSION || process.env.NEXT_PUBLIC_APP_VERSION || DEFAULT_VERSION
}

function getAppCommit(): string | null {
  return process.env.GIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || process.env.COMMIT_SHA || null
}

/**
 * Health check endpoint for deployment platforms and container probes.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const parsed = await parseRequest(healthContract, request, {})
  if (!parsed.success) return parsed.response
  return NextResponse.json(
    {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: getAppVersion(),
      commit: getAppCommit(),
    },
    { status: 200 }
  )
}
