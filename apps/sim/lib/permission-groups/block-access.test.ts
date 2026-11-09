import { afterEach, describe, expect, it } from 'vitest'
import {
  isAccessControlAllowlistRow,
  isBlockTypeAccessControlExempt,
} from '@/lib/permission-groups/block-access'
import { registerBlockOverlayResolver } from '@/blocks/custom/overlay'
import type { BlockConfig } from '@/blocks/types'

/**
 * Both halves of the decision come from the generated registry metadata (hidden types and
 * successors), so every id below is a real one whose real config the assertion depends on.
 */
afterEach(() => registerBlockOverlayResolver(null))

describe('isBlockTypeAccessControlExempt', () => {
  it('exempts the universal entry point', () => {
    expect(isBlockTypeAccessControlExempt('start_trigger')).toBe(true)
  })

  /**
   * The bypass this closes: a legacy block is fully functional, so an allowlist
   * naming only the current version used to be satisfied by the retired one.
   */
  it('does not exempt a superseded block, which is judged as its successor', () => {
    expect(isBlockTypeAccessControlExempt('slack')).toBe(false)
  })

  /**
   * A retired block with no successor has no row in the editor and nothing to
   * be permitted as, so denying it would break older workflows an admin could
   * not have rescued.
   */
  it('exempts a retired block with no successor', () => {
    expect(isBlockTypeAccessControlExempt('thinking')).toBe(true)
  })

  /**
   * The editor never offers `start_trigger` as an allowlist row, so a retired
   * entry point judged as its successor would be refused by every active
   * allowlist — breaking every saved workflow that still carries one.
   */
  it('exempts a retired entry point, whose successor is the universal one', () => {
    expect(isBlockTypeAccessControlExempt('starter')).toBe(true)
    expect(isBlockTypeAccessControlExempt('manual_trigger')).toBe(true)
  })

  /** A disabled custom block is hidden from the toolbar and has no successor, as `getBlock` reads it. */
  it('exempts a disabled custom block from the overlay, and not an enabled one', () => {
    const blocks: Record<string, Partial<BlockConfig>> = {
      custom_off: { type: 'custom_off', hideFromToolbar: true },
      custom_on: { type: 'custom_on', hideFromToolbar: false },
    }
    registerBlockOverlayResolver({
      get: (type) => blocks[type] as BlockConfig | undefined,
      all: () => [],
    })

    expect(isBlockTypeAccessControlExempt('custom_off')).toBe(true)
    expect(isBlockTypeAccessControlExempt('custom_on')).toBe(false)
  })
})

describe('isAccessControlAllowlistRow', () => {
  /**
   * The bug this closes: the editor renders only visible blocks but used to
   * materialize an allowlist from every non-exempt one. Unchecking `slack_v2`
   * on a previously-unrestricted group therefore wrote `slack` into the stored
   * list, and the runtime resolves `slack` to `slack_v2` — re-allowing exactly
   * the integration the admin had just denied.
   */
  it('is not a row for a superseded block, which has no row of its own', () => {
    expect(isAccessControlAllowlistRow('slack')).toBe(false)
    expect(isBlockTypeAccessControlExempt('slack')).toBe(false)
  })

  /** Exempt block types are decided by no row at all. */
  it('is not a row for an exempt block', () => {
    expect(isAccessControlAllowlistRow('thinking')).toBe(false)
    expect(isAccessControlAllowlistRow('start_trigger')).toBe(false)
  })
})
