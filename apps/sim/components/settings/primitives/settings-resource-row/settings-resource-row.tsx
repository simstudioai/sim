import { type ReactNode, useId } from 'react'
import { cn, OverflowText } from '@sim/emcn-legacy'
import { RESOURCE_TILE_BASE, RESOURCE_TILE_PLAIN } from '@/components/resource-tile'

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
  /**
   * Icon node centered in the tile; a `<svg>` or `<img>` is normalized to 20px. Omit it for rows whose resource has no
   * identity glyph (an API key, a permission group) — the row then leads with text.
   */
  icon?: ReactNode
  /**
   * Icon chrome. `tile` (default) is the bordered 36px tile for brand/logo and
   * resource icons; `plain` drops the tile for a bare 14px glyph in
   * `--text-icon`, for rows whose icon is a type marker rather than an identity
   * (e.g. a folder on disk); `custom` renders `icon` verbatim, for callers that
   * must supply their own tile (e.g. the brand-tinted `IntegrationTile`).
   */
  iconVariant?: 'tile' | 'plain' | 'custom'
  /** Primary line — truncates. */
  title: ReactNode
  /** Secondary muted line — truncates. */
  description?: ReactNode
  /**
   * Interactive controls pinned to the row's end (chips, actions menu). These sit
   * ABOVE the row's own hit area, so their clicks are theirs. The row keeps them at
   * their natural size — callers never need their own `shrink-0`.
   *
   * Decorative trailing content (a status badge, a tag) belongs in {@link badge}:
   * anything placed here swallows clicks meant for the row.
   */
  trailing?: ReactNode
  /**
   * Decorative trailing content — a status badge or tag. Rendered before
   * {@link trailing} and made click-through, so it never turns the row's right
   * edge into a dead zone.
   */
  badge?: ReactNode
  /**
   * Makes the whole row activatable via a control with a stretched hit area. `trailing`
   * stacks above it, so interactive trailing controls (menus, chips) keep
   * working — never nest an interactive `trailing` inside a caller-supplied
   * wrapper `<button>`, which is invalid HTML.
   */
  onClick?: () => void
  /** Accessible name for the activatable cluster. Required alongside `onClick`. */
  clickLabel?: string
  /**
   * Drops the row's `-mx-2` bleed and padding. For a row that is not in a list —
   * a detail heading — or one inside a fixed-height `overflow-y-auto` box, where
   * the bleed would force a horizontal scrollbar.
   */
  flush?: boolean
}

/** The one navigation chevron for every settings resource row. */
export const RESOURCE_ROW_ARROW_CLASSES = 'size-4 shrink-0 text-[var(--text-icon)]'

/**
 * Single-column list of {@link SettingsResourceRow}s. The rows carry their own
 * `-mx-2` bleed and padding, so the container only sets the rhythm.
 */
export const RESOURCE_LIST_STACK = 'flex flex-col gap-y-0.5'

const PLAIN_BASE =
  'flex size-[14px] shrink-0 items-center justify-center text-[var(--text-icon)] [&_svg]:size-[14px] [&_img]:size-[14px]'

export function SettingsResourceRow({
  icon,
  iconVariant = 'tile',
  title,
  description,
  trailing,
  badge,
  onClick,
  clickLabel,
  flush = false,
}: SettingsResourceRowProps) {
  const describedById = useId()
  const isTile = iconVariant === 'tile'
  const cluster = (
    <>
      {icon == null ? null : iconVariant === 'custom' ? (
        icon
      ) : (
        <div
          className={
            isTile ? cn(RESOURCE_TILE_BASE, RESOURCE_TILE_PLAIN, '[&_img]:size-5') : PLAIN_BASE
          }
        >
          {icon}
        </div>
      )}
      <div className='relative z-10 flex min-w-0 flex-col justify-center gap-[1px] text-left'>
        {typeof title === 'string' ? (
          <OverflowText
            label={title}
            className='text-[var(--text-body)] text-sm'
            focusTarget={onClick ? 'nearest-interactive' : undefined}
          />
        ) : (
          <span className='truncate text-[var(--text-body)] text-sm'>{title}</span>
        )}
        {description != null &&
          (typeof description === 'string' ? (
            <span id={describedById} className='min-w-0'>
              <OverflowText
                label={description}
                className='block text-[var(--text-muted)] text-caption'
              />
            </span>
          ) : (
            <span id={describedById} className='truncate text-[var(--text-muted)] text-caption'>
              {description}
            </span>
          ))}
      </div>
    </>
  )
  const clusterClass = cn(
    'flex min-w-0 items-center',
    iconVariant === 'plain' ? 'gap-2' : 'gap-2.5'
  )
  const hasEnd = badge != null || trailing != null
  // Decoration stays click-through so the row's right edge never
  // becomes a dead zone; only `trailing` takes pointer events back.
  const end = hasEnd ? (
    <div className='pointer-events-none relative z-20 flex shrink-0 items-center gap-2'>
      {badge}
      {trailing != null && <div className='pointer-events-auto flex items-center'>{trailing}</div>}
    </div>
  ) : null

  // Row geometry is identical whether or not the row is activatable, so a list
  // mixing clickable and static rows keeps one height and one inset.
  const rowClass = cn('flex items-center justify-between gap-2.5', !flush && '-mx-2 rounded-lg p-2')

  if (!onClick) {
    return (
      <div className={rowClass}>
        <div className={clusterClass}>{cluster}</div>
        {end}
      </div>
    )
  }

  const controlClass = cn(
    clusterClass,
    'min-w-0 flex-1 cursor-pointer focus-visible:outline-hidden',
    'after:absolute after:inset-0 after:rounded-lg after:content-[""]',
    'focus-visible:after:ring-2 focus-visible:after:ring-[color-mix(in_srgb,var(--text-muted)_30%,transparent)]'
  )

  return (
    <div
      className={cn(
        rowClass,
        'group relative transition-colors hover-hover:bg-[var(--surface-active)]'
      )}
    >
      <button
        type='button'
        onClick={onClick}
        aria-label={clickLabel}
        aria-describedby={description != null ? describedById : undefined}
        className={controlClass}
      >
        {cluster}
      </button>
      {end}
    </div>
  )
}
