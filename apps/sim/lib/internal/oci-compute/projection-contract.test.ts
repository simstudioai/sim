import { describe, expect, it } from 'vitest'
import { projectOciComputeResource } from '@/lib/internal/oci-compute/operations'
import {
  buildSelectorContextFromValues,
  getSelectorContextSubBlocks,
} from '@/lib/selectors/context'
import { OciComputeBlock } from '@/blocks/blocks/oci_compute'
import { INSTANCE_OUTPUT_PROPERTIES, ociComputeOperationInput } from '@/tools/oci_compute/types'

describe('OCI Compute input and resource projections', () => {
  it('keeps resource discovery in the source compartment without falling back to the destination', () => {
    const selector = OciComputeBlock.subBlocks.find((field) => field.id === 'instanceIdSelector')!
    const contextFor = (resourceCompartmentId: string | undefined) => {
      const values = {
        operation: 'oci_compute_change_instance_compartment',
        credential: 'credential',
        region: 'us-ashburn-1',
        compartmentSelector: 'destination',
        resourceCompartmentId,
      }
      return buildSelectorContextFromValues({
        selectorKey: 'oci_compute.instances',
        contextConfigs: getSelectorContextSubBlocks(OciComputeBlock.subBlocks, values),
        values,
        dependsOn: selector.dependsOn,
      })
    }
    expect(contextFor('source').compartmentId).toBe('source')
    expect(contextFor(undefined).compartmentId).toBeUndefined()
    expect(contextFor('<previous.output>').compartmentId).toBeUndefined()
    expect(contextFor('{{RESOURCE_COMPARTMENT}}').compartmentId).toBe('{{RESOURCE_COMPARTMENT}}')
  })

  it('preserves runtime references while removing compatibility and authorization extras', () => {
    const input = ociComputeOperationInput(
      {
        oauthCredential: 'credential',
        region: 'us-ashburn-1',
        imageId: '<image.output.id>',
        accessToken: 'compatibility',
        workspaceId: 'untrusted',
        retryToken: 'explicit',
        _context: { executionId: 'execution', blockId: 'block', invocationId: 'call' },
      },
      ['imageId', 'retryToken']
    )
    expect(input).toEqual({
      oauthCredential: 'credential',
      region: 'us-ashburn-1',
      imageId: '<image.output.id>',
      retryToken: 'explicit',
      deliveryIdentity: { executionId: 'execution', blockId: 'block', invocationId: 'call' },
    })
  })

  it('projects documented fields and excludes metadata and arbitrary provider additions', () => {
    const result = projectOciComputeResource(
      {
        id: 'instance',
        lifecycleState: 'PROVISIONING',
        shapeConfig: { ocpus: 2, providerExtra: 'hidden' },
        metadata: { user_data: 'private' },
        providerExtra: 'hidden',
      },
      INSTANCE_OUTPUT_PROPERTIES
    )
    expect(result).toMatchObject({
      id: 'instance',
      lifecycleState: 'PROVISIONING',
      shapeConfig: { ocpus: 2 },
    })
    expect(result).not.toHaveProperty('metadata')
    expect(result).not.toHaveProperty('providerExtra')
    expect(result.shapeConfig).not.toHaveProperty('providerExtra')
  })

  it('normalizes block values only after reference resolution and keeps meaningful false/zero/empty values', () => {
    const normalize = OciComputeBlock.tools.config!.params!
    const values = normalize({
      operation: 'oci_compute_update_instance_pool',
      size: '0',
      isAutoTerminate: 'false',
      instanceDisplayNameFormatter: '',
    })
    expect(values).toMatchObject({
      size: 0,
      instanceDisplayNameFormatter: '',
    })
    expect(values).not.toHaveProperty('isAutoTerminate')
    expect(
      normalize({
        operation: 'oci_compute_detach_instance_pool_instance',
        isAutoTerminate: 'false',
      })
    ).toMatchObject({ isAutoTerminate: false })
    const selectTool = OciComputeBlock.tools.config!.tool
    expect(
      selectTool({ operation: 'oci_compute_launch_instance', imageId: '<image.output.id>' })
    ).toBe('oci_compute_launch_instance')
  })
})
