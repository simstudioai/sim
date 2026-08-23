/**
 * @vitest-environment node
 *
 * The card's subblock set, checked against every real block rather than a fixture.
 *
 * `@/blocks/registry` is globally mocked for import cost, so these read `BLOCK_REGISTRY`
 * directly — the point of the sweep is that it sees the actual shipped block definitions.
 */
import { describe, expect, it } from 'vitest'
import { getCardSubBlocks } from '@/lib/workflows/blocks/canvas-card-fields'
import {
  buildCanonicalIndex,
  isCanonicalPair,
  shouldUseSubBlockForTriggerModeCanonicalIndex,
} from '@/lib/workflows/subblocks/visibility'
import { BLOCK_REGISTRY } from '@/blocks/registry-maps'
import type { BlockConfig } from '@/blocks/types'

/**
 * Blocks that are an action AND a trigger. Both surfaces live in one `subBlocks` array — the
 * block's own fields, then its trigger's spread in after them — which is what makes the two
 * able to interfere.
 */
const MIXED_SURFACE_BLOCKS = Object.values(BLOCK_REGISTRY).filter(
  (block) => block.triggers?.enabled && block.category !== 'triggers'
)

/**
 * A trigger-mode block with every trigger field filled, carrying the block-creation default
 * (`buildDefaultCanonicalModes`) of `'basic'` for every canonical pair.
 */
function triggerModeState(block: BlockConfig) {
  const values: Record<string, unknown> = {}
  for (const subBlock of block.subBlocks) {
    if (shouldUseSubBlockForTriggerModeCanonicalIndex(subBlock)) {
      values[subBlock.id] = 'configured-value'
    }
  }
  // A block offering several triggers conditions its fields on which one the user picked.
  const firstTrigger = block.triggers?.available?.[0]
  if (firstTrigger) values.selectedTriggerId = firstTrigger

  const canonicalModeOverrides: Record<string, 'basic' | 'advanced'> = {}
  for (const group of Object.values(buildCanonicalIndex(block.subBlocks).groupsById)) {
    if (isCanonicalPair(group)) canonicalModeOverrides[group.canonicalId] = 'basic'
  }
  return { values, canonicalModeOverrides }
}

function triggerCardIds(block: BlockConfig, subBlocks = block.subBlocks): string[] {
  const { values, canonicalModeOverrides } = triggerModeState(block)
  return getCardSubBlocks(
    { subBlocks, category: block.category, triggers: block.triggers },
    { advanced: false, values, canonicalModeOverrides, triggerMode: true }
  ).map((subBlock) => subBlock.id)
}

describe('getCardSubBlocks', () => {
  it('finds mixed action/trigger blocks to check', () => {
    expect(MIXED_SURFACE_BLOCKS.length).toBeGreaterThan(0)
  })

  /**
   * The invariant: a trigger card is a function of the trigger surface ALONE. Dropping the
   * block's action fields — which trigger mode never renders anyway — must not change what the
   * card shows.
   *
   * It used to, because the card indexed canonical groups over the whole array. The two surfaces
   * collide in both directions: by shared `canonicalParamId` under different ids (Webflow's
   * `triggerSiteId` joining the action `siteId` pair, eight blocks' `triggerCredentials` joining
   * `oauthCredential`) and by shared id (Airtable's trigger `baseId`/`tableId` inheriting the
   * action pair's group). Either way the trigger field matched neither the group's `basicId` nor
   * its `advancedIds`, so `isSubBlockVisibleForMode` dropped it — while the editor panel, which
   * did scope its index, showed the same field. Users configured fields the canvas then refused
   * to display, and the autolayout height estimate lost the rows too.
   *
   * Comparing against the same function on a reduced config, rather than a hand-written expected
   * set, is deliberate: a second model of "what is on a card" is what this module exists to
   * prevent, and it would drift the moment an unrelated filter changed.
   */
  describe.each(MIXED_SURFACE_BLOCKS.map((block) => [block.type, block] as const))(
    '%s in trigger mode',
    (_type, block) => {
      it('shows the same fields whether or not the action surface is present', () => {
        const triggerOnly = block.subBlocks.filter(shouldUseSubBlockForTriggerModeCanonicalIndex)
        expect(triggerCardIds(block)).toEqual(triggerCardIds(block, triggerOnly))
      })
    }
  )

  it('keeps a canonical pair on the trigger surface collapsed to its active member', () => {
    // Google Calendar's trigger owns a real pair (`calendarId` + `trigger-advanced`
    // `manualCalendarId`), so scoping must not flatten it into two visible rows.
    const googleCalendar = BLOCK_REGISTRY.google_calendar
    const onCard = triggerCardIds(googleCalendar)
    expect(onCard).toContain('calendarId')
    expect(onCard).not.toContain('manualCalendarId')
  })

  it('shows a trigger field whose canonical id is also an action pair', () => {
    const onCard = triggerCardIds(BLOCK_REGISTRY.webflow)
    expect(onCard).toEqual(expect.arrayContaining(['triggerCredentials', 'triggerSiteId']))
  })

  it('shows a trigger field whose id is also an action pair member', () => {
    // Airtable's trigger declares plain `baseId`/`tableId`, ids the action surface already uses
    // as the advanced members of its `baseId`/`tableId` pairs.
    const onCard = triggerCardIds(BLOCK_REGISTRY.airtable)
    expect(onCard).toEqual(expect.arrayContaining(['baseId', 'tableId']))
  })
})
