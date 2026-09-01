/**
 * @vitest-environment node
 */
import { afterEach, describe, it } from 'vitest'
import { SANDBOX_SELECTABLE_CLI_TOOL_IDS } from '@/lib/execution/remote-sandbox/cli-tools'
import {
  sandboxCliEnvironment,
  sandboxCliToolRecipes,
} from '@/lib/execution/remote-sandbox/cli-tools.server'
import { e2bProvider } from '@/lib/execution/remote-sandbox/e2b'
import type { SandboxCommandResult, SandboxHandle } from '@/lib/execution/remote-sandbox/types'

const SMOKE_TEST_TIMEOUT_MS = 20 * 60_000
const INSTALL_TIMEOUT_MS = 15 * 60_000
const VERIFY_TIMEOUT_MS = 2 * 60_000
const smokeEnabled = process.env.E2B_MANAGED_CLI_SMOKE === '1'

function assertSucceeded(
  id: string,
  phase: 'installation' | 'cleanup' | 'verification',
  result: SandboxCommandResult
): void {
  if (result.exitCode === 0) return
  const output = result.stderr || result.stdout || `exit code ${result.exitCode}`
  throw new Error(`${id} ${phase} failed:\n${output}`)
}

describe.skipIf(!smokeEnabled)('managed CLI E2B smoke', () => {
  let sandbox: SandboxHandle | undefined

  afterEach(async () => {
    await sandbox?.kill()
    sandbox = undefined
  })

  it.each(SANDBOX_SELECTABLE_CLI_TOOL_IDS)(
    '%s installs and resolves every advertised executable',
    async (id) => {
      if (!process.env.E2B_API_KEY) {
        throw new Error('E2B_API_KEY is required when E2B_MANAGED_CLI_SMOKE=1')
      }
      if (!process.env.E2B_FUNCTION_TEMPLATE_ID) {
        throw new Error('E2B_FUNCTION_TEMPLATE_ID is required when E2B_MANAGED_CLI_SMOKE=1')
      }

      const [recipe] = sandboxCliToolRecipes([id])
      sandbox = await e2bProvider.create('shell', { lifetimeMs: SMOKE_TEST_TIMEOUT_MS })

      const install = await sandbox.runCommand(recipe.installCommand, {
        timeoutMs: INSTALL_TIMEOUT_MS,
        rootUser: true,
      })
      assertSucceeded(id, 'installation', install)

      const cleanup = await sandbox.runCommand(recipe.cleanupCommand, {
        timeoutMs: VERIFY_TIMEOUT_MS,
        rootUser: true,
      })
      assertSucceeded(id, 'cleanup', cleanup)

      const verification = await sandbox.runCommand(recipe.verificationCommands.join(' && '), {
        timeoutMs: VERIFY_TIMEOUT_MS,
        rootUser: true,
        envs: sandboxCliEnvironment([id]),
      })
      assertSucceeded(id, 'verification', verification)
    },
    SMOKE_TEST_TIMEOUT_MS
  )
})
