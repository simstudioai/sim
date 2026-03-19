import { describe, expect, mock, test } from 'bun:test'
import { ResiliencePipeline } from './pipeline'
import type { McpExecutionContext, McpMiddleware, McpMiddlewareNext } from './types'

const infoInfo = mock()
const errorError = mock()

// Mock logger before any imports of telemetry
mock.module('@sim/logger', () => ({
  createLogger: () => ({
    info: infoInfo,
    error: errorError,
    warn: mock(),
    debug: mock(),
  }),
}))

// Dynamically import TelemetryMiddleware so the mock applies
const { TelemetryMiddleware } = await import('./telemetry')

describe('ResiliencePipeline', () => {
  const mockContext: McpExecutionContext = {
    toolCall: { name: 'test_tool', arguments: {} },
    serverId: 'server-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
  }

  test('should execute middlewares in order', async () => {
    const pipeline = new ResiliencePipeline()
    const order: number[] = []

    const m1: McpMiddleware = {
      execute: async (ctx, next) => {
        order.push(1)
        const res = await next(ctx)
        order.push(4)
        return res
      },
    }

    const m2: McpMiddleware = {
      execute: async (ctx, next) => {
        order.push(2)
        const res = await next(ctx)
        order.push(3)
        return res
      },
    }

    pipeline.use(m1).use(m2)

    const finalHandler: McpMiddlewareNext = async () => {
      return { content: [{ type: 'text', text: 'success' }] }
    }

    const result = await pipeline.execute(mockContext, finalHandler)

    expect(order).toEqual([1, 2, 3, 4])
    expect(result.content?.[0].text).toBe('success')
  })
})

describe('TelemetryMiddleware', () => {
  const mockContext: McpExecutionContext = {
    toolCall: { name: 'telemetry_tool', arguments: {} },
    serverId: 'server-2',
    userId: 'user-2',
    workspaceId: 'workspace-2',
  }

  test('should log success with latency', async () => {
    infoInfo.mockClear()

    const telemetry = new TelemetryMiddleware()

    const finalHandler: McpMiddlewareNext = async () => {
      // simulate some latency
      await new Promise((r) => setTimeout(r, 10))
      return { content: [] }
    }

    await telemetry.execute(mockContext, finalHandler)

    expect(infoInfo).toHaveBeenCalled()
    const msg = infoInfo.mock.calls[0][0]
    const logCall = infoInfo.mock.calls[0][1]
    expect(msg).toBe('MCP Tool Execution Completed')
    expect(logCall.toolName).toBe('telemetry_tool')
    expect(logCall.latency_ms).toBeGreaterThanOrEqual(10)
    expect(logCall.success).toBe(true)
  })

  test('should log TOOL_ERROR when tool result has isError: true', async () => {
    infoInfo.mockClear()

    const telemetry = new TelemetryMiddleware()

    const finalHandler: McpMiddlewareNext = async () => {
      return { isError: true, content: [] }
    }

    await telemetry.execute(mockContext, finalHandler)

    expect(infoInfo).toHaveBeenCalled()
    const msg = infoInfo.mock.calls[0][0]
    const logCall = infoInfo.mock.calls[0][1]
    expect(msg).toBe('MCP Tool Execution Completed')
    expect(logCall.success).toBe(false)
    expect(logCall.failure_reason).toBe('TOOL_ERROR')
  })

  test('should log exception and rethrow with TIMEOUT explanation', async () => {
    errorError.mockClear()

    const telemetry = new TelemetryMiddleware()

    const finalHandler: McpMiddlewareNext = async () => {
      throw new Error('Connection timeout occurred')
    }

    let caughtError: Error | null = null
    try {
      await telemetry.execute(mockContext, finalHandler)
    } catch (e: any) {
      caughtError = e
    }

    expect(caughtError).toBeDefined()
    expect(errorError).toHaveBeenCalled()
    const msg = errorError.mock.calls[0][0]
    const logCall = errorError.mock.calls[0][1]
    expect(msg).toBe('MCP Tool Execution Failed')
    expect(logCall.failure_reason).toBe('TIMEOUT')
  })
})

const { CircuitBreakerMiddleware } = await import('./circuit-breaker')

