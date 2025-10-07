import { NextResponse } from 'next/server'
import postgres from 'postgres'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

let requestCount = 0
let globalPgClient: ReturnType<typeof postgres> | undefined

export async function GET() {
  const startTime = performance.now()
  requestCount++

  const measurements: Record<string, any> = {}

  // Test 1: Check if globalThis persists
  measurements.requestCount = requestCount
  measurements.globalThisTest = (globalThis as any).testCounter || 0
  ;(globalThis as any).testCounter = ((globalThis as any).testCounter || 0) + 1

  // Test 2: Check if module-level variable persists
  measurements.moduleLevelPersists = globalPgClient !== undefined

  // Test 3: Create new postgres client
  const t1 = performance.now()
  const connectionString = process.env.DATABASE_URL!
  const pgClient = postgres(connectionString, {
    max: 80,
    idle_timeout: 20,
    connect_timeout: 30,
    prepare: false,
    onnotice: () => {},
  })
  measurements.createClientTime = performance.now() - t1

  // Test 4: Execute query with new client
  const t2 = performance.now()
  try {
    await pgClient`SELECT 1`
    measurements.firstQueryTime = performance.now() - t2
  } catch (e: any) {
    measurements.firstQueryError = e.message
  }

  // Test 5: Execute second query
  const t3 = performance.now()
  try {
    await pgClient`SELECT 1`
    measurements.secondQueryTime = performance.now() - t3
  } catch (e: any) {
    measurements.secondQueryError = e.message
  }

  // Test 6: Use global client if exists
  if (globalPgClient) {
    const t4 = performance.now()
    try {
      await globalPgClient`SELECT 1`
      measurements.globalClientQueryTime = performance.now() - t4
    } catch (e: any) {
      measurements.globalClientError = e.message
    }
  }

  // Store for next request
  if (!globalPgClient) {
    globalPgClient = pgClient
  } else {
    // End the new client to avoid connection leak
    await pgClient.end()
  }

  measurements.totalTime = performance.now() - startTime
  measurements.NODE_ENV = process.env.NODE_ENV
  measurements.timestamp = new Date().toISOString()

  return NextResponse.json(measurements)
}
