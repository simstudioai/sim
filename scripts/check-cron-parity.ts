/**
 * Fails when the Docker Compose scheduler and the Helm CronJobs disagree.
 *
 * Both deployments must run the same background jobs on the same schedules, or
 * a feature silently works on one and not the other — the exact class of drift
 * that left Compose without a scheduler for as long as it did.
 *
 * Sources of truth:
 *   docker/crontab            — one line per job for Docker Compose
 *   helm/sim/values.yaml      — cronjobs.jobs.<name>.{path,schedule} for Kubernetes
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

interface Job {
  path: string
  schedule: string
}

/** Parses `*​/5 * * * * curl ... "$SIM_URL/api/foo"` into its schedule and path. */
function parseCrontab(contents: string): Map<string, string> {
  const jobs = new Map<string, string>()
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || !line.includes('curl')) continue
    const schedule = line.split(/\s+/).slice(0, 5).join(' ')
    const pathMatch = line.match(/\$SIM_URL(\/api\/[^"']+)/)
    if (!pathMatch) {
      throw new Error(`docker/crontab line has no $SIM_URL/api/... target:\n  ${line}`)
    }
    jobs.set(pathMatch[1], schedule)
  }
  return jobs
}

function parseHelmJobs(contents: string): Map<string, string> {
  const values = parse(contents) as { cronjobs?: { jobs?: Record<string, Job> } }
  const jobs = new Map<string, string>()
  for (const job of Object.values(values.cronjobs?.jobs ?? {})) {
    jobs.set(job.path, job.schedule)
  }
  return jobs
}

const crontab = parseCrontab(readFileSync(join(repoRoot, 'docker/crontab'), 'utf8'))
const helm = parseHelmJobs(readFileSync(join(repoRoot, 'helm/sim/values.yaml'), 'utf8'))

const errors: string[] = []

for (const [path, schedule] of helm) {
  if (!crontab.has(path)) {
    errors.push(`${path} is a Helm CronJob but is missing from docker/crontab`)
  } else if (crontab.get(path) !== schedule) {
    errors.push(`${path} schedule differs — helm: "${schedule}", crontab: "${crontab.get(path)}"`)
  }
}

for (const path of crontab.keys()) {
  if (!helm.has(path)) {
    errors.push(`${path} is in docker/crontab but has no matching Helm CronJob`)
  }
}

if (errors.length > 0) {
  console.error('Scheduler parity check failed:\n')
  for (const error of errors) console.error(`  - ${error}`)
  console.error(
    '\nKeep docker/crontab and helm/sim/values.yaml cronjobs.jobs in sync so both deployments run the same jobs.'
  )
  process.exit(1)
}

console.log(`Scheduler parity OK — ${helm.size} jobs match across Docker Compose and Helm.`)
