/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const clientMocks = vi.hoisted(() => ({
  createAppConfigClient: vi.fn(),
  createAppConfigDataClient: vi.fn(),
  createApplication: vi.fn(),
  createConfigurationProfile: vi.fn(),
  createEnvironment: vi.fn(),
  createHostedConfigurationVersion: vi.fn(),
  deleteApplication: vi.fn(),
  deleteConfigurationProfile: vi.fn(),
  deleteEnvironment: vi.fn(),
  deleteHostedConfigurationVersion: vi.fn(),
  getApplication: vi.fn(),
  getConfiguration: vi.fn(),
  getConfigurationProfile: vi.fn(),
  getDeployment: vi.fn(),
  getEnvironment: vi.fn(),
  getHostedConfigurationVersion: vi.fn(),
  listApplications: vi.fn(),
  listConfigurationProfiles: vi.fn(),
  listDeployments: vi.fn(),
  listDeploymentStrategies: vi.fn(),
  listEnvironments: vi.fn(),
  listHostedConfigurationVersions: vi.fn(),
  startDeployment: vi.fn(),
  stopDeployment: vi.fn(),
  updateApplication: vi.fn(),
  updateConfigurationProfile: vi.fn(),
  updateEnvironment: vi.fn(),
}))

vi.mock('@/lib/internal/appconfig/client', () => clientMocks)

import {
  executeAppConfigGetConfiguration,
  executeAppConfigListApplications,
} from '@/lib/internal/appconfig/operations'

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
} as const

describe('AppConfig operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes the abort signal to AppConfig and destroys the client after success', async () => {
    const controller = new AbortController()
    const client = { destroy: vi.fn() }
    clientMocks.createAppConfigClient.mockReturnValue(client)
    clientMocks.listApplications.mockResolvedValue({
      applications: [],
      nextToken: null,
      count: 0,
    })

    await expect(
      executeAppConfigListApplications(
        { ...CONNECTION, maxResults: 25, nextToken: 'next-token' },
        controller.signal
      )
    ).resolves.toEqual({ applications: [], nextToken: null, count: 0 })

    expect(clientMocks.createAppConfigClient).toHaveBeenCalledWith({
      ...CONNECTION,
      maxResults: 25,
      nextToken: 'next-token',
    })
    expect(clientMocks.listApplications).toHaveBeenCalledWith(
      client,
      controller.signal,
      25,
      'next-token'
    )
    expect(client.destroy).toHaveBeenCalledOnce()
  })

  it('destroys the AppConfig client when the provider rejects', async () => {
    const client = { destroy: vi.fn() }
    clientMocks.createAppConfigClient.mockReturnValue(client)
    clientMocks.listApplications.mockRejectedValue(new Error('provider failed'))

    await expect(executeAppConfigListApplications(CONNECTION)).rejects.toThrow('provider failed')
    expect(client.destroy).toHaveBeenCalledOnce()
  })

  it('passes cancellation through both AppConfig Data requests and destroys that client', async () => {
    const controller = new AbortController()
    const client = { destroy: vi.fn() }
    clientMocks.createAppConfigDataClient.mockReturnValue(client)
    clientMocks.getConfiguration.mockResolvedValue({
      configuration: '{}',
      contentType: 'application/json',
      versionLabel: null,
    })

    await executeAppConfigGetConfiguration(
      {
        ...CONNECTION,
        applicationId: 'application-1',
        environmentId: 'environment-1',
        configurationProfileId: 'profile-1',
      },
      controller.signal
    )

    expect(clientMocks.getConfiguration).toHaveBeenCalledWith(
      client,
      controller.signal,
      'application-1',
      'environment-1',
      'profile-1'
    )
    expect(client.destroy).toHaveBeenCalledOnce()
  })
})
