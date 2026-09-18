import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { repositoryRoot } from '#design-conformance/command'
import { git } from '#design-conformance/io'

interface CiEvent {
  before?: string
  pull_request?: { base: { sha: string }; head: { sha: string } }
}

/** Select immutable event revisions, not a moving branch or the synthetic PR merge commit. */
export function ciRefs(
  eventName: string,
  event: CiEvent,
  sha: string
): { base: string; head: string } {
  const commit = (value: string | undefined) => {
    if (!value || !/^[a-f\d]{40}$/.test(value) || /^0+$/.test(value))
      throw new Error('Missing or invalid CI commit SHA')
    return value
  }
  if (eventName === 'pull_request')
    return {
      base: commit(event.pull_request?.base.sha),
      head: commit(event.pull_request?.head.sha),
    }
  const head = commit(sha)
  return {
    base:
      eventName === 'push' && event.before && !/^0{40}$/.test(event.before)
        ? commit(event.before)
        : 'HEAD~1',
    head,
  }
}

export function warningExitCode(
  status: number | null,
  signal: string | null,
  report?: { status: string; flagged: boolean | null; findings: unknown[] }
): number {
  if (signal || !report || report.status !== 'completed' || !Array.isArray(report.findings))
    return 2
  if (status === 0 && report.flagged === false && report.findings.length === 0) return 0
  if (status === 1 && report.flagged === true && report.findings.length > 0) return 0
  return 2
}

/** Exit 1 is safe to tolerate only when a fresh completed report proves there were findings. */
export function runWarningCheck(argv: string[]): number {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'sim-design-check-'))
  try {
    const output = path.join(temp, 'report.json')
    const child = spawnSync(
      process.execPath,
      [
        '--no-env-file',
        fileURLToPath(new URL('../check-design-conformance.ts', import.meta.url)),
        ...argv,
        '--output',
        output,
      ],
      { stdio: 'inherit' }
    )
    if (child.error) throw child.error
    return warningExitCode(child.status, child.signal, JSON.parse(readFileSync(output, 'utf8')))
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

/** Shared base resolution preserves full history for all three diff-based audits. */
export function resolveCiRefs(): void {
  if (!process.env.GITHUB_EVENT_PATH || !process.env.GITHUB_OUTPUT)
    throw new Error('CI event and output paths are required')
  const refs = ciRefs(
    process.env.GITHUB_EVENT_NAME ?? '',
    JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
    process.env.GITHUB_SHA ?? ''
  )
  for (const ref of [refs.base, refs.head]) {
    try {
      git(repositoryRoot, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])
    } catch {
      if (ref === 'HEAD~1') throw new Error('No previous commit is available for the CI comparison')
      git(repositoryRoot, ['fetch', '--no-tags', 'origin', ref])
    }
  }
  if (git(repositoryRoot, ['rev-parse', '--is-shallow-repository']).toString().trim() === 'true')
    throw new Error('Diff-based audits require a full-history checkout')
  appendFileSync(process.env.GITHUB_OUTPUT, `ref=${refs.base}\nhead=${refs.head}\n`)
}

if (import.meta.main) {
  try {
    if (process.argv[2] === '--resolve-refs') resolveCiRefs()
    else process.exitCode = runWarningCheck(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(
      `Design CI failed: ${JSON.stringify(error instanceof Error ? error.message : 'Operational failure')}\n`
    )
    process.exitCode = 2
  }
}
