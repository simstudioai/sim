/**
 * Grep-pipe support for sim_cli invocations:
 * `["workflows","export","<id>","|","grep","-n","slack"]`.
 *
 * NOT a shell. A `|` token splits the argv into the CLI invocation plus grep
 * stages — grep is the only supported filter, implemented natively over the
 * stdout string. Nothing is spawned, and the filtering happens sim-side so a
 * huge output shrinks BEFORE it crosses the wire into the model's window.
 */

export interface PipeSplit {
  cliArgs: string[]
  stages: string[][]
}

/** Splits argv on `|` tokens. A lone invocation returns zero stages. */
export function splitPipeline(args: string[]): PipeSplit {
  const segments: string[][] = [[]]
  for (const arg of args) {
    if (arg === '|') {
      segments.push([])
    } else {
      segments[segments.length - 1].push(arg)
    }
  }
  const [cliArgs, ...stages] = segments
  return { cliArgs, stages }
}

class PipeUsageError extends Error {}

function compileGrepPattern(raw: string, ignoreCase: boolean): (line: string) => boolean {
  try {
    const regex = new RegExp(raw, ignoreCase ? 'i' : '')
    return (line) => regex.test(line)
  } catch {
    const needle = ignoreCase ? raw.toLowerCase() : raw
    return (line) => (ignoreCase ? line.toLowerCase() : line).includes(needle)
  }
}

function parseContextCount(args: string[], i: number, flag: string): number {
  const count = Number.parseInt(args[i] ?? '', 10)
  if (!Number.isFinite(count) || count < 0) {
    throw new PipeUsageError(`grep ${flag} needs a non-negative number`)
  }
  return count
}

function runGrep(input: string, args: string[]): string {
  let ignoreCase = false
  let invert = false
  let countOnly = false
  let lineNumbers = false
  let maxCount = Number.POSITIVE_INFINITY
  let before = 0
  let after = 0
  const positional: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-i') ignoreCase = true
    else if (arg === '-v') invert = true
    else if (arg === '-c') countOnly = true
    else if (arg === '-n') lineNumbers = true
    else if (arg === '-E') {
      // Patterns are compiled as regexes by default; -E is accepted as a no-op.
    } else if (arg === '-m') {
      maxCount = Number.parseInt(args[++i] ?? '', 10)
      if (!Number.isFinite(maxCount) || maxCount < 1) {
        throw new PipeUsageError('grep -m needs a positive number')
      }
    } else if (arg === '-A') {
      after = parseContextCount(args, ++i, '-A')
    } else if (arg === '-B') {
      before = parseContextCount(args, ++i, '-B')
    } else if (arg === '-C') {
      const count = parseContextCount(args, ++i, '-C')
      before = count
      after = count
    } else if (arg.startsWith('-')) {
      throw new PipeUsageError(
        `grep: unsupported flag ${arg} (supported: -i -v -c -n -E -m N -A N -B N -C N)`
      )
    } else {
      positional.push(arg)
    }
  }
  const pattern = positional[0]
  if (pattern === undefined) throw new PipeUsageError('grep needs a pattern')
  const matches = compileGrepPattern(pattern, ignoreCase)
  const lines = input.split('\n')
  // Context flags select a window of line indexes around each hit (union, in
  // order, no duplicates) — matching grep's -A/-B/-C output without separators.
  const selected = new Set<number>()
  let hits = 0
  for (let lineNo = 0; lineNo < lines.length && hits < maxCount; lineNo++) {
    const hit = matches(lines[lineNo])
    if (hit !== invert) {
      hits++
      const from = Math.max(0, lineNo - before)
      const to = Math.min(lines.length - 1, lineNo + after)
      for (let i = from; i <= to; i++) selected.add(i)
    }
  }
  if (countOnly) return String(hits)
  const out = [...selected].sort((a, b) => a - b)
  return out.map((i) => (lineNumbers ? `${i + 1}:${lines[i]}` : lines[i])).join('\n')
}

/** Applies the grep stages to stdout. Returns the filtered text, or a usage error. */
export function applyPipeline(
  stdout: string,
  stages: string[][]
): { ok: true; stdout: string } | { ok: false; error: string } {
  let current = stdout
  for (const stage of stages) {
    const [command, ...grepArgs] = stage
    if (command !== 'grep') {
      return {
        ok: false,
        error: `"${command ?? ''}" is not a supported filter. grep is the only pipe target (e.g. ... | grep -i slack). There is no shell — no other commands, redirection, or substitution.`,
      }
    }
    try {
      current = runGrep(current, grepArgs)
    } catch (error) {
      if (error instanceof PipeUsageError) return { ok: false, error: error.message }
      throw error
    }
  }
  return { ok: true, stdout: current }
}
