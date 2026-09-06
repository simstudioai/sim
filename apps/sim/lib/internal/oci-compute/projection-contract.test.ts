import { describe, expect, it } from 'vitest'
import { OciComputeBlock } from '@/blocks/blocks/oci_compute'
import { projectOciComputeResource } from '@/lib/internal/oci-compute/operations'
import {
  INSTANCE_OUTPUT_PROPERTIES,
  ociComputeOperationInput,
} from '@/tools/oci_compute/types'

describe('OCI Compute input and resource projections', () => {
  it('preserves runtime references while removing compatibility and authorization extras', () => {
    const input = ociComputeOperationInput({
      oauthCredential: 'credential', region: 'us-ashburn-1', imageId: '<image.output.id>',
      accessToken: 'compatibility', workspaceId: 'untrusted', retryToken: 'explicit',
      _context: { executionId: 'execution', blockId: 'block', invocationId: 'call' },
    }, ['imageId', 'retryToken'])
    expect(input).toEqual({
      oauthCredential: 'credential', region: 'us-ashburn-1', imageId: '<image.output.id>',
      retryToken: 'explicit',
      deliveryIdentity: { executionId: 'execution', blockId: 'block', invocationId: 'call' },
    })
  })

  it('projects documented fields and excludes metadata and arbitrary provider additions', () => {
    const result = projectOciComputeResource({
      id: 'instance', lifecycleState: 'PROVISIONING', shapeConfig: { ocpus: 2, providerExtra: 'hidden' },
      metadata: { user_data: 'private' }, providerExtra: 'hidden',
    }, INSTANCE_OUTPUT_PROPERTIES)
    expect(result).toMatchObject({ id: 'instance', lifecycleState: 'PROVISIONING', shapeConfig: { ocpus: 2 } })
    expect(result).not.toHaveProperty('metadata')
    expect(result).not.toHaveProperty('providerExtra')
    expect(result.shapeConfig).not.toHaveProperty('providerExtra')
  })

  it('normalizes block values only after reference resolution and keeps meaningful false/zero/empty values', () => {
    const normalize = OciComputeBlock.tools.config!.params!
    const values = normalize({
      operation: 'oci_compute_update_instance_pool', size: '0',
      isAutoTerminate: 'false', instanceDisplayNameFormatter: '',
    })
    expect(values).toMatchObject({ size: 0, isAutoTerminate: false, instanceDisplayNameFormatter: '' })
    const selectTool = OciComputeBlock.tools.config!.tool
    expect(selectTool({ operation: 'oci_compute_launch_instance', imageId: '<image.output.id>' }))
      .toBe('oci_compute_launch_instance')
  })
})
