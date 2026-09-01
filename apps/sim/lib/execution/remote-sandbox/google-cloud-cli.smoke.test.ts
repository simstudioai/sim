/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  sandboxCliEnvironment,
  sandboxCliToolRecipes,
} from '@/lib/execution/remote-sandbox/cli-tools.server'
import { e2bProvider } from '@/lib/execution/remote-sandbox/e2b'
import type { SandboxHandle } from '@/lib/execution/remote-sandbox/types'

const CLI_TOOL_ID = 'google-cloud-cli@577.0.0-r1'
const CREDENTIAL_PATH = '/tmp/sim-google-cloud-cli-smoke.json'
const SMOKE_TEST_TIMEOUT_MS = 20 * 60_000
const INSTALL_TIMEOUT_MS = 15 * 60_000
const QUERY_TIMEOUT_MS = 2 * 60_000
const smokeEnabled = process.env.E2B_GOOGLE_CLOUD_CLI_SMOKE === '1'

interface GoogleServiceAccountCredentials {
  project_id?: string
}

function readSmokeCredentials(): {
  json: string
  projectId: string
} {
  const json = process.env.GOOGLE_CLOUD_CLI_SMOKE_SERVICE_ACCOUNT_JSON
  if (!json) {
    throw new Error(
      'GOOGLE_CLOUD_CLI_SMOKE_SERVICE_ACCOUNT_JSON is required when E2B_GOOGLE_CLOUD_CLI_SMOKE=1'
    )
  }

  let credentials: GoogleServiceAccountCredentials
  try {
    credentials = JSON.parse(json) as GoogleServiceAccountCredentials
  } catch {
    throw new Error('GOOGLE_CLOUD_CLI_SMOKE_SERVICE_ACCOUNT_JSON must contain valid JSON')
  }

  const projectId = process.env.GOOGLE_CLOUD_CLI_SMOKE_PROJECT_ID ?? credentials.project_id
  if (!projectId) {
    throw new Error(
      'The smoke service account must contain project_id or GOOGLE_CLOUD_CLI_SMOKE_PROJECT_ID must be set'
    )
  }

  if (!process.env.E2B_API_KEY) {
    throw new Error('E2B_API_KEY is required when E2B_GOOGLE_CLOUD_CLI_SMOKE=1')
  }
  if (!process.env.E2B_FUNCTION_TEMPLATE_ID) {
    throw new Error('E2B_FUNCTION_TEMPLATE_ID is required when E2B_GOOGLE_CLOUD_CLI_SMOKE=1')
  }

  return { json, projectId }
}

describe.skipIf(!smokeEnabled)('Google Cloud CLI E2B credential smoke', () => {
  let sandbox: SandboxHandle | undefined

  afterEach(async () => {
    await sandbox?.kill()
    sandbox = undefined
  })

  it(
    'installs the pinned catalog recipe and runs bq SELECT 1 with runtime credentials',
    async () => {
      const credentials = readSmokeCredentials()
      const [recipe] = sandboxCliToolRecipes([CLI_TOOL_ID])
      const cliEnvironment = sandboxCliEnvironment([CLI_TOOL_ID])

      sandbox = await e2bProvider.create('shell', { lifetimeMs: SMOKE_TEST_TIMEOUT_MS })

      const install = await sandbox.runCommand(recipe.installCommand, {
        timeoutMs: INSTALL_TIMEOUT_MS,
        rootUser: true,
      })
      expect(install.exitCode).toBe(0)

      await sandbox.writeFile(CREDENTIAL_PATH, credentials.json)
      const query = await sandbox.runCommand(
        `bq query --project_id="$GOOGLE_CLOUD_PROJECT" --use_legacy_sql=false --format=json 'SELECT 1 AS value'`,
        {
          timeoutMs: QUERY_TIMEOUT_MS,
          rootUser: true,
          envs: {
            ...cliEnvironment,
            CLOUDSDK_CORE_PROJECT: credentials.projectId,
            GOOGLE_APPLICATION_CREDENTIALS: CREDENTIAL_PATH,
            GOOGLE_CLOUD_PROJECT: credentials.projectId,
          },
        }
      )

      expect(query.exitCode).toBe(0)
      expect(JSON.parse(query.stdout)).toEqual([expect.objectContaining({ value: '1' })])
    },
    SMOKE_TEST_TIMEOUT_MS
  )
})
