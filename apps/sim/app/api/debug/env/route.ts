import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    NODE_ENV: process.env.NODE_ENV,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    // Check if globalThis.database exists
    hasCachedDatabase: !!globalThis.database,
    timestamp: new Date().toISOString(),
  })
}
