import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { z } from 'zod'
import { v2ErrorResponseSchema } from '@/lib/api/contracts/v2/shared'
import {
  CODE_TOOL_NAMES,
  getMcpOperation,
  isReadOperation,
  operationRequestInput,
  resolveOperation,
} from '@/lib/api/mcp/catalog'
import {
  dispatchMcpRequest,
  type McpDispatchContext,
  unreadableMessage,
} from '@/lib/api/mcp/dispatch'
import { createConcurrencyLimit } from '@/lib/core/utils/concurrency'
import { runSandboxTask, SandboxUserCodeError } from '@/lib/execution/sandbox/run-task'
import { loadTypeScript } from '@/lib/execution/typescript'
import { structuredToolResult, toolError } from '@/lib/mcp/tool-result'
import { SIM_API_CODE_MAX_TIMEOUT_MS } from '@/sandboxes/sim-api-code'

const logger = createLogger('SimMcpCodeMode')

const DEFAULT_TIMEOUT_MS = 60_000
/** API calls one program may make; each is a full v2 request against the caller's rate limit. */
const MAX_CALLS_PER_RUN = 200
/** Calls one program may have in flight at once, so a `Promise.all` cannot fan out a whole page of requests. */
const MAX_CONCURRENT_CALLS = 8
const MAX_CODE_CHARS = 100_000
const NOT_SENT = 'The program ended before this call was sent.'

export const codeModeInput = z
  .object({
    code: z
      .string()
      .min(1)
      .max(MAX_CODE_CHARS)
      .describe(
        'The body of an async function. Call operations with `await sim.api.<operation>(input)`, where input is { params?, query?, body?, headers? } exactly as describe_operation’s signature declares, and `return` a JSON-serializable value: only that value comes back. TypeScript is accepted; types are stripped, not checked. A failed call throws SimApiError with status, code, message, and details.'
      ),
    timeoutMs: z
      .number()
      .int()
      .min(1000)
      .max(SIM_API_CODE_MAX_TIMEOUT_MS)
      .optional()
      .describe(
        `How long the program may run in milliseconds. Defaults to ${DEFAULT_TIMEOUT_MS}; at most ${SIM_API_CODE_MAX_TIMEOUT_MS}.`
      ),
  })
  .strict()

const callRecord = z.object({
  operation: z.string(),
  status: z.number().optional().describe('HTTP status the operation answered with.'),
  durationMs: z.number(),
  refused: z
    .string()
    .optional()
    .describe('Why the call never reached the operation, such as a write in a read program.'),
  unreadable: z
    .string()
    .optional()
    .describe(
      'The operation ran, or may still be running, but its answer could not be returned: too large, not JSON, or not back before the program ended.'
    ),
})

export const codeModeOutput = z.object({
  result: z.unknown().describe('The value the program returned.'),
  calls: z.array(callRecord).describe('Every API call the program made, in order.'),
  logs: z.string().optional().describe('Console output, truncated past 64 KB.'),
})

type CallRecord = z.infer<typeof callRecord>
type CodeKind = keyof typeof CODE_TOOL_NAMES

/**
 * What `finalize` reports: the program's value or its error, with captured
 * console output. The isolate already refused a result over the size cap.
 */
const outcomeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), result: z.unknown(), logs: z.string() }),
  z.object({ ok: z.literal(false), error: z.record(z.string(), z.unknown()), logs: z.string() }),
])

const simApiCall = z.object({ operation: z.string(), input: operationRequestInput }).strict()

/**
 * A call's answer as the isolate reads it: the response body as JSON text,
 * parsed in the isolate rather than on the request's event loop, or the
 * failure its `SimApiError` carries.
 */
type SimApiAnswer =
  | { dataJson: string }
  | {
      error: {
        status: number
        code: string
        message: string
        details?: unknown
        requestId?: string
      }
    }

function apiFailure(status: number, code: string, message: string): SimApiAnswer {
  return { error: { status, code, message } }
}

/** The v2 error envelope as the program's `SimApiError`, or the raw text when it is not one. */
function envelopeFailure(status: number, text: string): SimApiAnswer {
  try {
    const parsed = v2ErrorResponseSchema.safeParse(JSON.parse(text))
    if (parsed.success) return { error: { status, ...parsed.data.error } }
  } catch {}
  return apiFailure(status, 'ERROR', text)
}

/**
 * Strips TypeScript from the program body and wraps it so its settlement,
 * value or error, is recorded for `finalize` rather than lost to the worker.
 * Syntax errors come back with lines numbered as the caller wrote them.
 */
