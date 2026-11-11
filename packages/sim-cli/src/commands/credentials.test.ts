import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SimApiError } from '../http/client'
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

  describe('native Claude Platform service account', () => {
    const claude = {
      type: 'service_account',
      serviceId: 'claude-platform-service-account',
      providerId: 'claude-platform-service-account',
      available: true,
      requiresClientGeneratedCredentialId: false,
      fields: [{ id: 'apiToken', required: true, secret: true }],
    }
    const createArgs = [
      'node',
      'sim',
      'credentials',
      'create',
      'claude-platform-service-account',
      '--name',
      'Code Fixes',
      '--credentials',
      '{"apiToken":"test-api-token"}',
    ]

    it('creates from the unfiltered catalog without requiring a client credential id', async () => {
      mockRequest
        .mockReset()
        .mockResolvedValueOnce({ data: [claude], nextCursor: null })
        .mockResolvedValueOnce({ data: { id: 'credential-1' } })

      await program().parseAsync(createArgs)

      expect(mockRequest).toHaveBeenNthCalledWith(1, '/api/v2/credentials/providers', {
        method: 'GET',
        query: { workspaceId: 'ws_local' },
      })
      const [, createRequest] = mockRequest.mock.calls[1]
      expect(createRequest.body).toEqual({
        workspaceId: 'ws_local',
        type: 'service_account',
        providerId: 'claude-platform-service-account',
        displayName: 'Code Fixes',
        credentials: '{"apiToken":"test-api-token"}',
      })
    })

    it('refuses before creation when workspace policy disables the provider', async () => {
      mockRequest
        .mockReset()
        .mockResolvedValueOnce({ data: [{ ...claude, available: false }], nextCursor: null })

      await expect(program().parseAsync(createArgs)).rejects.toThrow(
        'Service-account provider "claude-platform-service-account" is not available.'
      )
      expect(mockRequest).toHaveBeenCalledTimes(1)
    })
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

describe('keyless credentials', () => {
  const subject = 'sim:workspace:ws_local:credential:abcdef0123456789'
  const issued = {
    issuer: 'https://sim.example.com/oidc/workload',
    audience: 'snowflakecomputing.com',
    subject,
    subjectProof: '1781965031000.signature',
    expiresAt: '2026-11-11T20:15:00.000Z',
    keylessConfig: {
      authType: 'workload_identity',
      subject,
      subjectProof: '1781965031000.signature',
    },
    requiredConfigFields: ['host'],
    optionalConfigFields: [],
  }
  const snowflake = {
    type: 'service_account',
    providerId: 'snowflake-service-account',
    available: true,
    requiresClientGeneratedCredentialId: false,
    fields: [
      { id: 'domain', required: true },
      { id: 'apiToken', required: true, secret: true },
      { id: 'serviceAccountJson', required: false, secret: true },
    ],
    keyless: {
      authType: 'workload_identity',
      requiredConfigFields: ['host'],
      optionalConfigFields: [],
    },
  }
  const keylessConfig = { ...issued.keylessConfig, host: 'myorg-myaccount.snowflakecomputing.com' }
  let log: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    output.format = 'json'
    mockRequest.mockReset()
    log = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('prints the issued subject as the API data, ready to feed into creation', async () => {
    mockRequest.mockResolvedValue({ data: issued })

    await program().parseAsync([
      'node',
      'sim',
      'credentials',
      'keyless-subject',
      'snowflake-service-account',
    ])

    expect(mockRequest).toHaveBeenCalledWith('/api/v2/credentials/workload-identity/subjects', {
      method: 'POST',
      body: { workspaceId: 'ws_local', providerId: 'snowflake-service-account' },
    })
    expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual(issued)
  })

  it('refuses a provider with no keyless mode before calling the API', async () => {
    const root = program()
    const keylessSubject = root.commands
      .find((command) => command.name() === 'credentials')
      ?.commands.find((command) => command.name() === 'keyless-subject')
    // exitOverride is not inherited by added subcommands; set it where the argument is parsed.
    keylessSubject?.exitOverride().configureOutput({ writeErr: () => {} })

    await expect(
      root.parseAsync(['node', 'sim', 'credentials', 'keyless-subject', 'zoom-service-account'])
    ).rejects.toThrow(
      "command-argument value 'zoom-service-account' is invalid for argument 'providerId'. Allowed choices are aws-service-account, databricks-service-account, snowflake-service-account, microsoft-app-service-account, google-service-account."
    )
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('creates a keyless Snowflake credential from the completed keylessConfig alone', async () => {
    mockRequest
      .mockResolvedValueOnce({ data: [snowflake], nextCursor: null })
      .mockResolvedValueOnce({ data: { id: 'credential-1' } })

    await program().parseAsync([
      'node',
      'sim',
      'credentials',
      'create',
      'snowflake-service-account',
      '--name',
      'Snowflake (keyless)',
      '--credentials',
      JSON.stringify(keylessConfig),
    ])

    const [, createRequest] = mockRequest.mock.calls[1]
    expect(JSON.parse(createRequest.body.credentials)).toEqual({
      serviceAccountJson: JSON.stringify(keylessConfig),
    })
  })

  const configOnly = (providerId: string) => ({
    type: 'service_account',
    providerId,
    available: true,
    requiresClientGeneratedCredentialId: false,
    fields: [{ id: 'serviceAccountJson', required: true, secret: true }],
    keyless: { authType: 'oidc_role', requiredConfigFields: ['roleArn'], optionalConfigFields: [] },
  })

  async function createWith(provider: object, providerId: string, credentials: unknown) {
    mockRequest
      .mockResolvedValueOnce({ data: [provider], nextCursor: null })
      .mockResolvedValueOnce({ data: { id: 'credential-1' } })
    await program().parseAsync([
      'node',
      'sim',
      'credentials',
      'create',
      providerId,
      '--name',
      'Credential',
      '--credentials',
      JSON.stringify(credentials),
    ])
    const [, createRequest] = mockRequest.mock.calls[1]
    return JSON.parse(createRequest.body.credentials)
  }

  it.each([
    ['aws-service-account', { serviceAccountJson: '{"authType":"access_keys"}' }],
    ['google-service-account', { serviceAccountJson: '{"type":"service_account"}' }],
  ])(
    'sends %s fields that already name serviceAccountJson unchanged',
    async (providerId, fields) => {
      expect(await createWith(configOnly(providerId), providerId, fields)).toEqual(fields)
    }
  )

  it('sends Snowflake token fields unchanged', async () => {
    const fields = { domain: 'myorg-myaccount.snowflakecomputing.com', apiToken: 'pat' }
    expect(await createWith(snowflake, 'snowflake-service-account', fields)).toEqual(fields)
  })

  it.each([
    [
      'a keylessConfig carrying its subject and proof',
      { authType: 'workload_identity', projectNumber: '1', subject, subjectProof: 'p' },
    ],
    [
      'an object with the catalog’s keyless authType',
      { authType: 'oidc_role', roleArn: 'arn:aws:iam::123456789012:role/Sim' },
    ],
  ])('wraps %s as serviceAccountJson', async (_label, configuration) => {
    expect(
      await createWith(configOnly('aws-service-account'), 'aws-service-account', configuration)
    ).toEqual({ serviceAccountJson: JSON.stringify(configuration) })
  })

  it('reads any other object as fields, so a raw key file is reported, not wrapped', async () => {
    mockRequest.mockResolvedValueOnce({
      data: [configOnly('google-service-account')],
      nextCursor: null,
    })

    await expect(
      program().parseAsync([
        'node',
        'sim',
        'credentials',
        'create',
        'google-service-account',
        '--name',
        'Google',
        '--credentials',
        '{"type":"service_account","client_email":"sa@p.iam.gserviceaccount.com"}',
      ])
    ).rejects.toThrow('unsupported field "type" for google-service-account')
  })

  it('still reports a misspelled Snowflake field instead of wrapping it', async () => {
    mockRequest.mockResolvedValueOnce({ data: [snowflake], nextCursor: null })

    await expect(
      program().parseAsync([
        'node',
        'sim',
        'credentials',
        'create',
        'snowflake-service-account',
        '--name',
        'Snowflake',
        '--credentials',
        '{"Domain":"myorg-myaccount.snowflakecomputing.com"}',
      ])
    ).rejects.toThrow('unsupported field "Domain" for snowflake-service-account')
    expect(mockRequest).toHaveBeenCalledTimes(1)
  })

  it('names the command that issues a new subject when a proof is refused', async () => {
    mockRequest
      .mockResolvedValueOnce({ data: [snowflake], nextCursor: null })
      .mockRejectedValueOnce(
        new SimApiError('This trust setup has expired.', 400, 'BAD_REQUEST', {
          code: 'WORKLOAD_IDENTITY_PROOF_EXPIRED',
        })
      )

    const failure = program().parseAsync([
      'node',
      'sim',
      'credentials',
      'create',
      'snowflake-service-account',
      '--name',
      'Snowflake (keyless)',
      '--credentials',
      JSON.stringify(keylessConfig),
    ])

    await expect(failure).rejects.toMatchObject({
      message: expect.stringContaining('sim credentials keyless-subject snowflake-service-account'),
      code: 'BAD_REQUEST',
      details: { code: 'WORKLOAD_IDENTITY_PROOF_EXPIRED' },
    })
  })
})
