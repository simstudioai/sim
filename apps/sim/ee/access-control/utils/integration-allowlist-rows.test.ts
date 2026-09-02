/**
 * @vitest-environment node
 *
 * The universe below is the editor's row set, which excludes superseded blocks
 * (`isAccessControlAllowlistRow`). Every id is a real one, so the assertions
 * rest on the repository's own lifecycle facts: `slack` was replaced by
 * `slack_v2`.
 */
import { describe, expect, it } from 'vitest'
import {
  allowlistRowsFromStored,
  toggleAllowlistRow,
  withAllowlistRows,
} from '@/ee/access-control/utils/integration-allowlist-rows'

const UNIVERSE = ['agent', 'notion_v2', 'slack_v2'] as const

describe('allowlistRowsFromStored', () => {
  it('keeps an unrestricted allowlist unrestricted', () => {
    expect(allowlistRowsFromStored(UNIVERSE, null)).toBeNull()
  })

  /**
   * The runtime resolves a stored `slack` to `slack_v2` and allows it, so the
   * row has to render checked or the editor is lying about what is permitted.
   */
  it('reads a stored retired id as the row it actually governs', () => {
    const rows = allowlistRowsFromStored(UNIVERSE, ['slack'])

    expect(rows?.has('slack_v2')).toBe(true)
    expect(rows?.has('slack')).toBe(false)
  })

  it('drops an id no row corresponds to', () => {
    expect([...(allowlistRowsFromStored(UNIVERSE, ['agent', 'retired_thing']) ?? [])]).toEqual([
      'agent',
    ])
  })
})

describe('toggleAllowlistRow', () => {
  /**
   * The bug this closes. The editor renders only current blocks, so narrowing a
   * previously-unrestricted allowlist used to materialize the hidden `slack`
   * alongside the rows — and the runtime resolves `slack` back to `slack_v2`,
   * re-allowing the integration the admin had just denied.
   */
  it('does not leave a superseded id behind when a row is denied', () => {
    const next = toggleAllowlistRow(UNIVERSE, null, 'slack_v2')

    expect(next).toEqual(['agent', 'notion_v2'])
    expect(allowlistRowsFromStored(UNIVERSE, next)?.has('slack_v2')).toBe(false)
  })

  /** A stored retired id must follow its successor's fate, not outlive it. */
  it('denies a row a stored retired id was granting', () => {
    const next = toggleAllowlistRow(UNIVERSE, ['agent', 'slack'], 'slack_v2')

    expect(next).toEqual(['agent'])
  })

  it('grants a row that was not allowed', () => {
    expect(toggleAllowlistRow(UNIVERSE, ['agent'], 'notion_v2')).toEqual(['agent', 'notion_v2'])
  })

  /** Permitting everything is stored as "no restriction", not as a frozen list. */
  it('collapses back to unrestricted when the last row is granted', () => {
    expect(toggleAllowlistRow(UNIVERSE, ['agent', 'notion_v2'], 'slack_v2')).toBeNull()
  })
})

describe('withAllowlistRows', () => {
  it('denies a whole section at once', () => {
    expect(withAllowlistRows(UNIVERSE, null, ['notion_v2', 'slack_v2'], false)).toEqual(['agent'])
  })

  it('emits rows in universe order however the section is ordered', () => {
    expect(withAllowlistRows(UNIVERSE, [], ['slack_v2', 'agent'], true)).toEqual([
      'agent',
      'slack_v2',
    ])
  })

  it('collapses to unrestricted when a section grant covers every row', () => {
    expect(withAllowlistRows(UNIVERSE, ['agent'], [...UNIVERSE], true)).toBeNull()
  })
})
