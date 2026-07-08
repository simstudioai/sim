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
   * Let an image icon fill the tile edge-to-edge instead of clamping to 20px.
   * Use for uploaded image/logo icons (e.g. custom blocks); glyph `<svg>`s still
   * normalize to 20px so a fallback icon doesn't balloon.
   */
  iconFill?: boolean
  /** Primary line — truncates. */
  title: ReactNode
  /** Secondary muted line — truncates. */
  description?: ReactNode
  /** Trailing element pinned to the row's end (chips, actions menu, status). */
  trailing?: ReactNode
}

const TILE_BASE =
  'flex size-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--border-1)] bg-[var(--bg)] [&_svg]:size-5'

export function SettingsResourceRow({
  icon,
  iconFill = false,
  title,
  description,
  trailing,
}: SettingsResourceRowProps) {
  return (
    <div className='flex items-center justify-between gap-2.5'>
      <div className='flex min-w-0 items-center gap-2.5'>
        <div className={cn(TILE_BASE, iconFill ? '[&_img]:size-full' : '[&_img]:size-5')}>
          {icon}
        </div>
        <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
          <span className='truncate text-[var(--text-body)] text-sm'>{title}</span>
          {description != null && (
            <span className='truncate text-[var(--text-muted)] text-caption'>{description}</span>
          )}
        </div>
      </div>
      {trailing}
    </div>
  )
}
