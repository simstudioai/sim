/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  createClient: vi.fn(),
  execute: vi.fn(),
}))
vi.mock('@/lib/auth/credential-access', () => ({ authorizeCredentialUseForAuth: mocks.authorize }))
vi.mock('@/lib/auth/hybrid', () => ({ AuthType: { INTERNAL_JWT: 'internal_jwt' } }))
vi.mock('@/lib/api/server', () => ({ getValidationErrorMessage: () => 'Invalid input' }))
vi.mock('@/lib/internal/oci/client.server', () => ({ createOciClient: mocks.createClient }))
vi.mock('@/lib/internal/oci-compute/operations', () => ({
  executeOciComputeOperation: mocks.execute,
}))

import { executeOciComputeTool } from '@/lib/internal/oci-compute/execute-tool'
import { OciComputeBlock } from '@/blocks/blocks/oci_compute'
import {
  ociComputeChangeImageCompartmentTool,
  ociComputeChangeInstanceCompartmentTool,
  ociComputeCreateComputeCapacityReportTool,
  ociComputeCreateImageTool,
  ociComputeCreateInstanceConfigurationTool,
  ociComputeDeleteImageTool,
  ociComputeInstanceActionTool,
  ociComputeLaunchInstanceTool,
  ociComputeTerminateInstanceTool,
  ociComputeUpdateImageTool,
  ociComputeUpdateInstanceTool,
} from '@/tools/oci_compute'
import { ociComputeListImagesTool } from '@/tools/oci_compute/list_images'
import { ociComputeListInstanceConfigurationsTool } from '@/tools/oci_compute/list_instance_configurations'
import { ociComputeListInstancePoolsTool } from '@/tools/oci_compute/list_instance_pools'
import { ociComputeListInstancesTool } from '@/tools/oci_compute/list_instances'
import { ociComputeListShapesTool } from '@/tools/oci_compute/list_shapes'
import { ociComputeListSubnetsTool } from '@/tools/oci_compute/list_subnets'

function call(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'oci_compute_get_instance',
    input: { oauthCredential: 'submitted', region: 'us-ashburn-1', instanceId: 'instance' },
    headers: new Headers(),
    context: { workflowId: 'workflow', workspaceId: 'workspace', userId: 'user' },
    requestId: 'request',
    ...overrides,
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.authorize.mockResolvedValue({
    ok: true,
    resolvedCredentialId: 'authoritative',
    credentialType: 'service_account',
    workspaceId: 'workspace',
  })
  mocks.createClient.mockResolvedValue({ bound: true })
  mocks.execute.mockResolvedValue({ success: true, output: { status: 200, requestId: 'request' } })
})

