import type { ReactNode } from 'react'

/**
 * The canonical settings "resource row": a rounded-bordered icon tile, a
 * title + muted description text block, and an optional trailing slot
 * (action chips, a {@link RowActionsMenu}, a status label, etc.).
 *
 * Single source of truth for the credential-style row shared by the BYOK key
 * manager, credential sets, and recently-deleted lists — never re-derive the
 * tile/text chrome per consumer. The tile force-sizes any `<svg>`/`<img>` it
 * contains to 20px, so callers pass their raw icon node without pre-sizing it.
 */
interface SettingsResourceRowProps {
  /** Icon node centered in the tile; any `<svg>`/`<img>` is normalized to 20px. */
  icon: ReactNode
  /** Primary line — truncates. */
  title: ReactNode
  /** Secondary muted line — truncates. */
  description?: ReactNode
  /** Trailing element pinned to the row's end (chips, actions menu, status). */
  trailing?: ReactNode
}

const TILE_CLASS =
  'flex size-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--border-1)] bg-[var(--bg)] [&_img]:size-5 [&_svg]:size-5'

export function SettingsResourceRow({
  icon,
  title,
  description,
  trailing,
}: SettingsResourceRowProps) {
  return (
    <div className='flex items-center justify-between gap-2.5'>
      <div className='flex min-w-0 items-center gap-2.5'>
        <div className={TILE_CLASS}>{icon}</div>
        <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
          <span className='truncate text-[14px] text-[var(--text-body)]'>{title}</span>
          {description != null && (
            <span className='truncate text-[12px] text-[var(--text-muted)]'>{description}</span>
          )}
        </div>
      </div>
      {trailing}
    </div>
  )
}
