/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockWithPiSandbox,
  mockCreateCapability,
  mockRevokeCapability,
  mockReadManifest,
  mockReadBounded,
  mockOpenPr,
  mockProviderEnvVar,
  mockBuildPrompt,
} = vi.hoisted(() => ({
  mockWithPiSandbox: vi.fn(),
  mockCreateCapability: vi.fn(),
  mockRevokeCapability: vi.fn(),
  mockReadManifest: vi.fn(),
  mockReadBounded: vi.fn(),
  mockOpenPr: vi.fn(),
  mockProviderEnvVar: vi.fn(),
  mockBuildPrompt: vi.fn(),
}))

vi.mock('@/lib/execution/remote-sandbox', () => ({ withPiSandbox: mockWithPiSandbox }))
vi.mock('@/lib/pi/exa-search/capabilities', () => ({
  createPiSearchCapability: mockCreateCapability,
  revokePiSearchCapability: mockRevokeCapability,
}))
vi.mock('@/executor/handlers/pi/cloud-search-manifest', async () => ({
  BUILD_SEARCH_MANIFEST_SCRIPT: 'BUILD_MANIFEST',
  readSearchManifest: mockReadManifest,
  readBoundedSandboxFile: mockReadBounded,
}))
vi.mock('@/executor/handlers/pi/cloud-backend', () => ({
  defaultTitle: () => 'Pi: research',
  openPullRequest: mockOpenPr,
}))
vi.mock('@/executor/handlers/pi/context', () => ({ buildPiPrompt: mockBuildPrompt }))
vi.mock('@/executor/handlers/pi/keys', () => ({
  providerApiKeyEnvVar: mockProviderEnvVar,
  mapThinkingLevel: () => 'medium',
}))

import type { PiCloudRunParams } from '@/executor/handlers/pi/backend'
import { runCloudPiSearch } from '@/executor/handlers/pi/cloud-search-backend'

function params(): PiCloudRunParams {
  return {
    mode: 'cloud',
    model: 'claude',
    piModel: 'claude',
    providerId: 'anthropic',
    apiKey: 'sk-model-secret',
    isBYOK: true,
    task: 'research',
    skills: [],
    initialMessages: [],
    owner: 'octo',
    repo: 'demo',
    githubToken: 'ghp_github_secret',
    branchName: 'feature-search',
    draft: true,
    search: {
      enabled: true,
      workspaceId: 'workspace-1',
      executionId: 'execution-1',
      brokerBaseUrl: 'https://sim.example.com',
      exaApiKey: 'exa-workspace-secret',
      exaKeyId: 'exa-key-id',
    },
  }
}

