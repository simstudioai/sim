/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ token: vi.fn(), handler: vi.fn() }))
vi.mock('@/tools/registry', async () => {
  const { partialToolRegistry } = await import('@sim/testing/mocks/tool-registry.mock')
  return { tools: partialToolRegistry(await import('@/tools/oci_streaming')) }
})
vi.mock('@/executor/utils/credential-token', () => ({
  resolveExecutorCredentialToken: mocks.token,
}))
vi.mock('@/lib/internal/tool-operations/registry.server', () => ({
  getInternalToolOperationHandler: () => mocks.handler,
}))

import {
  buildSelectorContextFromValues,
  getSelectorContextSubBlocks,
} from '@/lib/selectors/context'
import { parseDependsOn } from '@/lib/workflows/subblocks/visibility'
import { OciStreamingBlock } from '@/blocks/blocks/oci_streaming'
import { executeTool } from '@/tools/index'
import { ociStreamingCreateCursorTool, ociStreamingGetMessagesTool } from '@/tools/oci_streaming'

describe('OCI Streaming execution mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handler.mockResolvedValue(
      Response.json({ success: true, output: { status: 200, messages: [], nextCursor: 'next' } })
    )
  })

  it('executes the named credential path without requesting a bearer token', async () => {
    const result = await executeTool(
      'oci_streaming_get_messages',
      {
        ociCredential: 'oci-service-account',
        streamId: 'stream-1',
        cursor: 'cursor-1',
      },
      {
        skipPostProcess: true,
        operationContext: {
          userId: 'actor-1',
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
        },
      }
    )
    expect(result.success).toBe(true)
    expect(mocks.token).not.toHaveBeenCalled()
    expect(mocks.handler).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          operation: 'get_messages',
          ociCredential: 'oci-service-account',
        }),
        context: expect.objectContaining({ userId: 'actor-1', workspaceId: 'workspace-1' }),
      })
    )
  })

  it.each(['basic', 'advanced'] as const)(
    'uses active %s selector credentials and pool context',
    (mode) => {
      const values = {
        operation: 'oci_streaming_get_stream',
        ociCredentialSelector: 'selected-credential',
        ociCredentialManual: '{{OCI_CREDENTIAL}}',
        streamPoolSelector: 'selected-pool',
        streamPoolManual: '{{OCI_POOL}}',
        compartmentId: 'compartment-1',
        ociRegion: '',
      }
      const contextConfigs = getSelectorContextSubBlocks(OciStreamingBlock.subBlocks, values)
      const selector = contextConfigs.find((config) => config.id === 'streamSelector')
      if (!selector) throw new Error('Expected stream selector')
      const context = (region: string) =>
        buildSelectorContextFromValues({
          selectorKey: 'oci_streaming.streams',
          contextConfigs,
          dependsOn: parseDependsOn(selector.dependsOn).allDependsOnFields,
          values: { ...values, ociRegion: region },
          canonicalModes: { ociCredential: mode, streamPoolId: mode },
        })
      expect(context('')).toEqual({
        oauthCredential: mode === 'basic' ? 'selected-credential' : '{{OCI_CREDENTIAL}}',
        streamPoolId: mode === 'basic' ? 'selected-pool' : '{{OCI_POOL}}',
      })
      expect(context('{{OCI_REGION}}')).toMatchObject({ ociRegion: '{{OCI_REGION}}' })
      expect(context('')).not.toHaveProperty('ociCredential')
      expect(context('')).not.toHaveProperty('compartmentId')
    }
  )

  it('projects only operation fields and preserves a decimal offset', () => {
    const input = ociStreamingCreateCursorTool.operation.input({
      ociCredential: 'credential',
      streamId: 'stream',
      partition: '0',
      type: 'AT_OFFSET',
      offset: '9007199254740993',
      ...{ _context: { userId: 'forged' }, endpoint: 'https://untrusted.example.com' },
    })
    expect(input).toMatchObject({ offset: '9007199254740993' })
    expect(input).not.toHaveProperty('_context')
    expect(input).not.toHaveProperty('endpoint')
    expect(ociStreamingGetMessagesTool.params).not.toHaveProperty('credential')
  })

  it('maps active canonical selections, optional defaults, and JSON only at execution time', () => {
    const map = OciStreamingBlock.tools.config?.params
    if (!map) throw new Error('Expected execution mapper')
    const params = {
      operation: 'oci_streaming_create_cursor',
      streamId: 'stream',
      partition: '0',
      type: 'AT_OFFSET',
      offset: '9007199254740993',
      limit: '',
    }
    expect(OciStreamingBlock.tools.config?.tool?.(params)).toBe('oci_streaming_create_cursor')
    expect(params.offset).toBe('9007199254740993')
    expect(map(params)).toMatchObject({ offset: '9007199254740993', limit: undefined })
    expect(
      map({
        operation: 'oci_streaming_create_stream',
        compartmentId: 'lookup-compartment',
        streamPoolId: 'selected-pool',
        partitions: '2',
      })
    ).toMatchObject({ streamPoolId: 'selected-pool', compartmentId: undefined, partitions: 2 })
    expect(
      map({
        operation: 'oci_streaming_update_stream',
        streamPoolId: 'lookup-pool',
        destinationStreamPoolId: 'destination-pool',
      })
    ).toMatchObject({ streamPoolId: 'destination-pool' })
    expect(
      map({ operation: 'oci_streaming_put_messages', messages: '[{"value":"event"}]' })
    ).toMatchObject({ messages: [{ value: 'event' }] })
  })
})
