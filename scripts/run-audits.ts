#!/usr/bin/env bun
/**
 * Runs the repo's independent audits concurrently.
 *
 * Each audit is a self-contained read-only pass over the tree, so running them as 20-odd
 * sequential CI steps spent most of its wall clock waiting on single-threaded file walks.
 *
 * The list is derived from the `check:*` scripts in package.json rather than restated here,
 * so a new audit is picked up by default and has to be opted *out* deliberately. The previous
 * hand-maintained list had already drifted: `check:cron-parity` existed, passed, and ran
 * nowhere. Audits that need a git base ref or write files stay excluded and keep their own
 * workflow step.
 */
import path from 'node:path'

/** `check:*` scripts this runner deliberately does not own, and why. */
const EXCLUDED: Record<string, string> = {
  'check:audits': 'this runner',
  'check:migrations': 'needs a git base ref argument',
  'check:api-validation': 'superseded by the :strict variant, which this runner does run',
}

/**
 * Generated-artifact checks that live outside the `check:*` namespace. Listed explicitly
 * because the `*:check` namespace also holds checks that need a sibling repo or network.
 */
const EXTRA_AUDITS = [
  'tool-metadata:check',
  'deployment-config:check',
  'integration-catalog:check',
  'docs:check',
  'agent-stream-docs:check',
] as const

const ROOT = path.resolve(import.meta.dir, '..')

interface AuditResult {
  script: string
  ok: boolean
  durationMs: number
  output: string
}

function auditScripts(scripts: Record<string, string>): string[] {
  const derived = Object.keys(scripts).filter(
    (name) => name.startsWith('check:') && !(name in EXCLUDED)
  )
  return [...derived, ...EXTRA_AUDITS]
}

/**
 * Runs one audit, capturing its output.
 *
 * Spawns the script directly rather than `bun run <name>`, which would start a bun process
 * only to have it read package.json and start a second one.
 */
async function runAudit(script: string, command: string): Promise<AuditResult> {
  const startedAt = performance.now()
  const argv = command.replace(/^bun run /, '').split(/\s+/)
  const proc = Bun.spawn([process.execPath, ...argv], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, FORCE_COLOR: '0' },
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return {
    script,
    ok: exitCode === 0,
    durationMs: performance.now() - startedAt,
    output: `${stdout}${stderr}`.trimEnd(),
  }
}

const manifest = await Bun.file(path.join(ROOT, 'package.json')).json()
const commands = manifest.scripts as Record<string, string>
const queue = auditScripts(commands)
const total = queue.length
// The coordinator only awaits, so it does not need a core reserved for it.
const workers = Math.min(Math.max(2, navigator.hardwareConcurrency), total)
const results: AuditResult[] = []

async function worker(): Promise<void> {
  let script: string | undefined
  while ((script = queue.shift())) {
    const result = await runAudit(script, commands[script])
    results.push(result)
    console.log(`${result.ok ? '✓' : '✗'} ${result.script} (${Math.round(result.durationMs)}ms)`)
  }
}

const startedAt = performance.now()
await Promise.all(Array.from({ length: workers }, worker))
const wallMs = performance.now() - startedAt
const serialMs = results.reduce((sum, result) => sum + result.durationMs, 0)

console.log(
  `\n${total} audits in ${(wallMs / 1000).toFixed(1)}s wall (${(serialMs / 1000).toFixed(1)}s serial, ${workers}-way)`
)

/**
 * Restores what the per-step workflow gave up: collapsible per-audit output and inline
 * failure annotations in the GitHub UI, plus a timing table the separate steps never had.
 */
if (process.env.GITHUB_ACTIONS) {
  const summary = [
    '| Audit | Result | Duration |',
    '| --- | --- | --- |',
    ...[...results]
      .sort((a, b) => b.durationMs - a.durationMs)
      .map((r) => `| \`${r.script}\` | ${r.ok ? '✓' : '✗'} | ${Math.round(r.durationMs)}ms |`),
    '',
    `${total} audits in ${(wallMs / 1000).toFixed(1)}s wall (${(serialMs / 1000).toFixed(1)}s serial, ${workers}-way)`,
  ].join('\n')
  if (process.env.GITHUB_STEP_SUMMARY) {
    await Bun.write(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`)
  }
}

const failures = results.filter((result) => !result.ok)
if (failures.length > 0) {
  for (const failure of failures) {
    if (process.env.GITHUB_ACTIONS) {
      console.error(`::group::✗ ${failure.script}`)
      console.error(failure.output || '(no output)')
      console.error('::endgroup::')
      console.error(`::error title=${failure.script}::audit failed — see the group above`)
    } else {
      console.error(`\n${'─'.repeat(72)}\n✗ ${failure.script}\n${'─'.repeat(72)}`)
      console.error(failure.output || '(no output)')
    }
  }
  process.exit(1)
}
