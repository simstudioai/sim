/**
 * @vitest-environment node
 *
 * A dropdown subBlock with no `value()` seeds and persists its first selectable option,
 * so a block's *default* configuration is not necessarily one that runs. These tests
 * exercise the default the user actually gets on drop, which no other suite covers.
 */
import { describe, expect, it } from 'vitest'
import { CloudTrailBlock } from '@/blocks/blocks/cloudtrail'

type SubBlock = (typeof CloudTrailBlock.subBlocks)[number]

function subBlock(id: string): SubBlock {
  const found = CloudTrailBlock.subBlocks.find((block) => block.id === id)
  if (!found) throw new Error(`missing subBlock ${id}`)
  return found
}

/** Mirrors the dropdown's seeding rule: an explicit `value()` wins, else the first option. */
function seededValue(block: SubBlock): unknown {
  if (typeof block.value === 'function') return block.value()
  const options = block.options
  if (!Array.isArray(options)) return undefined
  const first = options[0] as { id?: unknown } | undefined
  return first?.id
}

describe('CloudTrail block defaults', () => {
  it('seeds no lookup filter attribute, so the default run is unfiltered', () => {
    expect(seededValue(subBlock('attributeKey'))).toBe('')
  })

  it('offers a selectable no-filter option so the choice can be undone', () => {
    const options = subBlock('attributeKey').options as Array<{ id: string; label: string }>
    expect(options[0]).toMatchObject({ id: '' })
    expect(options.filter((option) => option.id === '')).toHaveLength(1)
  })

  it('does not throw on the configuration a freshly dropped block produces', () => {
    const params = {
      operation: 'lookup_events',
      awsRegion: 'us-east-1',
      awsAccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      awsSecretAccessKey: 'secret',
      attributeKey: seededValue(subBlock('attributeKey')),
      attributeValue: '',
    }

    expect(() => CloudTrailBlock.tools.config?.params?.(params)).not.toThrow()
  })

  it('still rejects a half-supplied filter', () => {
    const params = {
      operation: 'lookup_events',
      awsRegion: 'us-east-1',
      awsAccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      awsSecretAccessKey: 'secret',
      attributeKey: 'Username',
      attributeValue: '',
    }

    expect(() => CloudTrailBlock.tools.config?.params?.(params)).toThrow(/filter/i)
  })
})
