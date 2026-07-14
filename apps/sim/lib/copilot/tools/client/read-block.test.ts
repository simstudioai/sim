/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { getReadTargetBlock } from '@/lib/copilot/tools/client/read-block'

const gmailBlock = { type: 'gmail_v2', name: 'Gmail', icon: () => null }

vi.mock('@/blocks/registry', () => ({
  getBlock: vi.fn((type: string) => (type === 'gmail_v2' ? gmailBlock : undefined)),
  getLatestBlock: vi.fn((baseType: string) => (baseType === 'gmail' ? gmailBlock : undefined)),
}))

describe('getReadTargetBlock', () => {
  it('resolves a block schema read to its block', () => {
    expect(getReadTargetBlock('components/blocks/gmail_v2.json')?.name).toBe('Gmail')
  })

  it('resolves integration operation and service-directory reads to the latest service block', () => {
    expect(getReadTargetBlock('components/integrations/gmail/send.json')?.name).toBe('Gmail')
    expect(getReadTargetBlock('components/integrations/gmail')?.name).toBe('Gmail')
  })

  it('returns undefined for unknown blocks and non-component paths', () => {
    expect(getReadTargetBlock('components/blocks/unknown_block.json')).toBeUndefined()
    expect(getReadTargetBlock('workflows/My Workflow/meta.json')).toBeUndefined()
    expect(getReadTargetBlock('files/gmail_v2.json')).toBeUndefined()
    expect(getReadTargetBlock(undefined)).toBeUndefined()
  })
})
