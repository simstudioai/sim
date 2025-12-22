import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Version from package.json - updated during build process
const APP_VERSION = process.env.npm_package_version || process.env.APP_VERSION || '0.1.0'
const APP_NAME = 'sim-studio'

/**
 * GET /api/version
 * Returns the current version information of the Sim Studio instance
 */
export async function GET() {
  const buildTime = process.env.BUILD_TIME || null
  const gitCommit = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT || null

  return NextResponse.json({
    version: APP_VERSION,
    name: APP_NAME,
    buildTime,
    gitCommit: gitCommit ? gitCommit.substring(0, 7) : null,
    nodeEnv: process.env.NODE_ENV,
  })
}