describe('OCI Compute trusted execution wiring', () => {
  it.each([
    ociComputeChangeImageCompartmentTool,
    ociComputeChangeInstanceCompartmentTool,
    ociComputeCreateComputeCapacityReportTool,
    ociComputeCreateImageTool,
    ociComputeCreateInstanceConfigurationTool,
    ociComputeDeleteImageTool,
    ociComputeInstanceActionTool,
    ociComputeLaunchInstanceTool,
    ociComputeTerminateInstanceTool,
    ociComputeUpdateImageTool,
    ociComputeUpdateInstanceTool,
  ])('accepts native blank mutation defaults for $id', async (tool) => {
    for (const blank of [null, '', undefined]) {
      const raw = {
        operation: tool.id,
        oauthCredential: 'submitted',
        region: 'us-ashburn-1',
        compartmentId: 'compartment',
        instanceId: 'instance',
        imageId: 'image',
        availabilityDomain: 'AD',
        shape: 'VM.Standard.E5.Flex',
        sourceMode: 'image',
        configurationSource: 'NONE',
        instanceDetails: { instanceType: 'compute' },
        shapeAvailabilities: [{ instanceShape: 'VM.Standard.E5.Flex' }],
        subnetId: 'subnet',
        createVnicDetails: { assignPublicIp: false },
        action: 'STOP',
        displayName: 'Synthetic',
        retryToken: blank,
        ifMatch: blank,
        freeformTags: blank,
        definedTags: blank,
        shapeConfig: blank,
        faultDomain: blank,
        kmsKeyId: blank,
        metadata: blank,
        extendedMetadata: blank,
        agentConfig: blank,
        availabilityConfig: blank,
        instanceOptions: blank,
        capacityReservationId: blank,
        dedicatedVmHostId: blank,
        timeMaintenanceRebootDue: blank,
        updateOperationConstraint: blank,
      }
      const params = { ...raw, ...OciComputeBlock.tools.config?.params?.(raw) }
      const response = await executeOciComputeTool(
        call({ toolId: tool.id, input: tool.operation.input(params) })
      )
      expect(response.status).toBe(200)
      const dispatched = mocks.execute.mock.lastCall?.[2]
      expect(dispatched).not.toHaveProperty('retryToken')
      expect(dispatched).not.toHaveProperty('ifMatch')
      expect(dispatched).not.toHaveProperty('freeformTags')
      expect(dispatched).not.toHaveProperty('definedTags')
      if (tool.id === 'oci_compute_update_instance') {
        expect(dispatched.updateOperationConstraint).toBe('AVOID_DOWNTIME')
      }
    }
  })

  it.each([
    ociComputeListInstancesTool,
    ociComputeListImagesTool,
    ociComputeListShapesTool,
    ociComputeListSubnetsTool,
    ociComputeListInstanceConfigurationsTool,
    ociComputeListInstancePoolsTool,
  ])('normalizes native blank discovery filters for $id', async (tool) => {
    for (const blank of [null, '', undefined]) {
      const raw = {
        operation: tool.id,
        oauthCredential: 'submitted',
        region: 'us-ashburn-1',
        compartmentId: 'compartment',
        limit: '10',
        page: blank,
        sortBy: blank,
        sortOrder: blank,
        displayName: blank,
        availabilityDomain: blank,
        lifecycleState: blank,
        capacityReservationId: blank,
        operatingSystemVersion: blank,
        shape: blank,
        imageId: blank,
        vcnId: blank,
      }
      const params = { ...raw, ...OciComputeBlock.tools.config?.params?.(raw) }
      const response = await executeOciComputeTool(
        call({ toolId: tool.id, input: tool.operation.input(params) })
      )
      expect(response.status).toBe(200)
      expect(mocks.execute).toHaveBeenLastCalledWith(
        expect.anything(),
        tool.id.replace('oci_compute_', ''),
        expect.objectContaining({ compartmentId: 'compartment', limit: 10 }),
        undefined
      )
      expect(mocks.execute.mock.lastCall?.[2].page).toBeUndefined()
    }
  })

  it('keeps meaningful zero, false and empty mutation values while rejecting invalid list input', async () => {
    const raw = {
      operation: 'oci_compute_update_instance',
      capacityReservationId: '',
      preserveBootVolume: false,
    }
    const params = { ...raw, ...OciComputeBlock.tools.config?.params?.(raw) }
    expect(params.capacityReservationId).toBe('')
    const resized = OciComputeBlock.tools.config?.params?.({
      operation: 'oci_compute_update_instance_pool',
      size: 0,
    })
    expect(resized?.size).toBe(0)
    const terminated = OciComputeBlock.tools.config?.params?.({
      operation: 'oci_compute_terminate_instance',
      preserveBootVolume: false,
    })
    expect(terminated?.preserveBootVolume).toBe(false)
    const invalid = {
      operation: ociComputeListInstancesTool.id,
      oauthCredential: 'submitted',
      region: 'us-ashburn-1',
      compartmentId: 'compartment',
      page: 12,
    }
    const response = await executeOciComputeTool(
      call({
        toolId: ociComputeListInstancesTool.id,
        input: ociComputeListInstancesTool.operation.input({
          ...invalid,
          ...OciComputeBlock.tools.config?.params?.(invalid),
        }),
      })
    )
    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('authorizes submitted identity and binds only the resolved credential and trusted scope', async () => {
    const signal = new AbortController().signal
    expect((await executeOciComputeTool(call({ signal }))).status).toBe(200)
    expect(mocks.createClient).toHaveBeenCalledWith({
      credentialId: 'authoritative',
      workspaceId: 'workspace',
      serviceId: 'oci_compute',
      region: 'us-ashburn-1',
    })
    expect(mocks.execute).toHaveBeenCalledWith(
      { bound: true },
      'get_instance',
      expect.objectContaining({ instanceId: 'instance' }),
      signal
    )
  })

  it('does not accept payload workspace or compatibility token as authority', async () => {
    const response = await executeOciComputeTool(
      call({
        input: {
          oauthCredential: 'submitted',
          region: 'us-ashburn-1',
          instanceId: 'instance',
          workspaceId: 'other',
          accessToken: 'token',
        },
      })
    )
    expect(response.status).toBe(400)
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('rejects missing trusted context and denied credential use', async () => {
    expect((await executeOciComputeTool(call({ context: { workflowId: '' } }))).status).toBe(401)
    mocks.authorize.mockResolvedValue({ ok: false })
    expect((await executeOciComputeTool(call())).status).toBe(403)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
