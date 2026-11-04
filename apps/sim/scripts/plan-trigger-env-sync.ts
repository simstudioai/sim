#!/usr/bin/env bun

/**
 * Shows what syncing a Trigger.dev environment from the app's env-vars secret
 * would change, by variable name only, before the sync is enabled for it.
 *
 * Reads the app secret, builds the variables the deploy would sync (the same
 * `buildTriggerEnvVars` the `syncEnvVars` extension uses), and compares them
 * with the values the environment holds now, read through the environment's
 * API key exactly as the deploy CLI reads them. Never prints a value.
 *
 * The deploy only sends variables whose value changed, so an unchanged
 * variable stored as plain text stays plain. `--apply-secret-flags` marks
 * those as secrets with their current value, which is otherwise untouched.
 *
 * Usage:
 *   AWS_PROFILE=<profile> bun --no-env-file apps/sim/scripts/plan-trigger-env-sync.ts staging
 *   AWS_PROFILE=<profile> bun --no-env-file apps/sim/scripts/plan-trigger-env-sync.ts preview
 *   AWS_PROFILE=<profile> bun --no-env-file apps/sim/scripts/plan-trigger-env-sync.ts prod --apply-secret-flags
 */

import { createLogger } from '@sim/logger'
import { fetchRuntimeSecrets } from '@sim/runtime-secrets'
import {
  APP_ENV_SECRET_IDS,
  buildTriggerEnvVars,
  diffTriggerEnv,
} from '@sim/runtime-secrets/trigger-env'
import { getErrorMessage } from '@sim/utils/errors'
import { chunkArray } from '@sim/utils/helpers'

const logger = createLogger('PlanTriggerEnvSync')

const TRIGGER_API_URL = 'https://api.trigger.dev'

/** Variables per import call when flipping secret flags. */
const IMPORT_BATCH_SIZE = 50

interface ListedVariable {
  name: string
  isSecret?: boolean
}

async function main() {
  const environment = process.argv[2] ?? ''
  const applySecretFlags = process.argv.includes('--apply-secret-flags')
  const secretId = APP_ENV_SECRET_IDS[environment]
  if (!secretId) {
    throw new Error(
      `Usage: plan-trigger-env-sync.ts <${Object.keys(APP_ENV_SECRET_IDS).join('|')}> [--apply-secret-flags]`
    )
  }

  const appEnv = await fetchRuntimeSecrets(secretId)
  const { TRIGGER_PROJECT_ID: project, TRIGGER_SECRET_KEY: apiKey } = appEnv
  if (!project || !apiKey) {
    throw new Error(`${secretId} has no TRIGGER_PROJECT_ID/TRIGGER_SECRET_KEY`)
  }
  const branch = environment === 'preview' ? appEnv.TRIGGER_PREVIEW_BRANCH : undefined
  if (environment === 'preview' && !branch) {
    throw new Error(`${secretId} has no TRIGGER_PREVIEW_BRANCH`)
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    ...(branch ? { 'x-trigger-branch': branch } : {}),
  }
  const envvarsUrl = `${TRIGGER_API_URL}/api/v1/projects/${project}/envvars`
  async function request<T>(url: string, body?: unknown): Promise<T> {
    const response = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`${url} failed with ${response.status}`)
    return (await response.json()) as T
  }
  async function listPlainNames(): Promise<Set<string>> {
    const listed = await request<ListedVariable[] | { data: ListedVariable[] }>(
      `${envvarsUrl}/${environment}`
    )
    const variables = Array.isArray(listed) ? listed : listed.data
    return new Set(variables.filter((v) => !v.isSecret).map((v) => v.name))
  }

  const [{ variables: current }, plainNames] = await Promise.all([
    request<{ variables: Record<string, string> }>(envvarsUrl),
    listPlainNames(),
  ])

  const synced = buildTriggerEnvVars(appEnv)
  const syncedNames = new Set(synced.map((v) => v.name))
  const { added, changed } = diffTriggerEnv(synced, current)
  const toFlag = synced.filter(
    (v) => v.isSecret && plainNames.has(v.name) && current[v.name] === v.value
  )
  const names = (vars: { name: string }[]) => vars.map((v) => v.name).sort()

  logger.info('Trigger.dev env sync plan', {
    environment,
    branch,
    secretId,
    synced: synced.length,
    unchanged: synced.length - added.length - changed.length,
    added: names(added),
    changed: names(changed),
    plainToSecretOnSync: names(changed.filter((v) => v.isSecret && plainNames.has(v.name))),
    plainUnchangedNeedingSecretFlag: names(toFlag),
    appKeysNotSynced: Object.keys(appEnv)
      .filter((name) => !syncedNames.has(name))
      .sort(),
  })

  if (!applySecretFlags || toFlag.length === 0) return
  // The import resubmits each value, so re-read right before each batch and skip any variable
  // rotated since the plan: flagging must never write back an older value.
  const skipped: string[] = []
  for (const batch of chunkArray(toFlag, IMPORT_BATCH_SIZE)) {
    const { variables: latest } = await request<{ variables: Record<string, string> }>(envvarsUrl)
    const unrotated = batch.filter((v) => latest[v.name] === v.value)
    skipped.push(...batch.filter((v) => latest[v.name] !== v.value).map((v) => v.name))
    if (unrotated.length === 0) continue
    await request(`${envvarsUrl}/${environment}/import`, {
      variables: Object.fromEntries(unrotated.map((v) => [v.name, v.value])),
      override: true,
      isSecret: true,
    })
  }
  const stillPlain = await listPlainNames()
  const unflagged = names(toFlag.filter((v) => stillPlain.has(v.name) && !skipped.includes(v.name)))
  if (unflagged.length > 0) throw new Error(`Still plain after flagging: ${unflagged.join(', ')}`)
  logger.info('Marked unchanged variables as secrets', {
    environment,
    flagged: toFlag.length - skipped.length,
    skippedAsRotated: skipped.sort(),
  })
}

main().catch((error) => {
  logger.error('Trigger.dev env sync plan failed', { error: getErrorMessage(error) })
  process.exit(1)
})
