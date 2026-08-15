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
