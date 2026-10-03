/**
 * The persistent workbench's input history is what lets a scratch file reach the model. This runs
 * the real code boundary against the real history script in a disposable Redis, so a mount the
 * caller could not classify has to leave the machine uncertified. Only the sandbox provider is a
 * stand-in: it hands back an existing machine that executes nothing.
 *
 * Set TEST_REDIS_URL to an isolated local Redis service.
 */
import { createHash } from 'node:crypto'
import {
  remoteSandboxProviderMock,
  remoteSandboxProviderMockFns,
} from '@sim/testing/mocks/remote-sandbox-provider.mock'
import { generateShortId } from '@sim/utils/id'
import { afterAll, describe, expect, it, vi } from 'vitest'

const { redisUrl, inheritedRedisUrl, mockFindSessionSandbox } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const url = readTestRedisUrl()
  const inheritedRedisUrl = process.env.REDIS_URL
  /** The real Redis module reads this at import. */
  if (url) process.env.REDIS_URL = url
  return { redisUrl: url, inheritedRedisUrl, mockFindSessionSandbox: vi.fn() }
})

vi.mock('@/lib/execution/remote-sandbox/provider', () => remoteSandboxProviderMock)
vi.mock('@/lib/execution/remote-sandbox/resolve', () => ({
  resolveWorkspaceSandbox: async () => null,
  provisionRuntimeDependencies: async () => {},
  repairMissingSandboxImage: async () => null,
  RUNTIME_INSTALL_TIMEOUT_MS: 60_000,
}))

import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'
import { CodeLanguage } from '@/lib/execution/languages'
import {
  executeInSandbox,
  executeShellInSandbox,
  SIM_RESULT_PREFIX,
} from '@/lib/execution/remote-sandbox'
import { observeSandboxSessionInputs } from '@/lib/execution/remote-sandbox/execution-observer'
import {
  initializeSessionFileProvenance,
  isSessionFileProvenanceClean,
} from '@/lib/execution/remote-sandbox/session-file-provenance'
import type { SandboxHandle, SandboxProvider } from '@/lib/execution/remote-sandbox/types'

remoteSandboxProviderMockFns.mockResolveProvider.mockImplementation(
  () =>
    ({
      id: 'e2b',
      dependencyStrategy: 'prebuilt',
      resolveLifetimeMs: (ms: number) => ms,
      create: async () => {
        throw new Error('The certification fixture only reuses an existing machine')
      },
      findSessionSandbox: mockFindSessionSandbox,
    }) satisfies SandboxProvider
)

function machine(sandboxId: string): SandboxHandle {
  return {
    sandboxId,
    runCode: async () => ({ text: `${SIM_RESULT_PREFIX}{"ok":true}`, stdout: '', stderr: '' }),
    runCommand: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    extendLifetime: async () => {},
    getFileSize: async () => 0,
    readFile: async () => '',
    readFileWithLimit: async () => ({ content: '', byteLength: 0 }),
    writeFile: async () => {},
    removeFile: async () => {},
    listFiles: async () => [],
    kill: async () => {},
  }
}

/** Machine-history keys this suite created, so cleanup never touches another suite's state. */
const createdKeys: string[] = []

afterAll(async () => {
  if (redisUrl && createdKeys.length) {
    const redis = getRedisClient()
    if (redis) await redis.del(...createdKeys)
  }
  if (redisUrl) await closeRedisConnection()
  // Only restore what the hoisted setup changed; assigning undefined would store the string "undefined".
  if (!redisUrl) return
  if (inheritedRedisUrl === undefined) Reflect.deleteProperty(process.env, 'REDIS_URL')
  else process.env.REDIS_URL = inheritedRedisUrl
})

describe.skipIf(!redisUrl)('workbench certification at the code boundary', () => {
  it.each([
    ['code', false],
    ['code', true],
    ['shell', false],
    ['shell', true],
  ] as const)('%s with unprovenanced mounts %s', async (kind, unprovenanced) => {
    const sandboxId = `machine-${generateShortId(12)}`
    const key = `certification-${generateShortId(12)}`
    const identity = { providerId: 'e2b', sandboxId } as const
    createdKeys.push(
      `mothership:workbench-provenance:v2:${createHash('sha256')
        .update(JSON.stringify([key, identity.providerId, sandboxId]))
        .digest('hex')}`
    )
    mockFindSessionSandbox.mockResolvedValue(machine(sandboxId))
    await initializeSessionFileProvenance(key, identity)
    expect(await isSessionFileProvenanceClean(key, identity)).toBe(true)

    const request = {
      code: 'print(1)',
      language: CodeLanguage.Python,
      timeoutMs: 30_000,
      session: { key, ...(unprovenanced ? { unprovenancedInputs: true } : {}) },
    }
    const execution = observeSandboxSessionInputs(
      () => true,
      () =>
        kind === 'code'
          ? executeInSandbox(request)
          : executeShellInSandbox({ ...request, envs: {} })
    )
    if (unprovenanced) await expect(execution).rejects.toThrow('Workbench output withheld')
    else await expect(execution).resolves.toMatchObject({ sandboxId })
    expect(await isSessionFileProvenanceClean(key, identity)).toBe(!unprovenanced)
  })
})
