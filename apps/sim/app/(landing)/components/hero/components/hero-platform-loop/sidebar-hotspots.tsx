'use client'

import { Tooltip } from '@sim/emcn'

/**
 * Cursor-to-bubble gap for tooltips over the mini platform UI - tighter than
 * the product-standard 16px so the bubble hugs the cursor proportionately to
 * the scaled-down preview.
 */
export const HERO_TOOLTIP_OFFSET = 8

/** Percent-of-image bounds shared by both hotspot kinds. */
interface HotspotBounds {
  left: string
  top: string
  width: string
  height: string
}

/** An icon control that shows a tooltip on hover, like the real product. */
interface TooltipHotspot extends HotspotBounds {
  label: string
}

/** A sidebar nav row that shows the real row-hover highlight on hover. */
interface RowHotspot extends HotspotBounds {
  name: string
}

/**
 * Icon controls measured from the capture (2560x1470): the collapse-sidebar
 * toggle (x428-468, y36-72) and the Workflows section's "More actions"
 * ellipsis (x376-412) and "Create workflow" plus (x424-460) at y920-952.
 * Copy matches the real product's tooltips.
 */
const TOOLTIP_HOTSPOTS: TooltipHotspot[] = [
  { label: 'Collapse sidebar', left: '16.72%', top: '2.45%', width: '1.56%', height: '2.45%' },
  { label: 'More actions', left: '14.69%', top: '62.59%', width: '1.4%', height: '2.18%' },
  { label: 'Create workflow', left: '16.56%', top: '62.59%', width: '1.4%', height: '2.18%' },
]

/**
 * Workspace nav rows (Tables / Files / Knowledge base), boxed like the real
 * sidebar row (`h-[30px] rounded-lg`, text rows measured at y598-616, 662-680,
 * 726-750): a 60px-tall (at 2x) highlight box centered on each row's text,
 * starting left of the row ICON (icons measured at x37-39, the box carries the
 * real row's 8px icon gutter) so the icon sits inside the highlight.
 */
const ROW_HOTSPOTS: RowHotspot[] = [
  { name: 'Tables', left: '0.82%', top: '39.25%', width: '17.15%', height: '4.08%' },
  { name: 'Files', left: '0.82%', top: '43.61%', width: '17.15%', height: '4.08%' },
  { name: 'Knowledge base', left: '0.82%', top: '48.16%', width: '17.15%', height: '4.08%' },
]

/**
 * Hover layers over the BAKED sidebar pixels. Icon controls (collapse toggle,
 * Workflows more/create) get transparent targets wired to the emcn
 * {@link Tooltip} with the product's real copy ({@link HERO_TOOLTIP_OFFSET}
 * keeps the bubble close over the mini UI). The Workspace nav rows instead
 * reproduce the REAL sidebar row-hover state - `--surface-active` on the
 * row's rounded box - via `mix-blend-multiply`, which paints over the baked
 * white/text pixels to exactly the result of a background behind the text.
 */
export function SidebarHotspots() {
  return (
    <div aria-hidden='true' className='pointer-events-none absolute inset-0'>
      {TOOLTIP_HOTSPOTS.map((spot) => (
        <Tooltip.Root key={spot.label}>
          <Tooltip.Trigger asChild>
            <span
              aria-label={spot.label}
              className='pointer-events-auto absolute block'
              style={{ left: spot.left, top: spot.top, width: spot.width, height: spot.height }}
            />
          </Tooltip.Trigger>
          <Tooltip.Content offset={HERO_TOOLTIP_OFFSET}>{spot.label}</Tooltip.Content>
        </Tooltip.Root>
      ))}
      {ROW_HOTSPOTS.map((row) => (
        <span
          key={row.name}
          aria-label={row.name}
          className='pointer-events-auto absolute block cursor-pointer rounded-[6px] mix-blend-multiply transition-colors duration-100 hover:bg-[var(--surface-active)]'
          style={{ left: row.left, top: row.top, width: row.width, height: row.height }}
        />
      ))}
    </div>
  )
}
