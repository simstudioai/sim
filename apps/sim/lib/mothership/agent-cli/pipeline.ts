import { raw as jqRaw } from 'jq-wasm'
import type {
  AgentCliGrepStage,
  AgentCliPipeStage,
  AgentCliRawResult,
} from '@/lib/mothership/generated/agent-cli'

/**
 * Applies the worker's already-parsed pipe stages to a command's result. Every option
 * arrives typed, so no flag is ever interpreted on this side:
 *  - grep: a native filter over the string — nothing is spawned.
 *  - jq: real jq (1.8, WebAssembly) over JSON stdout — the model's slicing tool, with
 *    the semantics it already knows.
 *  - outline: keys, types, and counts to depth 3, no values — the shape of a big
 *    response for the price of a few lines.
 * A stage that cannot apply (non-JSON stdout, a jq error) fails the invocation with
 * the reason on stderr, so the model corrects the pipe instead of reading garbage.
 */

const OUTLINE_MAX_DEPTH = 3
const OUTLINE_MAX_KEYS = 40

function compileGrepPattern(raw: string, ignoreCase: boolean): (line: string) => boolean {
  try {
    const regex = new RegExp(raw, ignoreCase ? 'i' : '')
    return (line) => regex.test(line)
  } catch {
    const needle = ignoreCase ? raw.toLowerCase() : raw
    return (line) => (ignoreCase ? line.toLowerCase() : line).includes(needle)
  }
}

function runGrep(input: string, stage: AgentCliGrepStage): string {
  const matches = compileGrepPattern(stage.pattern, stage.ignoreCase)
  const lines = input.split('\n')
  const maxCount = stage.maxCount ?? Number.POSITIVE_INFINITY
  // Context options select a window of line indexes around each hit (union, in
  // order, no duplicates) — matching grep's -A/-B/-C output without separators.
  const selected = new Set<number>()
  let hits = 0
  for (let lineNo = 0; lineNo < lines.length && hits < maxCount; lineNo++) {
    const hit = matches(lines[lineNo])
    if (hit !== stage.invert) {
      hits++
      const from = Math.max(0, lineNo - stage.linesBefore)
      const to = Math.min(lines.length - 1, lineNo + stage.linesAfter)
      for (let i = from; i <= to; i++) selected.add(i)
    }
  }
  if (stage.countOnly) return String(hits)
  const out = [...selected].sort((a, b) => a - b)
  return out.map((i) => (stage.lineNumbers ? `${i + 1}:${lines[i]}` : lines[i])).join('\n')
}

class PipeStageError extends Error {}

/** JSON.parse's result space, spelled out: what jq accepts as input. */
type JsonValue = string | number | boolean | object | null

function parseJsonStdout(stdout: string, stage: string): JsonValue {
  try {
    const parsed: JsonValue = JSON.parse(stdout)
    return parsed
  } catch {
    throw new PipeStageError(
      `${stage}: stdout is not JSON. Run the command with --output json before piping into ${stage}.`
    )
  }
}

async function runJq(input: string, expression: string): Promise<string> {
  const value = parseJsonStdout(input, 'jq')
  const result = await jqRaw(value, expression)
  if (result.exitCode !== 0) {
    throw new PipeStageError(`jq: ${result.stderr.trim() || `exited with code ${result.exitCode}`}`)
  }
  return result.stdout.trimEnd()
}

function describe(value: unknown, depth: number, indent: string, out: string[]): void {
  if (Array.isArray(value)) {
    out.push(`${indent}[${value.length} items]`)
    if (depth < OUTLINE_MAX_DEPTH && value.length > 0)
      describe(value[0], depth + 1, `${indent}  `, out)
    return
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    for (const [key, child] of entries.slice(0, OUTLINE_MAX_KEYS)) {
      const kind = Array.isArray(child)
        ? `array[${child.length}]`
        : child === null
          ? 'null'
          : typeof child === 'object'
            ? `object{${Object.keys(child as object).length}}`
            : typeof child
      out.push(`${indent}${key}: ${kind}`)
      if (depth < OUTLINE_MAX_DEPTH && child !== null && typeof child === 'object') {
        describe(child, depth + 1, `${indent}  `, out)
      }
    }
    if (entries.length > OUTLINE_MAX_KEYS)
      out.push(`${indent}… ${entries.length - OUTLINE_MAX_KEYS} more keys`)
    return
  }
  out.push(`${indent}${typeof value}`)
}

function runOutline(input: string): string {
  const value = parseJsonStdout(input, 'outline')
  const out: string[] = []
  describe(value, 1, '', out)
  return out.join('\n')
}

export async function applyPipeline(
  result: AgentCliRawResult,
  stages: readonly AgentCliPipeStage[]
): Promise<AgentCliRawResult> {
  let current = result.stdout
  try {
    for (const stage of stages) {
      if (stage.kind === 'grep') current = runGrep(current, stage)
      else if (stage.kind === 'jq') current = await runJq(current, stage.expression)
      else current = runOutline(current)
    }
  } catch (error) {
    if (error instanceof PipeStageError) {
      return { exitCode: 1, stdout: '', stderr: `Error: ${error.message}` }
    }
    throw error
  }
  return { ...result, stdout: current }
}
