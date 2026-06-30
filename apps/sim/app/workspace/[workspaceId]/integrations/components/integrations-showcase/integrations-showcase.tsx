import type { ComponentType } from 'react'
import { cn } from '@sim/emcn'
import { getBlock } from '@/blocks'
import { getTileIconColorClass } from '@/blocks/icon-color'

/**
 * URL-encoded SVG used as a mask to carve the bottom-right notch out of the
 * showcase's grid background, exposing the "Explore in chat" CTA underneath.
 */
const SHOWCASE_MASK_SVG = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 144"><path d="M0 0L192 0L192 92A12 12 0 0 1 180 104L60 104A12 12 0 0 0 48 116L48 132A12 12 0 0 1 36 144L0 144Z" fill="white"/></svg>'
)

/**
 * Composite `mask-image` value: a full-opacity gradient for the main area and
 * the encoded SVG for the right-edge notch.
 */
const SHOWCASE_MASK_IMAGE = `linear-gradient(white, white), url("data:image/svg+xml,${SHOWCASE_MASK_SVG}")`

/**
 * Hand-tuned SVG path that traces the showcase's outer border around the
 * bottom-right notch, half-pixel offset so it renders crisply at 1px stroke.
 */
const SHOWCASE_OUTLINE_PATH =
  'M 0 0.5 L 180 0.5 A 11.5 11.5 0 0 1 191.5 12 L 191.5 92 A 12 12 0 0 1 180 104 L 60 104 A 12 12 0 0 0 48 116 L 48 132 A 12 12 0 0 1 36 143.5 L 0 143.5'

/**
 * Fixed grid coordinates for the brand tiles displayed inside the showcase.
 * Coordinates are 1-based and match the 48px CSS grid.
 */
const SHOWCASE_TILES = [
  { id: 'slack', col: 2, row: 1 },
  { id: 'outlook', col: 5, row: 1 },
  { id: 'notion', col: 8, row: 1 },
  { id: 'linear', col: 10, row: 1 },
  { id: 'jira', col: 13, row: 1 },
  { id: 'google_calendar', col: 15, row: 1 },
  { id: 'airtable', col: 3, row: 2 },
  { id: 'hubspot', col: 7, row: 2 },
  { id: 'salesforce', col: 11, row: 2 },
  { id: 'microsoft_teams', col: 14, row: 2 },
  { id: 'google_sheets', col: 4, row: 3 },
  { id: 'asana', col: 6, row: 3 },
  { id: 'confluence', col: 8, row: 3 },
  { id: 'dropbox', col: 12, row: 3 },
] as const

/**
 * Resolves the brand background color for a block type from the block registry.
 * Returns `null` when the block is unknown or has no brand color configured.
 */
function resolveBrandTileBg(blockType: string): string | null {
  return getBlock(blockType)?.bgColor || null
}

interface IntegrationTileProps {
  blockType: string
  icon: ComponentType<{ className?: string }>
  framed?: boolean
}

/**
 * Brand-colored square tile that renders a block's icon. The unframed variant
 * is a 36px tile used in list rows and headers; the framed variant adds an
 * outer 44px halo used inside the showcase grid.
 */
export function IntegrationTile({ blockType, icon: Icon, framed = false }: IntegrationTileProps) {
  const brandBg = resolveBrandTileBg(blockType)

  if (!framed) {
    return (
      <div className='size-9 flex-shrink-0'>
        <div
          className='flex size-full items-center justify-center rounded-xl border border-[var(--border-1)] bg-[var(--bg)]'
          style={brandBg ? { background: brandBg } : undefined}
        >
          <Icon className={cn('size-5', getTileIconColorClass(brandBg))} />
        </div>
      </div>
    )
  }

  return (
    <div className='size-11 flex-shrink-0 rounded-xl border border-[var(--border-muted)] bg-[var(--surface-4)] p-[3px] shadow-sm dark:bg-[var(--surface-5)]'>
      <div
        className='flex size-full items-center justify-center rounded-[9px] border border-[var(--border-1)] bg-[var(--bg)]'
        style={brandBg ? { background: brandBg } : undefined}
      >
        <Icon className={cn('size-6', getTileIconColorClass(brandBg))} />
      </div>
    </div>
  )
}

/**
 * Decorative integrations grid: a notched, masked grid background populated
 * with a curated set of brand tiles. The bottom-right notch leaves room for an
 * "Explore in chat" CTA rendered by `ShowcaseWithExplore`.
 */
export function IntegrationsShowcase() {
  return (
    <div
      aria-hidden
      className='relative h-[144px] w-full overflow-hidden rounded-xl shadow-[var(--shadow-overlay)]'
    >
      <div
        className='absolute inset-0 bg-[var(--surface-4)] dark:bg-[var(--surface-5)]'
        style={{
          backgroundImage:
            'linear-gradient(to right, var(--border-1) 1px, transparent 1px), linear-gradient(to bottom, var(--border-1) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          WebkitMaskImage: SHOWCASE_MASK_IMAGE,
          maskImage: SHOWCASE_MASK_IMAGE,
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          WebkitMaskSize: 'calc(100% - 192px) 100%, 192px 144px',
          maskSize: 'calc(100% - 192px) 100%, 192px 144px',
          WebkitMaskPosition: 'top left, top right',
          maskPosition: 'top left, top right',
        }}
      >
        <div className='absolute inset-0 grid translate-x-[0.5px] translate-y-[0.5px] grid-cols-[repeat(auto-fill,48px)] grid-rows-[repeat(auto-fill,48px)]'>
          {SHOWCASE_TILES.map((tile) => {
            const block = getBlock(tile.id)
            if (!block) return null
            return (
              <div
                key={tile.id}
                style={{ gridColumnStart: tile.col, gridRowStart: tile.row }}
                className='m-0.5'
              >
                <IntegrationTile blockType={tile.id} icon={block.icon} framed />
              </div>
            )
          })}
        </div>
      </div>
      <div
        className='pointer-events-none absolute top-0 bottom-0 left-0 rounded-l-xl border border-[var(--border-muted)] border-r-0'
        style={{ width: 'calc(100% - 192px)' }}
      />
      <svg
        className='pointer-events-none absolute top-0 right-0'
        width='192'
        height='144'
        viewBox='0 0 192 144'
        fill='none'
      >
        <path d={SHOWCASE_OUTLINE_PATH} stroke='var(--border-muted)' strokeWidth='1' />
      </svg>
    </div>
  )
}
