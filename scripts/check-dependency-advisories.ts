#!/usr/bin/env bun
/**
 * Requires the live advisory set to exactly match the reviewed baseline.
 *
 * Any newly introduced advisory fails immediately. Resolved advisories must
 * also be removed from the baseline so a later regression cannot pass on a
 * stale exception.
 */
import { join } from 'node:path'

interface DependencyPolicy {
  allowedSecurityAdvisories: string[]
}

interface AuditAdvisory {
  severity?: string
  title?: string
  url?: string
}

const ROOT = process.cwd()
const policy = (await Bun.file(join(ROOT, 'dependency-policy.json')).json()) as DependencyPolicy
const allowed = new Set(
  policy.allowedSecurityAdvisories.map((advisoryId) => advisoryId.toUpperCase())
)
const audit = Bun.spawn(['bun', 'audit', '--json'], {
  cwd: ROOT,
  stdout: 'pipe',
  stderr: 'pipe',
})
const [stdout, stderr] = await Promise.all([
  new Response(audit.stdout).text(),
  new Response(audit.stderr).text(),
  audit.exited,
])

let report: Record<string, AuditAdvisory[]>
try {
  report = JSON.parse(stdout) as Record<string, AuditAdvisory[]>
} catch {
  console.error('Dependency security audit did not return valid JSON.')
  if (stderr.trim()) console.error(stderr.trim())
  process.exit(1)
}

const findings = new Map<string, { severity: string; title: string; packages: Set<string> }>()
for (const [packageName, advisories] of Object.entries(report)) {
  for (const advisory of advisories) {
    const severity = advisory.severity?.toLowerCase()
    if (!severity) continue

    const advisoryId = advisory.url?.match(/GHSA-[\w-]+$/i)?.[0]?.toUpperCase()
    if (!advisoryId) {
      console.error(`Dependency security audit returned an unidentified ${severity} advisory.`)
      process.exit(1)
    }

    const finding = findings.get(advisoryId) ?? {
      severity,
      title: advisory.title ?? 'Untitled advisory',
      packages: new Set<string>(),
    }
    finding.packages.add(packageName)
    findings.set(advisoryId, finding)
  }
}

const unreviewed = [...findings].filter(([advisoryId]) => !allowed.has(advisoryId))
const stale = [...allowed].filter((advisoryId) => !findings.has(advisoryId))
if (unreviewed.length > 0 || stale.length > 0) {
  if (unreviewed.length > 0) {
    console.error(`Dependency security audit found ${unreviewed.length} unreviewed issue(s):`)
  }
  for (const [advisoryId, finding] of unreviewed) {
    console.error(
      `- ${advisoryId} (${finding.severity}): ${finding.title} [${[...finding.packages].sort().join(', ')}]`
    )
  }
  if (stale.length > 0) {
    console.error(
      `Dependency security baseline contains ${stale.length} resolved or stale issue(s): ${stale.sort().join(', ')}`
    )
  }
  process.exit(1)
}

console.log(
  `Dependency security audit passed: ${findings.size} advisories exactly match the reviewed baseline.`
)