describe('CircuitBreakerMiddleware', () => {
  const mockContext: McpExecutionContext = {
    toolCall: { name: 'cb_tool', arguments: {} },
    serverId: 'cb-server-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
  }

  test('should trip to OPEN after threshold failures', async () => {
    const cb = new CircuitBreakerMiddleware({ failureThreshold: 2, resetTimeoutMs: 1000 })
    const errorMsg = 'Tool Failed'
    const failingHandler: McpMiddlewareNext = async () => {
      throw new Error(errorMsg)
    }

    // 1st failure (CLOSED -> CLOSED)
    await expect(cb.execute(mockContext, failingHandler)).rejects.toThrow(errorMsg)

    // 2nd failure (CLOSED -> OPEN)
    await expect(cb.execute(mockContext, failingHandler)).rejects.toThrow(errorMsg)

    // 3rd attempt (OPEN -> Fail Fast)
    await expect(cb.execute(mockContext, failingHandler)).rejects.toThrow(
      'Circuit breaker is OPEN for server cb-server-1. Fast-failing request to cb_tool.'
    )
  })

  test('should transition CLOSED -> OPEN -> HALF-OPEN lock correctly', async () => {
    const resetTimeoutMs = 50
    const cb = new CircuitBreakerMiddleware({ failureThreshold: 1, resetTimeoutMs })
    const failingHandler: McpMiddlewareNext = async () => {
      throw new Error('Fail')
    }

    // Trip to OPEN
    await expect(cb.execute(mockContext, failingHandler)).rejects.toThrow('Fail')
    await expect(cb.execute(mockContext, failingHandler)).rejects.toThrow('OPEN')

    // Wait for timeout to enter HALF-OPEN
    await new Promise((r) => setTimeout(r, resetTimeoutMs + 10))

    // Create a Slow Probe Handler to mimic latency and hold the lock
    let probeInProgress = false
    const slowProbeHandler: McpMiddlewareNext = async () => {
      probeInProgress = true
      await new Promise((r) => setTimeout(r, 100))
      return { content: [{ type: 'text', text: 'Probe Success' }] }
    }

    // Send a batch of 3 concurrent requests while the reset timeout has passed
    // The first should acquire HALF-OPEN, the rest should fail fast.
    const promises = [
      cb.execute(mockContext, slowProbeHandler),
      cb.execute(mockContext, async () => {
        return { content: [] }
      }),
      cb.execute(mockContext, async () => {
        return { content: [] }
      }),
    ]

    const results = await Promise.allSettled(promises)

    // Exactly one should succeed (the slow probe)
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    expect(fulfilled.length).toBe(1)
    expect((fulfilled[0] as PromiseFulfilledResult<any>).value.content[0].text).toBe(
      'Probe Success'
    )

    // Exactly two should fail-fast due to HALF-OPEN lock
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(rejected.length).toBe(2)
    expect((rejected[0] as PromiseRejectedResult).reason.message).toContain(
      'Circuit breaker is HALF-OPEN'
    )

    expect(probeInProgress).toBe(true)

    // Subsequent requests should now succeed (CLOSED again)
    const newResult = await cb.execute(mockContext, async () => {
      return { content: [{ type: 'text', text: 'Normal' }] }
    })
    expect(newResult.content?.[0].text).toBe('Normal')
  })
})

const { SchemaValidatorMiddleware } = await import('./schema-validator')

describe('SchemaValidatorMiddleware', () => {
  const mockSchemaTool: any = {
    name: 'test_schema_tool',
    serverId: 's1',
    serverName: 's1',
    inputSchema: {
      type: 'object',
      properties: {
        requiredStr: { type: 'string' },
        optionalNum: { type: 'number' },
        enumVal: { type: 'string', enum: ['A', 'B'] },
      },
      required: ['requiredStr'],
    },
  }

  test('should compile, cache, and successfully validate valid args', async () => {
    let providerCalled = 0
    const toolProvider = async (name: string) => {
      providerCalled++
      return name === 'test_schema_tool' ? mockSchemaTool : undefined
    }

    const validator = new SchemaValidatorMiddleware({ toolProvider })

    const mockContext: any = {
      toolCall: {
        name: 'test_schema_tool',
        arguments: {
          requiredStr: 'hello',
          enumVal: 'A',
        },
      },
      serverId: 'server-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    }

    let nextCalled = false
    const nextHandler: any = async (ctx: any) => {
      nextCalled = true
      expect(ctx.toolCall.arguments).toEqual({
        requiredStr: 'hello',
        enumVal: 'A',
      })
      return { content: [{ type: 'text', text: 'ok' }] }
    }

    const result1 = await validator.execute(
      {
        ...mockContext,
        toolCall: { name: 'test_schema_tool', arguments: { requiredStr: 'hello', enumVal: 'A' } },
      },
      nextHandler
    )
    expect(result1.content?.[0].text).toBe('ok')
    expect(nextCalled).toBe(true)
    expect(providerCalled).toBe(1)

    // Second call should hit the cache
    nextCalled = false
    const result2 = await validator.execute(
      {
        ...mockContext,
        toolCall: { name: 'test_schema_tool', arguments: { requiredStr: 'hello', enumVal: 'A' } },
      },
      nextHandler
    )
    expect(result2.content?.[0].text).toBe('ok')
    expect(nextCalled).toBe(true)
    expect(providerCalled).toBe(1) // from cache
  })

  test('should intercept validation failure and return gracefully formatted error', async () => {
    const validator = new SchemaValidatorMiddleware()
    validator.cacheTool(mockSchemaTool)

    const mockContext: any = {
      toolCall: {
        name: 'test_schema_tool',
        arguments: {
          // missing requiredStr
          enumVal: 'C', // invalid enum
        },
      },
      serverId: 'server-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    }

    let nextCalled = false
    const nextHandler: any = async () => {
      nextCalled = true
      return { content: [] }
    }

    const result = await validator.execute(mockContext, nextHandler)
    expect(nextCalled).toBe(false)
    expect(result.isError).toBe(true)
    expect(result.content?.[0].type).toBe('text')

    const errorText = result.content?.[0].text as string
    expect(errorText).toContain('Schema validation failed')
    expect(errorText).toContain('requiredStr')
    expect(errorText).toContain('enumVal')
  })
})
