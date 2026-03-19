import { CircuitBreakerMiddleware } from './circuit-breaker'
import { ResiliencePipeline } from './pipeline'
import { SchemaValidatorMiddleware } from './schema-validator'
import { TelemetryMiddleware } from './telemetry'
import type { McpExecutionContext } from './types'

// Setup Pipeline with a fast 1.5s reset timeout for the demo
const pipeline = new ResiliencePipeline()
  .use(new TelemetryMiddleware())
  .use(new SchemaValidatorMiddleware())
  .use(new CircuitBreakerMiddleware({ failureThreshold: 3, resetTimeoutMs: 1500 }))

const mockContext: McpExecutionContext = {
  toolCall: { name: 'flaky_tool', arguments: {} },
  serverId: 'demo-server',
  userId: 'demo-user',
  workspaceId: 'demo-workspace',
}

let attemptTracker = 0

// A mock downstream MCP execution handler that fails the first 4 times, then succeeds
const mockExecuteTool = async () => {
  attemptTracker++
  console.log(`\n--- Request #${attemptTracker} ---`)

  // Simulate network latency
  await new Promise((r) => setTimeout(r, 50))

  if (attemptTracker <= 3) {
    throw new Error('Connection Refused: Target server is down!')
  }

  return { content: [{ type: 'text', text: 'Success! Target server is back online.' }] }
}

async function runDemo() {
  console.log('🚀 Starting Resilience Pipeline Demo...\n')

  // Attempt 1: CLOSED -> Fails
  try {
    await pipeline.execute(mockContext, mockExecuteTool)
  } catch (e: any) {
    console.error(`❌ Result: ${e.message}`)
  }

  // Attempt 2: CLOSED -> Fails
  try {
    await pipeline.execute(mockContext, mockExecuteTool)
  } catch (e: any) {
    console.error(`❌ Result: ${e.message}`)
  }

  // Attempt 3: CLOSED -> Fails (Hits threshold, trips to OPEN)
  try {
    await pipeline.execute(mockContext, mockExecuteTool)
  } catch (e: any) {
    console.error(`❌ Result: ${e.message}`)
  }

  // Attempt 4: OPEN (Fast fails immediately without hitting downstream mockExecuteTool)
  try {
    await pipeline.execute(mockContext, mockExecuteTool)
  } catch (e: any) {
    console.error(`🛑 Fast-Fail Result: ${e.message}`)
  }

  console.log('\n⏳ Waiting 2 seconds for Circuit Breaker to cool down...')
  await new Promise((r) => setTimeout(r, 2000))

  // Attempt 5: HALF-OPEN -> Succeeds! (Transitions back to CLOSED)
  try {
    const result = await pipeline.execute(mockContext, mockExecuteTool)
    console.log(`✅ Result: ${result.content?.[0].text}`)
  } catch (e: any) {
    console.error(`❌ Result: ${e.message}`)
  }

  // Attempt 6: CLOSED -> Succeeds normally
  try {
    const result = await pipeline.execute(mockContext, mockExecuteTool)
    console.log(`✅ Result: ${result.content?.[0].text}`)
  } catch (e: any) {
    console.error(`❌ Result: ${e.message}`)
  }

  console.log('\n🎉 Demo Complete!')
}

runDemo().catch(console.error)
