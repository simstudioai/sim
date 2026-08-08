/**
 * Detects external command-line tools that a few suites shell out to.
 *
 * Those suites deliberately execute the real thing rather than a mock, so they depend on tools
 * the repo does not vendor. Locally a missing tool skips them with a reason; under `CI` it
 * throws, because a silently-skipped security boundary is worse than a red build.
 */
import { spawnSync } from 'node:child_process'

/** PEP 701 f-strings set this floor, not the `match` statements (3.10) the suite also generates. */
const MIN_PYTHON: readonly [number, number] = [3, 12]

/** Reasons for vitest's `ctx.skip(...)`, so the report says why and not just that. */
export const PYTHON_SKIP_REASON = `needs python3 >= ${MIN_PYTHON.join('.')} (PEP 701 f-strings); macOS ships 3.9`
export const RIPGREP_SKIP_REASON = 'needs ripgrep (`rg`) on PATH'

/**
 * Wraps a probe so it runs at most once per process, warns at most once, and always throws
 * under CI — memoizing the throw would turn every call after the first into a silent skip.
 */
function toolGuard(label: string, detect: () => { ok: boolean; hint: string }): () => boolean {
  let result: { ok: boolean; hint: string } | undefined
  let warned = false
  return () => {
    result ??= detect()
    if (result.ok) return true
    if (process.env.CI) {
      throw new Error(
        `${label} is required to run this suite and was not found. CI must never skip these tests — they cover behavior that is only observable by running the real tool. ${result.hint}`
      )
    }
    if (!warned) {
      warned = true
      console.warn(`[@sim/testing] Skipping tests that require ${label}. ${result.hint}`)
    }
    return false
  }
}

/**
 * True when `python3` resolves to at least {@link MIN_PYTHON}.
 *
 * False on a stock Mac: macOS ships 3.9 as the system `python3`, and Homebrew's newer builds
 * are not linked under that name.
 */
export const hasPython3 = toolGuard(`python3 >= ${MIN_PYTHON.join('.')}`, () => {
  const probe = spawnSync('python3', ['--version'], { encoding: 'utf8' })
  const match = /Python (\d+)\.(\d+)/.exec(`${probe.stdout ?? ''}${probe.stderr ?? ''}`)
  const found = match ? { major: Number(match[1]), minor: Number(match[2]) } : null
  const [minMajor, minMinor] = MIN_PYTHON
  return {
    ok: Boolean(
      found && (found.major > minMajor || (found.major === minMajor && found.minor >= minMinor))
    ),
    hint: `Found ${found ? `${found.major}.${found.minor}` : 'no python3 on PATH'}. Install a newer Python (e.g. \`brew install python@3.13\`) and put it on PATH ahead of /usr/bin.`,
  }
})

/** True when `rg` is an executable on PATH. */
export const hasRipgrep = toolGuard('ripgrep (`rg`)', () => ({
  ok: spawnSync('rg', ['--version'], { encoding: 'utf8' }).status === 0,
  hint: 'Install it with `brew install ripgrep`.',
}))
