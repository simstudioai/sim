import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildGeneratedCommands } from '../runtime/build'
import { attachSecretCommands } from './secrets'

const { mockPromptSecret, mockRequest } = vi.hoisted(() => ({
  mockPromptSecret: vi.fn(async () => 'prompted-secret'),
  mockRequest: vi.fn(),
}))

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
vi.mock('../terminal/secret-input', () => ({ promptSecret: mockPromptSecret }))

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
    expect(set.helpInformation()).toContain('--value <value>')
    expect(set.helpInformation()).not.toContain('Set value (required)')

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
