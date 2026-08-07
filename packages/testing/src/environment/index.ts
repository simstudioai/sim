/**
 * Detects external command-line tools that a handful of tests shell out to.
 *
 * A few suites deliberately execute the real thing rather than a mock — the cloud-review
 * helper's path and read-size bounds, and the code-placeholder compiler's generated Python.
 * That is the point of those tests, but it makes them depend on tools the repo does not
 * vendor, and the failure mode is a raw `SyntaxError` or `ENOENT` from a subprocess with
 * nothing tying it back to a missing tool.
 *
 * Locally these report `false` and print one actionable line, so the affected tests skip.
 * Under `CI` they throw instead: a missing tool there means the gate silently stopped
 * covering a security boundary, which is strictly worse than a red build.
 */
import { spawnSync } from 'node:child_process'

/** Python 3.10 is the floor: the compiler suite generates `match` statements. */
export const MIN_PYTHON: readonly [number, number] = [3, 10]

/** Reasons to pass to vitest's `ctx.skip(...)` so the report says why, not just that. */
export const PYTHON_SKIP_REASON = 'needs python3 >= 3.10; macOS ships 3.9'
export const RIPGREP_SKIP_REASON = 'needs ripgrep (`rg`) on PATH'

const warned = new Set<string>()

function unavailable(tool: string, hint: string): false {
  if (process.env.CI) {
    throw new Error(
      `${tool} is required to run this suite and was not found. CI must never skip these tests — they cover behavior that is only observable by running the real tool. ${hint}`
    )
  }
  if (!warned.has(tool)) {
    warned.add(tool)
    console.warn(`[@sim/testing] Skipping tests that require ${tool}. ${hint}`)
  }
  return false
}

/** Parses `python3 --version`, returning null when the interpreter is missing or unreadable. */
export function detectPython3(): { major: number; minor: number } | null {
  const result = spawnSync('python3', ['--version'], { encoding: 'utf8' })
  const match = /Python (\d+)\.(\d+)/.exec(`${result.stdout ?? ''}${result.stderr ?? ''}`)
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]) }
}

/**
 * True when `python3` resolves to at least {@link MIN_PYTHON}.
 *
 * macOS ships 3.9 as the system `python3` and Homebrew's newer builds are not linked as
 * `python3`, so this is false on a stock Mac even when a modern Python is installed.
 */
export function hasPython3(): boolean {
  const version = detectPython3()
  const [minMajor, minMinor] = MIN_PYTHON
  const label = `python3 >= ${minMajor}.${minMinor}`
  const hint = `Found ${version ? `${version.major}.${version.minor}` : 'no python3 on PATH'}. Install a newer Python (e.g. \`brew install python@3.13\`) and put it on PATH ahead of /usr/bin.`
  if (!version) return unavailable(label, hint)
  if (version.major > minMajor) return true
  if (version.major === minMajor && version.minor >= minMinor) return true
  return unavailable(label, hint)
}

/** True when `rg` is an executable on PATH. */
export function hasRipgrep(): boolean {
  const result = spawnSync('rg', ['--version'], { encoding: 'utf8' })
  if (result.status === 0) return true
  return unavailable('ripgrep (`rg`)', 'Install it with `brew install ripgrep`.')
}
