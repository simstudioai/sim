/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockOpenSshSession,
  mockCloseSshSession,
  mockBuildSshToolSpecs,
  mockCaptureRepoChanges,
  mockToolExecute,
  mockCreateAgentSession,
  mockPrompt,
  mockDispose,
  mockSetRuntimeApiKey,
  mockRemoveRuntimeApiKey,
  mockCreatePiModelRuntime,
} = vi.hoisted(() => ({
  mockOpenSshSession: vi.fn(),
  mockCloseSshSession: vi.fn(),
  mockBuildSshToolSpecs: vi.fn(),
  mockCaptureRepoChanges: vi.fn(),
  mockToolExecute: vi.fn(),
  mockCreateAgentSession: vi.fn(),
  mockPrompt: vi.fn(),
  mockDispose: vi.fn(),
  mockSetRuntimeApiKey: vi.fn(),
  mockRemoveRuntimeApiKey: vi.fn(),
  mockCreatePiModelRuntime: vi.fn(),
}))

let sessionEventListener: ((event: unknown) => void) | undefined
const mockAgentSession = {
  subscribe: vi.fn((listener: (event: unknown) => void) => {
    sessionEventListener = listener
    return vi.fn()
  }),
  prompt: mockPrompt,
  abort: vi.fn(),
  dispose: mockDispose,
  agent: { state: { errorMessage: undefined as string | undefined } },
}
const mockSdk = {
  defineTool: vi.fn((tool) => tool),
  SessionManager: { inMemory: vi.fn(() => ({})) },
  createAgentSession: mockCreateAgentSession,
}
const mockModelRuntime = {
  setRuntimeApiKey: mockSetRuntimeApiKey,
  removeRuntimeApiKey: mockRemoveRuntimeApiKey,
}

vi.mock('@/executor/handlers/pi/context', () => ({
  buildPiPrompt: ({ task }: { task: string }) => task,
}))
vi.mock('@/executor/handlers/pi/keys', () => ({ mapThinkingLevel: () => 'medium' }))
vi.mock('@/executor/handlers/pi/pi-sdk', () => ({
  loadPiSdk: () => Promise.resolve(mockSdk),
  createPiModelRuntime: mockCreatePiModelRuntime,
  resolvePiSdkModel: () => ({ id: 'claude', provider: 'anthropic' }),
}))
vi.mock('@/executor/handlers/pi/ssh-tools', () => ({
  openSshSession: mockOpenSshSession,
  buildSshToolSpecs: mockBuildSshToolSpecs,
  captureRepoChanges: mockCaptureRepoChanges,
}))

import type { PiLocalRunParams } from '@/executor/handlers/pi/backend'
import { runLocalPi } from '@/executor/handlers/pi/local-backend'

function baseParams(): PiLocalRunParams {
  return {
    mode: 'local',
    model: 'claude',
    piModel: 'claude',
    providerId: 'anthropic',
    apiKey: 'sk-hosted',
    isBYOK: false,
    task: 'do not expose sk-hosted',
    skills: [],
    initialMessages: [],
    repoPath: '/repo',
    tools: [],
    ssh: { host: 'example.com', port: 22, username: 'user', password: 'ssh-secret' },
  }
}

describe('runLocalPi secret boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionEventListener = undefined
    mockAgentSession.agent.state.errorMessage = undefined
    mockPrompt.mockReset()
    mockDispose.mockReset()
    mockCreatePiModelRuntime.mockResolvedValue(mockModelRuntime)
    mockOpenSshSession.mockResolvedValue({
      client: {},
      sftp: {},
      close: mockCloseSshSession,
    })
    mockToolExecute.mockResolvedValue({ text: 'tool saw sk-hosted', isError: false })
    mockBuildSshToolSpecs.mockReturnValue([
      {
        name: 'read',
        description: 'Read a file',
        parameters: { type: 'object', properties: {} },
        execute: mockToolExecute,
      },
    ])
    mockCaptureRepoChanges.mockResolvedValue({
      changedFiles: ['sk-hosted.ts'],
      diff: '+sk-hosted',
    })
    mockCreateAgentSession.mockResolvedValue({ session: mockAgentSession })
  })

  it('scrubs prompts, events, tool results, outputs, and removes the runtime key', async () => {
    const onEvent = vi.fn()
    mockPrompt.mockImplementation(async () => {
      sessionEventListener?.({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'answer sk-hosted' },
      })
    })

    const result = await runLocalPi(baseParams(), { onEvent })
    const customTool = mockCreateAgentSession.mock.calls[0][0].customTools[0]
    const toolResult = await customTool.execute('call-1', {}, undefined, undefined, {})

    expect(mockPrompt).toHaveBeenCalledWith('do not expose ***')
    expect(onEvent).toHaveBeenCalledWith({ type: 'text', text: 'answer ***' })
    expect(result.totals.finalText).toBe('answer ***')
    expect(result.changedFiles).toEqual(['***.ts'])
    expect(result.diff).toBe('+***')
    expect(toolResult.content).toEqual([{ type: 'text', text: 'tool saw ***' }])
    expect(mockSetRuntimeApiKey).toHaveBeenCalledWith('anthropic', 'sk-hosted')
    expect(mockRemoveRuntimeApiKey).toHaveBeenCalledWith('anthropic')
    expect(JSON.stringify({ result, toolResult })).not.toContain('sk-hosted')
  })

  it('scrubs SDK exceptions before they leave Local Dev', async () => {
    mockCreateAgentSession.mockRejectedValueOnce(new Error('provider rejected sk-hosted'))

    await expect(runLocalPi(baseParams(), { onEvent: vi.fn() })).rejects.toThrow(
      'provider rejected ***'
    )
    expect(mockRemoveRuntimeApiKey).toHaveBeenCalledWith('anthropic')
  })

  it('does not treat host-only SSH authentication material as agent-visible content', async () => {
    const params = baseParams()
    params.ssh.password = 'admin'
    params.task = 'update the admin page'
    mockToolExecute.mockResolvedValue({ text: 'opened admin settings', isError: false })
    mockCaptureRepoChanges.mockResolvedValue({
      changedFiles: ['src/admin.ts'],
      diff: '+const admin = true',
    })

    const result = await runLocalPi(params, { onEvent: vi.fn() })
    const customTool = mockCreateAgentSession.mock.calls[0][0].customTools[0]
    const toolResult = await customTool.execute('call-1', {}, undefined, undefined, {})

    expect(mockPrompt).toHaveBeenCalledWith('update the admin page')
    expect(toolResult.content).toEqual([{ type: 'text', text: 'opened admin settings' }])
    expect(result.changedFiles).toEqual(['src/admin.ts'])
    expect(result.diff).toBe('+const admin = true')
  })

  it('scrubs short SSH authentication material from connection errors', async () => {
    const params = baseParams()
    params.ssh.password = '1234'
    mockOpenSshSession.mockRejectedValueOnce(new Error('SSH rejected password 1234'))

    await expect(runLocalPi(params, { onEvent: vi.fn() })).rejects.toThrow(
      'SSH rejected password ***'
    )
  })
})
