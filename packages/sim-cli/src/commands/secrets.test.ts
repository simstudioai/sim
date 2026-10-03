import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildGeneratedCommands } from '../runtime/build'
import { attachSecretCommands } from './secrets'

const { mockPromptSecret, mockRequest, MockCancelled } = vi.hoisted(() => {
  class MockCancelled extends Error {
    constructor() {
      super('Secret input cancelled.')
    }
  }
  return {
    mockPromptSecret: vi.fn(async () => 'prompted-secret'),
    mockRequest: vi.fn(),
    MockCancelled,
  }
})

vi.mock('../context', () => ({
  clientFrom: () => ({
    client: {
      request: mockRequest,
      requireWorkspace: () => 'ws_local',
    },
    profile: {
      workspaceId: 'ws_local',
      output: 'json',
      name: 'default',
      apiKey: 'key',
    },
  }),
}))
vi.mock('../terminal/secret-input', () => ({
  promptSecret: mockPromptSecret,
  SecretInputCancelledError: MockCancelled,
}))

function sentBody(): Record<string, unknown> {
  const call = mockRequest.mock.calls.at(-1)
  if (!call) throw new Error('No request was made')
  return (call[1] as { body: Record<string, unknown> }).body
}

function program(): Command {
  const root = new Command('sim').exitOverride()
  for (const group of buildGeneratedCommands()) root.addCommand(group)
  attachSecretCommands(root)
  return root
}

describe('secrets set', () => {
  beforeEach(() => {
    mockPromptSecret.mockResolvedValue('prompted-secret')
    mockRequest.mockResolvedValue({
      data: {
        name: 'STRIPE_API_KEY',
        scope: 'workspace',
        role: 'admin',
        createdAt: '2026-08-12T20:15:00.000Z',
        updatedAt: '2026-08-12T20:15:00.000Z',
      },
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('prompts when no value flag is supplied', async () => {
    await program().parseAsync([
      'node',
      'sim',
      'secrets',
      'set',
      'STRIPE_API_KEY',
      '--scope',
      'workspace',
    ])

    expect(mockPromptSecret).toHaveBeenCalledOnce()
    expect(mockRequest).toHaveBeenCalledWith('/api/v2/secrets/STRIPE_API_KEY', {
      method: 'PUT',
      body: {
        workspaceId: 'ws_local',
        scope: 'workspace',
        value: 'prompted-secret',
      },
    })
  })
})

describe('secrets set --unredacted', () => {
  beforeEach(() => {
    mockRequest.mockResolvedValue({ data: { name: 'K', scope: 'workspace', role: 'admin' } })
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  async function set(...argv: string[]): Promise<void> {
    await program().parseAsync(['node', 'sim', 'secrets', 'set', 'K', ...argv])
  }

  it('leaves the stored setting untouched when neither flag is passed', async () => {
    await set('--scope', 'workspace', '--value', 'v')
    expect('unredacted' in sentBody()).toBe(false)
  })
})

describe('secrets set --value @file', () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'sim-cli-secret-'))
    mockRequest.mockResolvedValue({ data: { name: 'K', scope: 'workspace', role: 'admin' } })
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  async function set(value: string): Promise<void> {
    await program().parseAsync([
      'node',
      'sim',
      'secrets',
      'set',
      'K',
      '--scope',
      'workspace',
      '--value',
      value,
    ])
  }

  it('reads the value from a file, byte for byte', async () => {
    const path = join(directory, 'secret.txt')
    writeFileSync(path, ' multi\nline\t\n')
    await set(`@${path}`)
    expect(sentBody().value).toBe(' multi\nline\t\n')
  })

  it('stores a value that starts with @ when it is escaped', async () => {
    await set('@@notafile')
    expect(sentBody().value).toBe('@notafile')
  })
})

describe('secrets set cancellation', () => {
  const originalExitCode = process.exitCode

  beforeEach(() => {
    process.exitCode = undefined
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    process.exitCode = originalExitCode
  })

  it('exits 130 when the user aborts the prompt', async () => {
    mockPromptSecret.mockRejectedValue(new MockCancelled())
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`)
    }) as never)

    await expect(
      program().parseAsync(['node', 'sim', 'secrets', 'set', 'K', '--scope', 'workspace'])
    ).rejects.toThrow('exit 130')
    expect(mockRequest).not.toHaveBeenCalled()
  })
})
