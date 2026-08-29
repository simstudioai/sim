/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isBlockTypeAccessControlExempt,
  resolveAccessControlBlockType,
} from '@/lib/permission-groups/block-access'
import { getBlock } from '@/blocks/registry'

const mockGetBlock = getBlock as unknown as ReturnType<typeof vi.fn>

interface FakeBlock {
  hideFromToolbar?: boolean
  sunset?: { status: 'legacy' | 'deprecated'; replacedBy?: string }
}

function registry(blocks: Record<string, FakeBlock>) {
  mockGetBlock.mockImplementation((type: string) => blocks[type])
}

describe('resolveAccessControlBlockType', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('judges a superseded block as its successor', () => {
    registry({
      slack: { hideFromToolbar: true, sunset: { status: 'legacy', replacedBy: 'slack_v2' } },
      slack_v2: {},
    })

    expect(resolveAccessControlBlockType('slack')).toBe('slack_v2')
  })

  it('follows a chain of successors to the current version', () => {
    registry({
      a: { hideFromToolbar: true, sunset: { status: 'legacy', replacedBy: 'b' } },
      b: { hideFromToolbar: true, sunset: { status: 'legacy', replacedBy: 'c' } },
      c: {},
    })

    expect(resolveAccessControlBlockType('a')).toBe('c')
  })

  it('stops rather than looping when successors point at each other', () => {
    registry({
      a: { sunset: { status: 'legacy', replacedBy: 'b' } },
      b: { sunset: { status: 'legacy', replacedBy: 'a' } },
    })

    expect(resolveAccessControlBlockType('a')).toBe('b')
  })

  it('keeps its own identity when the named successor is not registered', () => {
    registry({ a: { sunset: { status: 'legacy', replacedBy: 'gone' } } })

    expect(resolveAccessControlBlockType('a')).toBe('a')
  })

  it('leaves a current block alone', () => {
    registry({ slack_v2: {} })

    expect(resolveAccessControlBlockType('slack_v2')).toBe('slack_v2')
  })
})

describe('isBlockTypeAccessControlExempt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exempts the universal entry point', () => {
    registry({})

    expect(isBlockTypeAccessControlExempt('start_trigger')).toBe(true)
  })

  /**
   * The bypass this closes: a legacy block is fully functional, so an allowlist
   * naming only the current version used to be satisfied by the retired one.
   */
  it('does not exempt a superseded block, which is judged as its successor', () => {
    registry({
      slack: { hideFromToolbar: true, sunset: { status: 'legacy', replacedBy: 'slack_v2' } },
      slack_v2: {},
    })

    expect(isBlockTypeAccessControlExempt('slack')).toBe(false)
  })

  /**
   * A retired block with no successor has no row in the editor and nothing to
   * be permitted as, so denying it would break older workflows an admin could
   * not have rescued.
   */
  it('exempts a retired block with no successor', () => {
    registry({ thinking: { hideFromToolbar: true } })

    expect(isBlockTypeAccessControlExempt('thinking')).toBe(true)
  })

  it('does not exempt a current block', () => {
    registry({ slack_v2: {} })

    expect(isBlockTypeAccessControlExempt('slack_v2')).toBe(false)
  })
})
