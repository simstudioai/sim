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
    vi.restoreAllMocks()
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

  it('discovers and validates a service-account provider before creating it', async () => {
    mockRequest
      .mockReset()
      .mockResolvedValueOnce({
        data: [
          {
            type: 'service_account',
            serviceId: 'zoom-service-account',
            providerId: 'zoom-service-account',
            name: 'Zoom server-to-server app',
            description: 'Connect Zoom.',
            providerFamily: 'zoom',
            available: true,
            docsUrl: 'https://docs.sim.ai/zoom',
            requiresClientGeneratedCredentialId: false,
            fields: [
              {
                id: 'clientId',
                label: 'Client ID',
                placeholder: 'Client ID',
                required: true,
                secret: false,
                multiline: false,
              },
              {
                id: 'clientSecret',
                label: 'Client secret',
                placeholder: 'Client secret',
                required: true,
                secret: true,
                multiline: false,
              },
              {
                id: 'orgId',
                label: 'Account ID',
                placeholder: 'Account ID',
                required: true,
                secret: false,
                multiline: false,
              },
            ],
          },
        ],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: 'cred_123',
          type: 'service_account',
          displayName: 'Production Zoom',
          description: null,
          providerId: 'zoom-service-account',
          accountId: null,
          hasServiceAccountKey: true,
          role: 'admin',
          createdAt: '2026-08-12T20:15:00.000Z',
          updatedAt: '2026-08-12T20:15:00.000Z',
        },
      })

    await program().parseAsync([
      'node',
      'sim',
      'credentials',
      'create',
      'zoom-service-account',
      '--name',
      'Production Zoom',
      '--credentials',
      '{"clientId":"client","clientSecret":"secret","orgId":"account"}',
    ])

    expect(mockRequest).toHaveBeenNthCalledWith(1, '/api/v2/credentials/providers', {
      method: 'GET',
      query: { workspaceId: 'ws_local' },
    })
    expect(mockRequest).toHaveBeenNthCalledWith(2, '/api/v2/credentials', {
      method: 'POST',
      body: {
        workspaceId: 'ws_local',
        type: 'service_account',
        providerId: 'zoom-service-account',
        displayName: 'Production Zoom',
        credentials: JSON.stringify({
          clientId: 'client',
          clientSecret: 'secret',
          orgId: 'account',
        }),
      },
    })
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

  it('creates and prints a new-provider connection link', async () => {
    await program().parseAsync([
      'node',
      'sim',
      'credentials',
      'connect',
      'google-email',
      '--name',
      'Work Gmail',
    ])

    expect(mockRequest).toHaveBeenCalledWith('/api/v2/credentials/connections', {
      method: 'POST',
      body: {
        workspaceId: 'ws_local',
        providerId: 'google-email',
        displayName: 'Work Gmail',
      },
    })
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain(
      'https://sim.ai/api/auth/oauth2/authorize?draftId=draft-1'
    )
  })

  it('creates a reconnect link for an existing credential', async () => {
    output.format = 'json'
    await program().parseAsync(['node', 'sim', 'credentials', 'reconnect', 'cred_1'])

    expect(mockRequest).toHaveBeenCalledWith('/api/v2/credentials/connections', {
      method: 'POST',
      body: { workspaceId: 'ws_local', credentialId: 'cred_1' },
    })
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain('authorizationUrl')
  })
})

describe('credentials update --name', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    output.format = 'json'
    mockRequest.mockReset()
    mockRequest.mockResolvedValue({ data: { id: 'cred-1', displayName: 'renamed' } })
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  async function update(...argv: string[]): Promise<void> {
    await program().parseAsync(['node', 'sim', 'credentials', 'update', 'cred-1', ...argv])
  }

  it('accepts --name as an alias for --display-name', async () => {
    await update('--name', 'renamed')

    expect(mockRequest).toHaveBeenCalledOnce()
    expect(mockRequest.mock.calls[0][1].body).toMatchObject({ displayName: 'renamed' })
  })

  it('keeps --display-name working', async () => {
    await update('--display-name', 'renamed')

    expect(mockRequest.mock.calls[0][1].body).toMatchObject({ displayName: 'renamed' })
  })

  it('refuses both spellings of the same field', async () => {
    await expect(update('--name', 'one', '--display-name', 'two')).rejects.toThrow(
      '--name and --display-name are the same field; pass one, not both'
    )
    expect(mockRequest).not.toHaveBeenCalled()
  })
})