async function compileProgram(code: string): Promise<{ script: string } | { error: string }> {
  const ts = await loadTypeScript()
  const { outputText, diagnostics } = ts.transpileModule(
    `const __simProgram = async () => {\n${code}\n};`,
    {
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }
  )
  const problems = (diagnostics ?? []).flatMap((diagnostic) => {
    if (!diagnostic.file || diagnostic.start === undefined) return []
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    const { line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
    return [`Line ${Math.max(1, line)}: ${message}`]
  })
  if (problems.length > 0) return { error: `The program does not parse.\n${problems.join('\n')}` }
  return {
    script: `${outputText}\ntry { __simCodeSettle(true, await __simProgram()); } catch (error) { __simCodeSettle(false, error); }`,
  }
}

function failure(error: Record<string, unknown>, calls: CallRecord[], logs?: string) {
  return toolError(JSON.stringify({ error, calls, ...(logs ? { logs } : {}) }, null, 2))
}

/**
 * Runs one code-mode program for the read or write code tool.
 *
 * The program runs in a fresh isolate with no network. Each `sim.api` call
 * crosses back to this request through the `simApi` broker and is dispatched
 * exactly as the call tools dispatch one: the v2 route authenticates the
 * request's own credential and applies its scope, workspace permissions,
 * refusals, and rate limit. The read tool additionally refuses, here on the
 * host, every operation the write tool would run.
 */
export async function runCodeMode(
  kind: CodeKind,
  input: z.infer<typeof codeModeInput>,
  context: McpDispatchContext,
  ownerKey: string
): Promise<CallToolResult> {
  const startedAt = performance.now()
  const runId = generateShortId(12)
  const calls: CallRecord[] = []
  /** Calls handed to the dispatcher; the rest of an unfinished run's calls were never sent. */
  const sent = new Set<CallRecord>()
  let writes = 0
  const limit = createConcurrencyLimit(MAX_CONCURRENT_CALLS)
  /** Ends the run's in-flight calls once the program is over, whether it returned, threw, or timed out. */
  const runEnded = new AbortController()
  const signal = AbortSignal.any([context.signal, runEnded.signal])

  const summary = (outcome: string) =>
    logger.info('Sim MCP code run finished', {
      codeRunId: runId,
      tool: CODE_TOOL_NAMES[kind],
      ownerKey,
      outcome,
      calls: calls.length,
      writes,
      durationMs: Math.round(performance.now() - startedAt),
      codeSha256: sha256Hex(input.code),
    })

  const compiled = await compileProgram(input.code)
  if ('error' in compiled) {
    summary('syntax_error')
    return toolError(compiled.error)
  }

  async function callSimApi(args: unknown): Promise<SimApiAnswer> {
    const parsed = simApiCall.safeParse(args)
    if (!parsed.success) {
      return apiFailure(400, 'INVALID_CALL', `Invalid sim.api input: ${parsed.error.message}`)
    }
    if (calls.length >= MAX_CALLS_PER_RUN) {
      throw new Error(`A program may make at most ${MAX_CALLS_PER_RUN} API calls.`)
    }
    const record: CallRecord = { operation: parsed.data.operation, durationMs: 0 }
    const callIndex = calls.push(record) - 1
    const callStartedAt = performance.now()
    try {
      const resolved = await resolveOperation(parsed.data.operation, 'any')
      if ('error' in resolved) {
        record.refused = resolved.error
        return apiFailure(404, 'UNKNOWN_OPERATION', resolved.error)
      }
      if (getMcpOperation(resolved.operation).contract.response.mode !== 'json') {
        record.refused = 'answers with a non-JSON body'
        return apiFailure(
          400,
          'NOT_CALLABLE',
          `${resolved.operation} does not answer with JSON, so code cannot call it.`
        )
      }
      const isRead = await isReadOperation(resolved.operation)
      if (!isRead && kind === 'read') {
        record.refused = 'write operation in a read program'
        return apiFailure(
          403,
          'WRITE_NOT_ALLOWED',
          `${resolved.operation} needs write access; run this program with ${CODE_TOOL_NAMES.write}.`
        )
      }
      if (!isRead) writes++
      const outcome = await limit(async () => {
        if (signal.aborted) return { rejected: NOT_SENT }
        sent.add(record)
        return dispatchMcpRequest(
          { ...parsed.data.input, operation: resolved.operation },
          { ...context, signal, logMetadata: { codeRunId: runId, callIndex } }
        )
      })
      if ('rejected' in outcome) {
        record.refused = outcome.rejected
        return apiFailure(400, 'INVALID_CALL', outcome.rejected)
      }
      record.status = outcome.status
      if ('unreadable' in outcome) {
        record.unreadable = outcome.unreadable
        return apiFailure(
          outcome.status,
          'UNREADABLE_RESPONSE',
          unreadableMessage(resolved.operation, outcome, isRead)
        )
      }
      return outcome.ok ? { dataJson: outcome.text } : envelopeFailure(outcome.status, outcome.text)
    } finally {
      record.durationMs = Math.round(performance.now() - callStartedAt)
    }
  }

  let bytes: Buffer | undefined
  let runError: unknown
  try {
    bytes = await runSandboxTask(
      'sim-api-code',
      { code: compiled.script },
      {
        ownerKey,
        callSimApi,
        signal: context.signal,
        timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      }
    )
  } catch (error) {
    runError = error
  }
  runEnded.abort()
  for (const record of calls) {
    if (record.status !== undefined || record.refused !== undefined) continue
    if (sent.has(record)) {
      record.unreadable = 'The program ended before this call answered; it may still complete.'
    } else {
      record.refused = NOT_SENT
    }
  }

  if (!bytes) {
    if (context.signal.aborted) {
      summary('cancelled')
      return failure({ name: 'AbortError', message: 'The program was cancelled.' }, calls)
    }
    if (runError instanceof SandboxUserCodeError) {
      summary(runError.name === 'TimeoutError' ? 'timeout' : 'error')
      return failure({ name: runError.name, message: runError.message }, calls)
    }
    summary('system_error')
    logger.error('Sim MCP code run failed', { codeRunId: runId, error: getErrorMessage(runError) })
    return failure(
      { name: 'Error', message: 'Unable to run the program. Please try again.' },
      calls
    )
  }

  const outcome = outcomeSchema.parse(JSON.parse(bytes.toString('utf8')))
  const logs = outcome.logs || undefined
  if (!outcome.ok) {
    summary('error')
    return failure(outcome.error, calls, logs)
  }
  summary('ok')
  return structuredToolResult({ result: outcome.result, calls, ...(logs ? { logs } : {}) })
}
