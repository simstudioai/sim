import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'

/**
 * The canonical settings "resource row": a rounded-bordered icon tile, a
 * title + muted description text block, and an optional trailing slot
 * (action chips, a {@link RowActionsMenu}, a status label, etc.).
 *
 * Single source of truth for the credential-style row shared by the BYOK key
 * manager and recently-deleted lists — never re-derive the
 * tile/text chrome per consumer. The tile force-sizes any `<svg>`/`<img>` it
 * contains to 20px, so callers pass their raw icon node without pre-sizing it.
 */
interface SettingsResourceRowProps {
  /** Icon node centered in the tile; a `<svg>` is normalized to 20px, an `<img>` to 20px (or the full tile when `iconFill`). */
  icon: ReactNode
  /**
   * Icon chrome. `tile` (default) is the bordered 36px tile for brand/logo and
   * resource icons; `plain` drops the tile for a bare 14px glyph in
   * `--text-icon`, for rows whose icon is a type marker rather than an identity
   * (e.g. a folder on disk).
   */
  iconVariant?: 'tile' | 'plain'
  /**
   * Let an image icon fill the tile edge-to-edge instead of clamping to 20px.
   * Use for uploaded image/logo icons (e.g. custom blocks); glyph `<svg>`s still
   * normalize to 20px so a fallback icon doesn't balloon. Tile variant only.
   */
  iconFill?: boolean
  /** Primary line — truncates. */
  title: ReactNode
  /** Secondary muted line — truncates. */
  description?: ReactNode
  /** Trailing element pinned to the row's end (chips, actions menu, status). */
  trailing?: ReactNode
  /**
   * Makes the icon + text cluster activatable. `trailing` stays a sibling, so
   * its own controls keep working — never nest an interactive `trailing` inside
   * the row's own hit area.
   */
  onClick?: () => void
  /** Accessible name for the activatable cluster. Required alongside `onClick`. */
  clickLabel?: string
}

const TILE_BASE =
  'flex size-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--border-1)] bg-[var(--bg)] [&_svg]:size-5'

const PLAIN_BASE =
  'flex size-[14px] flex-shrink-0 items-center justify-center text-[var(--text-icon)] [&_svg]:size-[14px] [&_img]:size-[14px]'

export function SettingsResourceRow({
  icon,
  iconVariant = 'tile',
  iconFill = false,
  title,
  description,
  trailing,
  onClick,
  clickLabel,
}: SettingsResourceRowProps) {
  const isTile = iconVariant === 'tile'
  const cluster = (
    <>
      <div
        className={
          isTile ? cn(TILE_BASE, iconFill ? '[&_img]:size-full' : '[&_img]:size-5') : PLAIN_BASE
        }
      >
        {icon}
      </div>
      <div className='flex min-w-0 flex-col justify-center gap-[1px] text-left'>
        <span className='truncate text-[var(--text-body)] text-sm'>{title}</span>
        {description != null && (
          <span className='truncate text-[var(--text-muted)] text-caption'>{description}</span>
        )}
      </div>
    </>
  )
  const clusterClass = cn('flex min-w-0 items-center', isTile ? 'gap-2.5' : 'gap-2')

  return (
    <div className='flex items-center justify-between gap-2.5'>
      {onClick ? (
        <button
          type='button'
          onClick={onClick}
          aria-label={clickLabel}
          className={cn(
            clusterClass,
            '-mx-2 cursor-pointer rounded-md px-2 py-1 transition-colors hover-hover:bg-[var(--surface-4)] focus:outline-none'
          )}
        >
          {cluster}
        </button>
      ) : (
        <div className={clusterClass}>{cluster}</div>
      )}
      {trailing}
    </div>
  )
}
