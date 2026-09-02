import type { AgentCliGrepStage, AgentCliPipeStage } from '@/lib/mothership/generated/agent-cli'

/**
 * Applies the worker's already-parsed pipe stages to a command's stdout. Grep is a
 * native filter over the string — nothing is spawned — and every option arrives typed,
 * so no flag is ever interpreted on this side.
 */

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

export function applyPipeline(stdout: string, stages: readonly AgentCliPipeStage[]): string {
  let current = stdout
  for (const stage of stages) current = runGrep(current, stage)
  return current
}
