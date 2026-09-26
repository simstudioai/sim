import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildGeneratedCommands } from '../runtime/build'
import { attachCredentialCommands } from './credentials'

const { mockRequest, output } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  output: { format: 'table' },
}))

vi.mock('../context', () => ({
  clientFrom: () => ({
    client: {
      request: mockRequest,
      requireWorkspace: () => 'ws_local',
    },
    profile: {
      workspaceId: 'ws_local',
      output: output.format,
      name: 'default',
      apiKey: 'key',
    },
  }),
}))

function program(): Command {
  const root = new Command('sim').exitOverride()
  for (const group of buildGeneratedCommands()) root.addCommand(group)
  attachCredentialCommands(root)
  return root
}

function commandAt(...names: string[]): Command {
  let current = program()
  for (const name of names) {
    const next = current.commands.find((command) => command.name() === name)
    if (!next) throw new Error(`Missing command ${names.join(' ')}`)
    current = next
  }
  return current
}

describe('credential connection commands', () => {
  beforeEach(() => {
    output.format = 'table'
    mockRequest.mockReset()
    mockRequest.mockResolvedValue({
      data: {
        authorizationUrl: 'https://sim.ai/api/auth/oauth2/authorize?draftId=draft-1',
        expiresAt: '2026-08-12T20:15:00.000Z',
      },
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('exposes one provider-shaped credential object instead of every provider secret', () => {
    const help = commandAt('credentials', 'create').helpInformation()

    expect(help).toContain('<providerId>')
    expect(help).toContain('--credentials <json|@file>')
    expect(help).not.toContain('--type')
    expect(help).not.toContain('--client-secret')
    expect(help).not.toContain('--service-account-json')
  })

  it('rejects missing and unsupported provider fields before creation', async () => {
    mockRequest.mockReset().mockResolvedValue({
      data: [
        {
          type: 'service_account',
          providerId: 'zoom-service-account',
          available: true,
          requiresClientGeneratedCredentialId: false,
          fields: [
            { id: 'clientId', required: true },
            { id: 'clientSecret', required: true },
            { id: 'orgId', required: true },
          ],
        },
      ],
      nextCursor: null,
    })

    await expect(
      program().parseAsync([
        'node',
        'sim',
        'credentials',
        'create',
        'zoom-service-account',
        '--name',
        'Production Zoom',
        '--credentials',
        '{"clientId":"client","clientSecret":"secret"}',
      ])
    ).rejects.toThrow('missing required fields for zoom-service-account: orgId')
    expect(mockRequest).toHaveBeenCalledTimes(1)

    mockRequest.mockClear()
    await expect(
      program().parseAsync([
        'node',
        'sim',
        'credentials',
        'create',
        'zoom-service-account',
        '--name',
        'Production Zoom',
        '--credentials',
        '{"clientId":"client","clientSecret":"secret","orgId":"account","extra":"no"}',
      ])
    ).rejects.toThrow('unsupported field "extra" for zoom-service-account')
    expect(mockRequest).toHaveBeenCalledTimes(1)
  })
})

describe('credentials update --name', () => {
  beforeEach(() => {
    output.format = 'json'
    mockRequest.mockReset()
    mockRequest.mockResolvedValue({ data: { id: 'cred-1', displayName: 'renamed' } })
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  async function update(...argv: string[]): Promise<void> {
    await program().parseAsync(['node', 'sim', 'credentials', 'update', 'cred-1', ...argv])
  }

  it('refuses both spellings of the same field', async () => {
    await expect(update('--name', 'one', '--display-name', 'two')).rejects.toThrow(
      '--name and --display-name are the same field; pass one, not both'
    )
    expect(mockRequest).not.toHaveBeenCalled()
  })
})
