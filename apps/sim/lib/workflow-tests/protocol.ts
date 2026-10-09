import { z } from 'zod'

/**
 * The wire between the workflow-test harness (inside the isolate) and the host brokers.
 * Everything the isolate sends is untrusted test-author code, so every payload is parsed.
 */

const nameSchema = z.string().trim().min(1).max(200)
const MAX_TARGETS = 200

const keySchema = z.string().min(1).max(500)

const testTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    key: keySchema,
    kind: z.enum(['mock', 'spy']),
    workflow: nameSchema.nullable(),
    block: nameSchema,
  }),
  z.object({
    key: keySchema,
    kind: z.literal('tool'),
    workflow: nameSchema.nullable(),
    /** The calling Agent block; null answers the tool for every Agent. */
    block: nameSchema.nullable(),
    /** A built-in tool id, an MCP tool's name when `mcpServer` is set, or a custom tool's title. */
    tool: nameSchema,
    /** The MCP server, by name, so a test survives the server being re-added or forked. */
    mcpServer: nameSchema.nullable(),
    customTool: z.boolean(),
  }),
])
export type TestTarget = z.infer<typeof testTargetSchema>

export const testStartArgsSchema = z.object({
  workflow: nameSchema,
  /** The trigger block that starts the run, by name; needed when the workflow has several. */
  trigger: nameSchema.nullable(),
  input: z.unknown(),
  targets: z.array(testTargetSchema).max(MAX_TARGETS),
})

export const testReplyArgsSchema = z.union([
  z.object({ runId: z.string().min(1), callId: z.string().min(1), output: z.unknown() }),
  z.object({ runId: z.string().min(1), callId: z.string().min(1), error: z.string().max(10_000) }),
])

export const testNextArgsSchema = z.object({ runId: z.string().min(1) })

export const testCaseStatusSchema = z.enum(['running', 'pass', 'fail', 'skip'])
export type TestCaseStatus = z.infer<typeof testCaseStatusSchema>

export const testProgressArgsSchema = z.object({
  path: z.array(z.string().min(1).max(500)).min(1).max(20),
  status: testCaseStatusSchema,
})
export const testCancelArgsSchema = z.object({ runIds: z.array(z.string().min(1)).max(1000) })
export const testJudgeArgsSchema = z.object({
  value: z.string().max(200_000),
  rubric: z.string().trim().min(1).max(4_000),
})

export type TestEvent =
  | {
      kind: 'mock'
      runId: string
      callId: string
      key: string
      /** The mocked block, or the Agent block that made a mocked tool call. */
      block: string
      /** Set when an Agent's tool call is being answered. */
      tool?: string
      input: Record<string, unknown>
      /** A placeholder output shaped like the block's or tool's real one, for `mockSampleOutput`. */
      sample: Record<string, unknown>
      branchIndex?: number
    }
  | { kind: 'waiting'; runId: string }
  | {
      kind: 'done'
      runId: string
      executionId: string
      output: unknown
      error?: string
      spyCalls: Array<{ key: string; input: unknown; output: unknown }>
      /** Mock and spy keys that named a block in this run's workflow. */
      matchedKeys: string[]
    }

const checkSchema = z.object({
  status: z.enum(['pass', 'fail', 'skip']),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
  message: z.string().optional(),
  actual: z.unknown().optional(),
  expected: z.unknown().optional(),
  judge: z.string().optional(),
})

export const testReportSchema = z.object({
  topLevel: z.array(z.object({ kind: z.enum(['suite', 'test']), name: z.string() })),
  tests: z.array(
    z.object({
      path: z.array(z.string()).min(1),
      status: z.enum(['pass', 'fail', 'skip']),
      durationMs: z.number().nonnegative(),
      checks: z.array(checkSchema),
      executions: z.array(z.object({ workflow: z.string(), executionId: z.string() })),
      logs: z.array(z.string()),
      error: z
        .object({
          message: z.string(),
          line: z.number().int().positive().optional(),
          column: z.number().int().positive().optional(),
          actual: z.unknown().optional(),
          expected: z.unknown().optional(),
        })
        .optional(),
    })
  ),
})
export type TestReport = z.infer<typeof testReportSchema>

export const testCollectionSchema = z.object({
  topLevel: z.array(z.object({ kind: z.enum(['suite', 'test']), name: z.string() })),
  tests: z.array(
    z.object({
      path: z.array(z.string()).min(1),
      mode: z.enum(['run', 'only', 'skip']),
      line: z.number().int().positive(),
      endLine: z.number().int().positive(),
    })
  ),
})
export type TestCollection = z.infer<typeof testCollectionSchema>
