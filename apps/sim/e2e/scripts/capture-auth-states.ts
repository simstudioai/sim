import { chmodSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { chromium, expect } from '@playwright/test'
import { sleep } from '@sim/utils/helpers'
import {
  readPersonaCredentials,
  readScenarioManifest,
  resolveStorageStatePath,
  scenarioManifestSchema,
  writeJsonAtomic,
} from '../fixtures/e2e-world'
import { captureSafeAuthFailureScreenshot } from '../support/auth-capture-diagnostics'
import { installBrowserNetworkGuard } from '../support/browser-network'

const baseUrl = requiredEnv('E2E_BASE_URL')
const manifestPath = requiredEnv('E2E_MANIFEST_PATH')
const credentialsPath = requiredEnv('E2E_CREDENTIALS_PATH')
const storageStateDirectory = requiredEnv('E2E_STORAGE_STATE_DIR')
const screenshotsDirectory = requiredEnv('E2E_AUTH_SCREENSHOT_DIR')
const UI_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const

async function main(): Promise<void> {
  const manifest = readScenarioManifest(manifestPath)
  const credentials = readPersonaCredentials(credentialsPath)
  if (manifest.runId !== credentials.runId || manifest.runId !== requiredEnv('E2E_RUN_ID')) {
    throw new Error('Persona auth inputs belong to different E2E runs')
  }
  mkdirSync(storageStateDirectory, { recursive: true })
  mkdirSync(screenshotsDirectory, { recursive: true })

  const browser = await chromium.launch({
    args: ['--host-resolver-rules=MAP e2e.sim.ai 127.0.0.1'],
  })
  try {
    for (const [personaKey, persona] of Object.entries(manifest.personas)) {
      const login = credentials.personas[personaKey]
      if (!login) throw new Error(`Missing private login for persona: ${personaKey}`)
      const context = await browser.newContext({ baseURL: baseUrl })
      const networkGuard = await installBrowserNetworkGuard(context)
      const page = await context.newPage()
      const failures: unknown[] = []
      try {
        await page.goto('/login')
        await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
        await page.getByLabel('Email').fill(login.email)
        await page.getByRole('textbox', { name: 'Password' }).fill(login.password)
        await signInThroughUi(page, personaKey)

        const sessionResponse = await context.request.get('/api/auth/get-session')
        if (!sessionResponse.ok()) {
          throw new Error(`Session probe failed for ${personaKey}: ${sessionResponse.status()}`)
        }
        const session = (await sessionResponse.json()) as {
          user?: { id?: string; email?: string }
          session?: { activeOrganizationId?: string | null }
        }
        if (session.user?.id !== persona.userId || session.user.email !== persona.email) {
          throw new Error(`Session identity mismatch for persona: ${personaKey}`)
        }
        if (
          (session.session?.activeOrganizationId ?? null) !== persona.expectedActiveOrganizationId
        ) {
          throw new Error(`Active organization mismatch for persona: ${personaKey}`)
        }
        // Deliberately duplicated by persona contracts: capture must reject lazy workspace creation
        // before persisting auth, while the later contract independently verifies the saved session.
        const workspaceResponse = await context.request.get('/api/workspaces?scope=all')
        if (!workspaceResponse.ok()) {
          throw new Error(
            `Workspace inventory failed for ${personaKey}: ${workspaceResponse.status()}`
          )
        }
        const workspacePayload = (await workspaceResponse.json()) as {
          workspaces?: Array<{ id?: string }>
        }
        const actualWorkspaceIds = (workspacePayload.workspaces ?? [])
          .map(({ id }) => id)
          .filter((id): id is string => Boolean(id))
          .sort()
        const expectedWorkspaceIds = persona.workspaces
          .filter(({ access }) => access !== 'none')
          .map(({ workspaceId }) => workspaceId)
          .sort()
        if (JSON.stringify(actualWorkspaceIds) !== JSON.stringify(expectedWorkspaceIds)) {
          throw new Error(`Workspace inventory mismatch for persona: ${personaKey}`)
        }

        await page.goto(persona.canonicalRoute)
        await expect(page).toHaveURL(new URL(persona.canonicalRoute, baseUrl).toString())
        await expect(page.getByRole('heading', { name: 'General', level: 1 })).toBeVisible()
        const storageStatePath = resolveStorageStatePath(
          storageStateDirectory,
          persona.storageStatePath
        )
        await context.storageState({ path: storageStatePath })
        chmodSync(storageStatePath, 0o600)
        if ((statSync(storageStatePath).mode & 0o777) !== 0o600) {
          throw new Error(`Storage state permissions are not private for persona: ${personaKey}`)
        }
      } catch (error) {
        await captureSafeAuthFailureScreenshot(
          page,
          path.join(screenshotsDirectory, `${personaKey}.failure.png`),
          login.password
        )
        failures.push(error)
      }
      try {
        await context.close()
      } catch (error) {
        failures.push(error)
      }
      try {
        networkGuard.assertNoUnexpectedRequests()
      } catch (error) {
        failures.push(error)
      }
      if (failures.length === 1) throw failures[0]
      if (failures.length > 1) {
        throw new AggregateError(failures, `Auth capture failed for persona: ${personaKey}`)
      }
    }

    manifest.authCaptureComplete = true
    writeJsonAtomic(manifestPath, scenarioManifestSchema.parse(manifest))
  } finally {
    await browser.close()
  }
}

function requiredEnv(key: string): string {
  const value = process.env[key]
  if (!value) throw new Error(`Missing auth capture environment value: ${key}`)
  return value
}

async function signInThroughUi(
  page: import('@playwright/test').Page,
  personaKey: string
): Promise<void> {
  for (let attempt = 0; attempt <= UI_RETRY_DELAYS_MS.length; attempt += 1) {
    const [response] = await Promise.all([
      page.waitForResponse((candidate) => {
        const url = new URL(candidate.url())
        return url.pathname === '/api/auth/sign-in/email'
      }),
      page.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ])
    if (response.status() === 200) {
      try {
        await page.waitForURL(/\/workspace(?:\/|$)/, { timeout: 30_000 })
      } catch {
        throw new Error(`UI sign-in did not redirect for persona: ${personaKey}`)
      }
      return
    }
    if (response.status() !== 429 || attempt === UI_RETRY_DELAYS_MS.length) {
      throw new Error(
        `UI sign-in failed for persona ${personaKey} with status ${response.status()}; response body redacted`
      )
    }
    await sleep(UI_RETRY_DELAYS_MS[attempt])
  }
}

main().catch((error) => {
  const raw = error instanceof Error ? (error.stack ?? error.message) : String(error)
  let redacted = raw
  try {
    const credentials = readPersonaCredentials(credentialsPath)
    for (const { password } of Object.values(credentials.personas)) {
      redacted = redacted.replaceAll(password, '[REDACTED]')
    }
  } catch {
    redacted = 'Auth capture failed; credentials unavailable for safe diagnostic formatting'
  }
  console.error(redacted)
  process.exitCode = 1
})
