/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operationMocks = vi.hoisted(() => ({
  executeAppConfigCreateApplication: vi.fn(),
  executeAppConfigCreateConfigurationProfile: vi.fn(),
  executeAppConfigCreateEnvironment: vi.fn(),
  executeAppConfigCreateHostedConfigurationVersion: vi.fn(),
  executeAppConfigDeleteApplication: vi.fn(),
  executeAppConfigDeleteConfigurationProfile: vi.fn(),
  executeAppConfigDeleteEnvironment: vi.fn(),
  executeAppConfigDeleteHostedConfigurationVersion: vi.fn(),
  executeAppConfigGetApplication: vi.fn(),
  executeAppConfigGetConfiguration: vi.fn(),
  executeAppConfigGetConfigurationProfile: vi.fn(),
  executeAppConfigGetDeployment: vi.fn(),
  executeAppConfigGetEnvironment: vi.fn(),
  executeAppConfigGetHostedConfigurationVersion: vi.fn(),
  executeAppConfigListApplications: vi.fn(),
  executeAppConfigListConfigurationProfiles: vi.fn(),
  executeAppConfigListDeployments: vi.fn(),
  executeAppConfigListDeploymentStrategies: vi.fn(),
  executeAppConfigListEnvironments: vi.fn(),
  executeAppConfigListHostedConfigurationVersions: vi.fn(),
  executeAppConfigStartDeployment: vi.fn(),
  executeAppConfigStopDeployment: vi.fn(),
  executeAppConfigUpdateApplication: vi.fn(),
  executeAppConfigUpdateConfigurationProfile: vi.fn(),
  executeAppConfigUpdateEnvironment: vi.fn(),
}))

vi.mock('@/lib/internal/appconfig/operations', () => operationMocks)

import { executeAppConfigTool } from '@/lib/internal/appconfig/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const VALID_BODY = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
  maxResults: 25,
  nextToken: 'next-token',
} as const

const SUPPORTED_TOOL_IDS = [
  'appconfig_create_application',
  'appconfig_create_configuration_profile',
  'appconfig_create_environment',
  'appconfig_create_hosted_configuration_version',
  'appconfig_delete_application',
  'appconfig_delete_configuration_profile',
  'appconfig_delete_environment',
  'appconfig_delete_hosted_configuration_version',
  'appconfig_get_application',
  'appconfig_get_configuration',
  'appconfig_get_configuration_profile',
  'appconfig_get_deployment',
  'appconfig_get_environment',
  'appconfig_get_hosted_configuration_version',
  'appconfig_list_applications',
  'appconfig_list_configuration_profiles',
  'appconfig_list_deployment_strategies',
  'appconfig_list_deployments',
  'appconfig_list_environments',
  'appconfig_list_hosted_configuration_versions',
  'appconfig_start_deployment',
  'appconfig_stop_deployment',
  'appconfig_update_application',
  'appconfig_update_configuration_profile',
  'appconfig_update_environment',
] as const

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'appconfig_list_applications',
    input: VALID_BODY,
    headers: new Headers({ 'content-type': 'application/json' }),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      workspaceId: 'workspace-1',
      userId: 'user-1',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

describe('executeAppConfigTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('validates and executes the matching AppConfig operation with cancellation', async () => {
    const controller = new AbortController()
    operationMocks.executeAppConfigListApplications.mockResolvedValue({
      applications: [],
      nextToken: null,
      count: 0,
    })

    const response = await executeAppConfigTool(createRequest({ signal: controller.signal }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      applications: [],
      nextToken: null,
      count: 0,
    })
    expect(operationMocks.executeAppConfigListApplications).toHaveBeenCalledWith(
      VALID_BODY,
      controller.signal
    )
  })

  it('returns the route-compatible validation envelope before provider work', async () => {
    const response = await executeAppConfigTool(createRequest({ input: { region: 'us-east-1' } }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(operationMocks.executeAppConfigListApplications).not.toHaveBeenCalled()
  })

  it.each(SUPPORTED_TOOL_IDS)('recognizes the canonical tool ID %s', async (toolId) => {
    const response = await executeAppConfigTool(createRequest({ toolId, input: {} }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'Invalid request data' })
  })

  it('preserves the provider error envelope', async () => {
    operationMocks.executeAppConfigListApplications.mockRejectedValue(
      new Error('AWS rejected credentials')
    )

    const response = await executeAppConfigTool(createRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to list applications: AWS rejected credentials',
    })
  })

  it('propagates cancellation without converting it into a provider failure', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeAppConfigTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(operationMocks.executeAppConfigListApplications).not.toHaveBeenCalled()
  })
})
