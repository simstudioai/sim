/**
 * @vitest-environment node
 *
 * A `checkbox-list` groups several boolean tool params behind one field. Its stored
 * value therefore projects onto its OPTION ids, not onto its own id — which no tool
 * declares.
 *
 * Before this projection existed the control wrote each option id as its own top-level
 * store key, and this loop dropped every one of them because no sub-block config
 * matched. `jina.gatherLinks` and `pinecone.includeMetadata` never reached their tools
 * on any surface.
 */
import { toolsMetadataMock, toolsUtilsMock } from '@sim/testing/mocks'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/blocks', async () => {
  const { createMockGetBlock } = await import('@sim/testing/mocks')
  return {
    getBlock: createMockGetBlock({
      fixture: {
        name: 'Fixture',
        description: '',
        category: 'tools',
        subBlocks: [
          {
            id: 'scanOptions',
            title: 'Options',
            type: 'checkbox-list',
            options: [
              { label: 'Gather Links', id: 'gatherLinks' },
              { label: 'No Cache', id: 'noCache' },
              { label: 'Include Values', id: 'includeValues', defaultChecked: true },
            ],
          },
        ],
        tools: { access: ['fixture_tool'] },
        inputs: {},
        outputs: {},
      },
    }),
  }
})

vi.mock('@/tools/metadata', () => toolsMetadataMock)
vi.mock('@/tools/utils', () => toolsUtilsMock)

import { Serializer } from '@/serializer'

function serializeOptions(value: unknown): Record<string, unknown> {
  const blocks = {
    b1: {
      id: 'b1',
      type: 'fixture',
      name: 'Fixture',
      position: { x: 0, y: 0 },
      enabled: true,
      outputs: {},
      subBlocks: { scanOptions: { id: 'scanOptions', type: 'checkbox-list', value } },
    },
  } as never

  return new Serializer().serializeWorkflow(blocks, [], {}, {}).blocks[0].config.params
}

describe('checkbox-list serialization', () => {
  it('projects each ticked option onto its own tool param', () => {
    const params = serializeOptions({ gatherLinks: true, noCache: false })

    expect(params.gatherLinks).toBe(true)
    expect(params.noCache).toBe(false)
  })

  it('never emits the container id, which no tool declares', () => {
    expect(serializeOptions({ gatherLinks: true })).not.toHaveProperty('scanOptions')
  })

  it('omits an untouched option instead of sending false', () => {
    const params = serializeOptions(null)

    expect(params).not.toHaveProperty('gatherLinks')
    expect(params).not.toHaveProperty('noCache')
  })

  it('sends an option that declares a default even when untouched', () => {
    expect(serializeOptions(null).includeValues).toBe(true)
  })

  it('lets an explicit choice override that default', () => {
    expect(serializeOptions({ includeValues: false }).includeValues).toBe(false)
  })
})
