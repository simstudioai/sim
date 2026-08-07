#!/usr/bin/env bun
/**
 * Runs the independent repo audits concurrently.
 *
 * Each audit is a self-contained read-only pass over the tree, so running them as 20-odd
 * sequential CI steps spent most of its wall clock waiting on single-threaded file walks.
 * Only audits that need no extra arguments, working directory, or git base ref belong here —
 * the ones that diff against a base ref (block registry, migration safety) or write files
 * (drizzle generate) stay as their own steps.
 *
 * Output is buffered per audit and replayed only for failures, so a green run stays quiet
 * and a red one still shows exactly which audit failed and why.
 */
const AUDITS = [
  'check:boundaries',
  'check:api-validation:strict',
  'check:desktop-bridge',
  'check:desktop-ipc',
  'check:utils',
  'check:zustand-v5',
  'check:react-query',
  'check:client-boundary',
  'check:bare-icons',
  'check:icon-paths',
  'check:realtime-prune',
  'check:tool-registry-boundary',
  'check:tool-request-boundary',
  'check:trigger-block-cycle',
  'check:import-specifiers',
  'check:sql-date-binding',
  'check:native-typecheck',
  'tool-metadata:check',
  'integration-catalog:check',
  'skills:check',
  'agent-stream-docs:check',
] as const

interface AuditResult {
  script: string
  ok: boolean
  durationMs: number
  output: string
}

const CONCURRENCY = Math.max(2, navigator.hardwareConcurrency - 1)

async function runAudit(script: string): Promise<AuditResult> {
  const startedAt = performance.now()
  const proc = Bun.spawn(['bun', 'run', script], {
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

const queue = [...AUDITS]
const results: AuditResult[] = []

async function worker(): Promise<void> {
  for (let script = queue.shift(); script; script = queue.shift()) {
    const result = await runAudit(script)
    results.push(result)
    console.log(`${result.ok ? '✓' : '✗'} ${result.script} (${Math.round(result.durationMs)}ms)`)
  }
}

const startedAt = performance.now()
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, AUDITS.length) }, worker))
const wallMs = performance.now() - startedAt

const failures = results.filter((result) => !result.ok)
const serialMs = results.reduce((total, result) => total + result.durationMs, 0)

console.log(
  `\n${results.length} audits in ${(wallMs / 1000).toFixed(1)}s wall (${(serialMs / 1000).toFixed(1)}s serial, ${CONCURRENCY}-way)`
)

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`\n${'─'.repeat(72)}\n✗ ${failure.script}\n${'─'.repeat(72)}`)
    console.error(failure.output || '(no output)')
  }
  console.error(`\n${failures.length} audit(s) failed: ${failures.map((f) => f.script).join(', ')}`)
  process.exit(1)
}
