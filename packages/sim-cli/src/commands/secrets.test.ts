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
    vi.clearAllMocks()
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

  it('accepts --value directly without prompting', async () => {
    await program().parseAsync([
      'node',
      'sim',
      'secrets',
      'set',
      'STRIPE_API_KEY',
      '--scope',
      'personal',
      '--value',
      'direct-secret',
    ])

    expect(mockPromptSecret).not.toHaveBeenCalled()
    expect(mockRequest).toHaveBeenCalledWith('/api/v2/secrets/STRIPE_API_KEY', {
      method: 'PUT',
      body: {
        workspaceId: 'ws_local',
        scope: 'personal',
        value: 'direct-secret',
      },
    })
  })

  it('keeps --value optional in help and rejects an empty direct value', async () => {
    const secrets = program().commands.find((command) => command.name() === 'secrets')
    const set = secrets?.commands.find((command) => command.name() === 'set')
    if (!set) throw new Error('Missing secrets set command')
    expect(set.helpInformation()).toContain('--value <value|@file>')
    expect(set.helpInformation().replace(/\s+/g, ' ')).not.toContain('Set value (required)')

    await expect(
      program().parseAsync([
        'node',
        'sim',
        'secrets',
        'set',
        'STRIPE_API_KEY',
        '--scope',
        'workspace',
        '--value',
        '',
      ])
    ).rejects.toThrow('Secret value cannot be empty.')
    expect(mockRequest).not.toHaveBeenCalled()
  })
})

describe('secrets set --unredacted', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequest.mockResolvedValue({ data: { name: 'K', scope: 'workspace', role: 'admin' } })
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  async function set(...argv: string[]): Promise<void> {
    await program().parseAsync(['node', 'sim', 'secrets', 'set', 'K', ...argv])
  }

  it('opts a workspace secret out of redaction', async () => {
    await set('--scope', 'workspace', '--value', 'v', '--unredacted')
    expect(sentBody().unredacted).toBe(true)
  })

  it('restores redaction with --no-unredacted', async () => {
    await set('--scope', 'workspace', '--value', 'v', '--no-unredacted')
    expect(sentBody().unredacted).toBe(false)
  })

  it('leaves the stored setting untouched when neither flag is passed', async () => {
    await set('--scope', 'workspace', '--value', 'v')
    expect('unredacted' in sentBody()).toBe(false)
  })

  it('rejects the flag for a personal secret before reading the value', async () => {
    await expect(set('--scope', 'personal', '--unredacted')).rejects.toThrow(
      '--unredacted is only supported for a workspace secret.'
    )
    expect(mockPromptSecret).not.toHaveBeenCalled()
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('warns in the flag help that the value becomes readable', async () => {
    const secrets = program().commands.find((command) => command.name() === 'secrets')
    const help = secrets?.commands.find((command) => command.name() === 'set')?.helpInformation()
    // Flattened: commander wraps descriptions to `process.stdout.columns`, so a
    // phrase containing a space straddles a line break at some terminal widths
    // and not others.
    expect(help?.replace(/\s+/g, ' ')).toContain('plaintext in run logs')
    expect(help).toContain('--no-unredacted')
  })
})

describe('secrets set --value @file', () => {
  let directory: string

  beforeEach(() => {
    vi.clearAllMocks()
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

  /**
   * `echo 'x' > f` leaves a newline the secret does not want, and stripping it
   * here would corrupt the values that do — a PEM key ends in one. The
   * behaviour stays verbatim, so the help has to name the trap.
   */
  it('says in the help that a trailing newline is part of the value', () => {
    const secrets = program().commands.find((command) => command.name() === 'secrets')
    const help = secrets?.commands.find((command) => command.name() === 'set')?.helpInformation()
    expect(help?.replace(/\s+/g, ' ')).toContain('a trailing newline is part of the value')
  })

  it('stores a value that starts with @ when it is escaped', async () => {
    await set('@@notafile')
    expect(sentBody().value).toBe('@notafile')
  })

  it('names the flag when the file cannot be read', async () => {
    await expect(set(`@${join(directory, 'missing.txt')}`)).rejects.toThrow('--value cannot read')
    expect(mockRequest).not.toHaveBeenCalled()
  })
})

describe('secrets set cancellation', () => {
  const originalExitCode = process.exitCode

  beforeEach(() => {
    vi.clearAllMocks()
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
