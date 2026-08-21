/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  CUSTOM_BLOCK_IMAGE_TILE_COLOR,
  CUSTOM_BLOCK_TILE_COLOR,
} from '@/blocks/custom/build-config'
// client-boundary-allow: vitest ignores the 'use client' directive; this node-env test exercises the module directly
import { DefaultCustomBlockIcon, getCustomBlockTile } from '@/blocks/custom/custom-block-icon'

describe('getCustomBlockTile', () => {
  it('puts an uploaded logo on the light provider plate', () => {
    const tile = getCustomBlockTile('https://cdn.example/logo.png', null)

    expect(tile.bgColor).toBe(CUSTOM_BLOCK_IMAGE_TILE_COLOR)
    expect(tile.icon).not.toBe(DefaultCustomBlockIcon)
  })

  it('falls back to the org whitelabel logo, which is still an image', () => {
    const tile = getCustomBlockTile(null, 'https://cdn.example/org.png')

    expect(tile.bgColor).toBe(CUSTOM_BLOCK_IMAGE_TILE_COLOR)
    expect(tile.icon).not.toBe(DefaultCustomBlockIcon)
  })

  /**
   * The glyph is drawn in the tile's foreground colour, so it needs the neutral
   * fill behind it — the white plate would leave it invisible.
   */
  it('keeps the default glyph on the neutral tile', () => {
    const tile = getCustomBlockTile(null, null)

    expect(tile.bgColor).toBe(CUSTOM_BLOCK_TILE_COLOR)
    expect(tile.icon).toBe(DefaultCustomBlockIcon)
  })

  /** An empty string is not a logo — it must not select the image plate. */
  it('treats an empty icon url as no icon', () => {
    expect(getCustomBlockTile('', '').bgColor).toBe(CUSTOM_BLOCK_TILE_COLOR)
  })

  it('reuses one component per url so node identity stays stable across renders', () => {
    const first = getCustomBlockTile('https://cdn.example/logo.png', null)
    const second = getCustomBlockTile('https://cdn.example/logo.png', null)

    expect(first.icon).toBe(second.icon)
  })
})
