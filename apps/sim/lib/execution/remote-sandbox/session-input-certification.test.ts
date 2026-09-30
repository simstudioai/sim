/**
 * The persistent workbench's input history is what lets a scratch file reach the model. These
 * run the real code boundary against the real history recorder, so a mount the caller could not
 * classify has to leave the machine uncertified.
 */
import { redisConfigMockFns } from '@sim/testing/mocks/redis-config.mock'
import {
  remoteSandboxProviderMock,
  remoteSandboxProviderMockFns,
} from '@sim/testing/mocks/remote-sandbox-provider.mock'
import { generateShortId } from '@sim/utils/id'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CodeLanguage } from '@/lib/execution/languages'
import type { SandboxHandle, SandboxProvider } from '@/lib/execution/remote-sandbox/types'

const { mockFindSessionSandbox } = vi.hoisted(() => ({ mockFindSessionSandbox: vi.fn() }))

vi.mock('@/lib/execution/remote-sandbox/provider', () => remoteSandboxProviderMock)
vi.mock('@/lib/execution/remote-sandbox/resolve', () => ({
  resolveWorkspaceSandbox: vi.fn().mockResolvedValue(null),
  provisionRuntimeDependencies: vi.fn(),
  repairMissingSandboxImage: vi.fn().mockResolvedValue(null),
  RUNTIME_INSTALL_TIMEOUT_MS: 60_000,
}))
vi.mock('@/lib/core/execution-limits/metrics', () => ({
  recordSandboxTeardownFailure: vi.fn(),
  recordSandboxProviderLimit: vi.fn(),
}))

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

/** Same one-way semantics as the Lua history script. */
const records = new Map<string, string>()
redisConfigMockFns.mockGetRedisClient.mockImplementation(() => ({
  set: async (key: string, value: string) => {
    if (!records.has(key)) records.set(key, value)
    return 'OK'
  },
  get: async (key: string) => records.get(key) ?? null,
  eval: async (_script: string, _count: number, key: string, input: string) => {
    records.set(key, records.get(key) === 'clean' && input === 'clean' ? 'clean' : 'unknown')
    return records.get(key)
  },
}))
remoteSandboxProviderMockFns.mockResolveProvider.mockImplementation(
  (): SandboxProvider => ({
    id: 'e2b',
    dependencyStrategy: 'prebuilt',
    resolveLifetimeMs: (ms: number) => ms,
    create: vi.fn(),
    findSessionSandbox: mockFindSessionSandbox,
  })
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

beforeEach(() => {
  records.clear()
})

describe('workbench certification at the code boundary', () => {
  it.each([
    ['code', false],
    ['code', true],
    ['shell', false],
    ['shell', true],
  ] as const)('%s with unprovenanced mounts %s', async (kind, unprovenanced) => {
    const sandboxId = `machine-${generateShortId(8)}`
    const key = `chat-${generateShortId(8)}`
    const identity = { providerId: 'e2b', sandboxId } as const
    mockFindSessionSandbox.mockResolvedValue(machine(sandboxId))
    await initializeSessionFileProvenance(key, identity)
    const session = { key, ...(unprovenanced ? { unprovenancedInputs: true } : {}) }
    const request = {
      code: 'print(1)',
      language: CodeLanguage.Python,
      timeoutMs: 30_000,
      session,
    }
    await observeSandboxSessionInputs(
      () => true,
      () =>
        kind === 'code'
          ? executeInSandbox(request)
          : executeShellInSandbox({ ...request, envs: {} })
    )
    expect(await isSessionFileProvenanceClean(key, identity)).toBe(!unprovenanced)
  })
})
