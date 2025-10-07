import { db } from '@sim/db'
import { sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const measurements: Record<string, number> = {}

  try {
    // Test 1: Simple query
    const t1 = performance.now()
    await db.execute(sql`SELECT 1`)
    measurements.simpleQuery = performance.now() - t1

    // Test 2: Check if globalThis caching is working
    const t2 = performance.now()
    const dbRef1 = globalThis.database
    measurements.checkGlobalThis = performance.now() - t2

    // Test 3: Another simple query
    const t3 = performance.now()
    await db.execute(sql`SELECT 1`)
    measurements.simpleQuery2 = performance.now() - t3

    // Test 4: Check connection
    const t4 = performance.now()
    await db.execute(sql`SELECT current_database(), current_user, version()`)
    measurements.connectionInfo = performance.now() - t4

    return NextResponse.json({
      success: true,
      NODE_ENV: process.env.NODE_ENV,
      hasCachedDatabase: !!globalThis.database,
      isSameDbInstance: dbRef1 === globalThis.database,
      measurements,
      timestamp: new Date().toISOString(),
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        NODE_ENV: process.env.NODE_ENV,
        hasCachedDatabase: !!globalThis.database,
        measurements,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}
