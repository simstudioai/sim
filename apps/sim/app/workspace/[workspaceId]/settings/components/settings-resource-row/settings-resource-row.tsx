import { type ReactNode, useId } from 'react'
import { cn, OverflowText } from '@sim/emcn'
import { ArrowRight } from '@sim/emcn/icons'
import Link from 'next/link'
import {
  RESOURCE_TILE_BASE,
  RESOURCE_TILE_FILL,
  RESOURCE_TILE_PLAIN,
} from '@/app/workspace/[workspaceId]/components/resource-tile'

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
   * Icon node centered in the tile; a `<svg>` is normalized to 20px, an `<img>` to
   * 20px (or the full tile when `iconFill`). Omit it for rows whose resource has no
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
  /**
   * Let an image icon fill the tile edge-to-edge instead of clamping to 20px.
   * Use for uploaded image/logo icons (e.g. custom blocks); glyph `<svg>`s still
   * normalize to 20px so a fallback icon doesn't balloon. Tile variant only.
   */
  iconFill?: boolean
  /**
   * Fills the tile like the skills/tools resource tiles instead of the default
   * page-background tile, so a settings list can match its gallery counterpart.
   */
  iconFilled?: boolean
  /** Primary line — truncates. */
  title: ReactNode
  /** Secondary muted line — truncates. */
  description?: ReactNode
  /**
   * Interactive controls pinned to the row's end (chips, actions menu). These sit
   * ABOVE the row's own hit area, so their clicks are theirs. The row keeps them at
   * their natural size — callers never need their own `flex-shrink-0`.
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
   * Makes the whole row activatable via a stretched overlay button. `trailing`
   * stacks above it, so interactive trailing controls (menus, chips) keep
   * working — never nest an interactive `trailing` inside a caller-supplied
   * wrapper `<button>`, which is invalid HTML.
   */
  onClick?: () => void
  /**
   * Navigates on activation instead of calling `onClick`. Prefer this over
   * `onClick` + `router.push` so the row keeps real link semantics — prefetch,
   * middle-click, open-in-new-tab.
   */
  href?: string
  /** Accessible name for the activatable cluster. Required alongside `onClick`/`href`. */
  clickLabel?: string
  /**
   * Appends the canonical navigation chevron after `trailing`. Set it on rows that
   * open a detail page; leave it off for rows whose `onClick` performs an action
   * in place. The row owns the glyph so callers never pick an arrow themselves.
   */
  navigable?: boolean
  /**
   * Drops the row's `-mx-2` bleed and padding. For a row that is not in a list —
   * a detail heading — or one inside a fixed-height `overflow-y-auto` box, where
   * the bleed would force a horizontal scrollbar.
   */
  flush?: boolean
  /** Renders the row as unavailable without an activation target. */
  disabled?: boolean
}

/** The one navigation chevron for every settings resource row. */
export const RESOURCE_ROW_ARROW_CLASSES = 'size-4 flex-shrink-0 text-[var(--text-icon)]'

/**
 * Single-column list of {@link SettingsResourceRow}s. The rows carry their own
 * `-mx-2` bleed and padding, so the container only sets the rhythm.
 */
export const RESOURCE_LIST_STACK = 'flex flex-col gap-y-0.5'

/**
 * Responsive two-up card grid worn by the skills, integrations, and passwords
 * lists. The column gap budgets for the rows' own `-mx-2`: 24px of track gap
 * minus 16px of combined bleed leaves the same 8px gutter a stack row gets.
 * Narrowing it makes neighbouring rows — and their hit areas — overlap.
 *
 * The track minimum is 264px, not 280px, for the same reason: `auto-fit` measures
 * tracks rather than margin boxes, so the wider gap would otherwise drop to one
 * column 32px earlier than this grid did when the container owned the bleed.
 */
export const RESOURCE_LIST_GRID =
  'grid grid-cols-[repeat(auto-fit,minmax(264px,1fr))] gap-x-6 gap-y-0.5'

const PLAIN_BASE =
  'flex size-[14px] flex-shrink-0 items-center justify-center text-[var(--text-icon)] [&_svg]:size-[14px] [&_img]:size-[14px]'

export function SettingsResourceRow({
  icon,
  iconVariant = 'tile',
  iconFill = false,
  iconFilled = false,
  title,
  description,
  trailing,
  badge,
  onClick,
  href,
  clickLabel,
  navigable = false,
  flush = false,
  disabled = false,
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
            isTile
              ? cn(
                  RESOURCE_TILE_BASE,
                  iconFilled ? RESOURCE_TILE_FILL : RESOURCE_TILE_PLAIN,
                  iconFill ? '[&_img]:size-full' : '[&_img]:size-5'
                )
              : PLAIN_BASE
          }
        >
          {icon}
        </div>
      )}
      <div className='flex min-w-0 flex-col justify-center gap-[1px] text-left'>
        {typeof title === 'string' ? (
          <OverflowText label={title} className='text-[var(--text-body)] text-sm' />
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
  const hasEnd = badge != null || trailing != null || navigable
  // Decoration and the chevron stay click-through so the row's right edge never
  // becomes a dead zone; only `trailing` takes pointer events back.
  const end = hasEnd ? (
    <div className='pointer-events-none relative flex flex-shrink-0 items-center gap-2'>
      {badge}
      {trailing != null && <div className='pointer-events-auto flex items-center'>{trailing}</div>}
      {navigable && <ArrowRight className={RESOURCE_ROW_ARROW_CLASSES} />}
    </div>
  ) : null

  // Row geometry is identical whether or not the row is activatable, so a list
  // mixing clickable and static rows keeps one height and one inset.
  const rowClass = cn(
    'flex items-center justify-between gap-2.5',
    !flush && '-mx-2 rounded-lg p-2',
    disabled && 'opacity-50'
  )

  if (disabled || (!onClick && !href)) {
    return (
      <div className={rowClass}>
        <div className={clusterClass}>{cluster}</div>
        {end}
      </div>
    )
  }

  // The ring renders on the stretched overlay, which is inset-0 over the row — so a
  // keyboard focus outline traces the visible row even though the control is empty.
  const overlayClass =
    'absolute inset-0 cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--text-muted)_30%,transparent)]'

  // The hit area is a stretched overlay rather than a wrapper around the cluster:
  // it lets the hover band span the full row (matching every hand-rolled settings
  // list) while `trailing` — which may hold its own buttons — stacks above it.
  return (
    <div
      className={cn(
        rowClass,
        'group relative transition-colors hover-hover:bg-[var(--surface-active)]'
      )}
    >
      {href ? (
        <Link
          href={href}
          aria-label={clickLabel}
          aria-describedby={description != null ? describedById : undefined}
          className={overlayClass}
        />
      ) : (
        <button
          type='button'
          onClick={onClick}
          aria-label={clickLabel}
          aria-describedby={description != null ? describedById : undefined}
          className={overlayClass}
        />
      )}
      <div className={cn(clusterClass, 'pointer-events-none')}>{cluster}</div>
      {end}
    </div>
  )
}