describe('runCloudPiSearch', () => {
  const workerRun = vi.fn()
  const workerWrite = vi.fn()
  const finalizerRun = vi.fn()
  const finalizerWrite = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockProviderEnvVar.mockReturnValue('ANTHROPIC_API_KEY')
    mockBuildPrompt.mockReturnValue('PROMPT')
    mockCreateCapability.mockResolvedValue({
      id: 'capability-id',
      token: 'capability-token',
      expiresAt: new Date(Date.now() + 60_000),
      extensionFingerprints: [{ length: 17, digest: 'digest' }],
    })
    mockRevokeCapability.mockResolvedValue(undefined)
    mockReadManifest.mockResolvedValue({
      baseSha: 'a'.repeat(40),
      writes: [
        {
          path: 'src/index.ts',
          mode: '100644',
          contentBase64: Buffer.from('export {}').toString('base64'),
          sha256: 'b'.repeat(64),
        },
      ],
      deletes: [],
    })
    mockReadBounded.mockResolvedValue('diff')
    mockOpenPr.mockResolvedValue('https://github.com/octo/demo/pull/1')

    workerRun.mockImplementation(
      (command: string, options: { onStdout?: (chunk: string) => void }) => {
        if (command.includes('clone --no-checkout')) {
          return Promise.resolve({
            stdout: `__BASE_SHA__=${'a'.repeat(40)}\n__BASE_REF__=main`,
            stderr: '',
            exitCode: 0,
          })
        }
        if (command.includes('pi -p')) {
          options.onStdout?.(
            '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"done"}}\n'
          )
        }
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
      }
    )
    finalizerRun.mockImplementation((command: string) => {
      if (command.includes('commit-tree')) {
        return Promise.resolve({
          stdout: `__CHANGED__=src/index.ts\n__COMMIT_SHA__=${'c'.repeat(40)}`,
          stderr: '',
          exitCode: 0,
        })
      }
      if (command.includes('git check-ref-format') && command.includes('push')) {
        return Promise.resolve({ stdout: '__PUSHED__=1', stderr: '', exitCode: 0 })
      }
      return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
    })

    let sandboxIndex = 0
    mockWithPiSandbox.mockImplementation(
      async (callback: (runner: unknown) => Promise<unknown>) => {
        sandboxIndex += 1
        return callback(
          sandboxIndex === 1
            ? { run: workerRun, writeFile: workerWrite, readFile: vi.fn() }
            : {
                run: finalizerRun,
                writeFile: finalizerWrite,
                readFile: vi.fn().mockResolvedValue('diff'),
              }
        )
      }
    )
  })

  it('keeps GitHub and Exa keys out of the model command and uses a fresh finalizer', async () => {
    const result = await runCloudPiSearch(params(), { onEvent: vi.fn() })

    expect(mockWithPiSandbox).toHaveBeenCalledTimes(2)
    const piCall = workerRun.mock.calls.find(([command]) => command.includes('pi -p'))
    expect(piCall).toBeDefined()
    expect(piCall[1].envs.ANTHROPIC_API_KEY).toBe('sk-model-secret')
    expect(piCall[1].envs.GITHUB_TOKEN).toBeUndefined()
    expect(piCall[1].envs.EXA_API_KEY).toBeUndefined()
    expect(piCall[1].envs.PI_SEARCH_CAPABILITY).toBe('capability-token')

    const finalizerClone = finalizerRun.mock.calls.find(([command]) =>
      command.includes('clone --no-checkout')
    )
    const finalizerPush = finalizerRun.mock.calls.find(([command]) => command.includes('push'))
    expect(finalizerClone[1].envs.GITHUB_TOKEN).toBe('ghp_github_secret')
    expect(finalizerPush[1].envs.GITHUB_TOKEN).toBe('ghp_github_secret')
    expect(finalizerPush[1].envs.ANTHROPIC_API_KEY).toBeUndefined()
    expect(result.prUrl).toBe('https://github.com/octo/demo/pull/1')
    expect(mockRevokeCapability).toHaveBeenCalledWith('capability-id')
  })

  it('rejects decoded changed-file content containing a protected secret', async () => {
    mockReadManifest.mockResolvedValue({
      baseSha: 'a'.repeat(40),
      writes: [
        {
          path: 'leak.txt',
          mode: '100644',
          contentBase64: Buffer.from('sk-model-secret').toString('base64'),
          sha256: 'b'.repeat(64),
        },
      ],
      deletes: [],
    })

    await expect(runCloudPiSearch(params(), { onEvent: vi.fn() })).rejects.toThrow(
      /protected credential/
    )
    expect(mockWithPiSandbox).toHaveBeenCalledTimes(1)
    expect(mockOpenPr).not.toHaveBeenCalled()
    expect(mockRevokeCapability).toHaveBeenCalledWith('capability-id')
  })

  it('rejects protected secrets encoded in changed-file paths', async () => {
    mockReadManifest.mockResolvedValue({
      baseSha: 'a'.repeat(40),
      writes: [],
      deletes: ['ghp_github_secret'],
    })

    await expect(runCloudPiSearch(params(), { onEvent: vi.fn() })).rejects.toThrow(
      /protected credential/
    )
    expect(mockWithPiSandbox).toHaveBeenCalledTimes(1)
    expect(mockOpenPr).not.toHaveBeenCalled()
  })

  it('rejects protected secrets in the assembled prompt before Pi starts', async () => {
    mockBuildPrompt.mockReturnValue('instructions ghp_github_secret')
    await expect(runCloudPiSearch(params(), { onEvent: vi.fn() })).rejects.toThrow(
      /prompt contains protected/
    )
    expect(workerRun.mock.calls.some(([command]) => command.includes('pi -p'))).toBe(false)
    expect(mockWithPiSandbox).toHaveBeenCalledTimes(1)
    expect(mockRevokeCapability).toHaveBeenCalledWith('capability-id')
  })
})
