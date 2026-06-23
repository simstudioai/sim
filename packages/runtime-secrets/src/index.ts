import type { GetSecretValueCommandOutput } from '@aws-sdk/client-secrets-manager'
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'

const logger = createLogger('RuntimeSecrets')

/** Plaintext env var (set in the ECS task definition) naming the secret to ingest. */
const SECRET_ID_ENV = 'SIM_ENV_SECRET_ID'

const MAX_ATTEMPTS = 3

/**
 * Fetches the combined `/{env}/sim/env-vars` secret once at container boot and
 * hydrates `process.env`, so secrets no longer have to be fanned out into the
 * ECS task definition (which is approaching the 64 KB rendered-document limit).
 *
 * Must run before any application module that reads env at import time. No-ops
 * when {@link SECRET_ID_ENV} is unset (local dev / self-hosted keep using their
 * own env). Existing `process.env` keys are never overwritten, so explicit
 * task-definition `environment` entries win. Throws on any fetch/parse failure
 * so a misconfigured container crashes instead of booting without its config.
 */
export async function loadRuntimeSecrets(): Promise<void> {
  const secretId = process.env[SECRET_ID_ENV]
  if (!secretId) {
    logger.info(`${SECRET_ID_ENV} not set; skipping runtime secret ingestion`)
    return
  }

  const client = new SecretsManagerClient(
    process.env.AWS_REGION ? { region: process.env.AWS_REGION } : {}
  )

  const secretString = await fetchSecretString(client, secretId)
  const entries = parseSecretJson(secretString)

  let loaded = 0
  let skipped = 0
  for (const [key, value] of Object.entries(entries)) {
    if (key in process.env) {
      skipped++
      continue
    }
    process.env[key] = typeof value === 'string' ? value : JSON.stringify(value)
    loaded++
  }

  logger.info('Runtime secrets ingested', { secretId, loaded, skipped })
}

async function fetchSecretString(client: SecretsManagerClient, secretId: string): Promise<string> {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response: GetSecretValueCommandOutput = await client.send(
        new GetSecretValueCommand({ SecretId: secretId })
      )
      if (!response.SecretString) {
        throw new Error('Secret has no SecretString (binary secrets are not supported)')
      }
      return response.SecretString
    } catch (error) {
      lastError = error
      if (attempt < MAX_ATTEMPTS) {
        const delay = backoffWithJitter(attempt, null, { baseMs: 200, maxMs: 2000 })
        logger.warn(
          `Failed to fetch runtime secrets (attempt ${attempt}/${MAX_ATTEMPTS}), retrying`,
          { error: getErrorMessage(error) }
        )
        await sleep(delay)
      }
    }
  }
  throw new Error(`Failed to fetch runtime secrets from ${secretId}: ${getErrorMessage(lastError)}`)
}

function parseSecretJson(secretString: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(secretString)
  } catch (error) {
    throw new Error(`Runtime secret is not valid JSON: ${getErrorMessage(error)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Runtime secret must be a JSON object of key/value pairs')
  }
  return parsed as Record<string, unknown>
}
