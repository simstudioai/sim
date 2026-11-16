/**
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

/**
 * An agent tool call sends model args under the tool's param names (`name` for a trail) with the
 * operation only on `context`; the handler forwards `{ ...args, ...mapped }`.
 */
describe('CloudTrail agent tool calls', () => {
  it('keeps the model trail name for get_trail', () => {
    const args = {
      awsRegion: 'us-east-1',
      awsAccessKeyId: 'AKIA',
      awsSecretAccessKey: 'secret',
      name: 'org-trail',
    }
    expect({
      ...args,
      ...CloudTrailBlock.tools.config?.params?.(args, { operation: 'get_trail' }),
    }).toMatchObject({ name: 'org-trail' })
  })
})
