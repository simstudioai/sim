import { type ComponentProps, type ReactNode, useId } from 'react'
import { cva } from 'class-variance-authority'
import { ArrowRight } from '../../icons'
import { cn } from '../../lib/cn'
import { OverflowText } from '../overflow-text/overflow-text'
import {
  RESOURCE_TILE_BASE,
  RESOURCE_TILE_FILL,
  RESOURCE_TILE_PLAIN,
} from '../resource-tile/resource-tile'

export interface ResourceRowProps {
  /** Identity glyph. Omit for resources without one. */
  icon?: ReactNode
  /** Bordered tile, bare type glyph, or caller-supplied tile. */
  iconVariant?: 'tile' | 'plain' | 'custom'
  /** Let image icons fill the tile; SVG glyphs keep their 20px size. */
  iconFill?: boolean
  /** Use the filled resource tile instead of the page-background tile. */
  iconFilled?: boolean
  title: ReactNode
  description?: ReactNode
  /** Interactive controls that sit above the row's stretched activation target. */
  trailing?: ReactNode
  /** Click-through decorative content before the trailing controls. */
  badge?: ReactNode
  onClick?: () => void
  href?: string
  clickLabel?: string
  navigable?: boolean
  /** Remove the list bleed and padding for detail headings or clipped containers. */
  flush?: boolean
  disabled?: boolean
  /** Render a framework link while EMCN retains the row's control classes and semantics. */
  renderLink?: (props: ComponentProps<'a'>) => ReactNode
}

/** Chevron geometry shared with bespoke resource rows. */
export const RESOURCE_ROW_ARROW_CLASSES = 'size-4 shrink-0 text-[var(--text-icon)]'

/** Single-column rhythm for resource rows, whose own margins supply the bleed. */
export const RESOURCE_LIST_STACK = 'flex flex-col gap-y-0.5'

/** Grid gap budgets for the 8px bleed on each neighbouring row. */
export const RESOURCE_LIST_GRID =
  'grid grid-cols-[repeat(auto-fit,minmax(264px,1fr))] gap-x-6 gap-y-0.5'

const PLAIN_BASE =
  'flex size-[14px] shrink-0 items-center justify-center text-[var(--text-icon)] [&_svg]:size-[14px] [&_img]:size-[14px]'

/** Wrapper treatment for tile and plain identity glyphs. */
export const resourceRowIconVariants = cva('', {
  variants: {
    variant: {
      tile: RESOURCE_TILE_BASE,
      plain: PLAIN_BASE,
    },
  },
})

/**
 * Resource row chrome, content, and accessible stretched activation target.
 * Framework navigation is supplied through `renderLink`; without it, `href`
 * renders a native anchor.
 *
 * @example
 * <ResourceRow icon={<Folder />} title='Files' href='/files' clickLabel='Open files' navigable />
 */
export function ResourceRow({
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
  renderLink,
}: ResourceRowProps) {
  const describedById = useId()
  const isTile = iconVariant === 'tile'
  const isActivatable = !disabled && Boolean(onClick || href)
  const cluster = (
    <>
      {icon == null ? null : iconVariant === 'custom' ? (
        icon
      ) : (
        <div
          className={
            isTile
              ? cn(
                  resourceRowIconVariants({ variant: 'tile' }),
                  iconFilled ? RESOURCE_TILE_FILL : RESOURCE_TILE_PLAIN,
                  iconFill ? '[&_img]:size-full' : '[&_img]:size-5'
                )
              : resourceRowIconVariants({ variant: 'plain' })
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
            focusTarget={isActivatable ? 'nearest-interactive' : undefined}
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
  const hasEnd = badge != null || trailing != null || navigable
  const end = hasEnd ? (
    <div className='pointer-events-none relative z-20 flex shrink-0 items-center gap-2'>
      {badge}
      {trailing != null && <div className='pointer-events-auto flex items-center'>{trailing}</div>}
      {navigable && <ArrowRight className={RESOURCE_ROW_ARROW_CLASSES} />}
    </div>
  ) : null

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

  const controlClass = cn(
    clusterClass,
    'min-w-0 flex-1 cursor-pointer focus-visible:outline-hidden',
    'after:absolute after:inset-0 after:rounded-lg after:content-[""]',
    'focus-visible:after:ring-2 focus-visible:after:ring-[color-mix(in_srgb,var(--text-muted)_30%,transparent)]'
  )

  const linkProps: ComponentProps<'a'> = {
    href,
    'aria-label': clickLabel,
    'aria-describedby': description != null ? describedById : undefined,
    className: controlClass,
    children: cluster,
  }

  return (
    <div
      className={cn(
        rowClass,
        'group relative transition-colors hover-hover:bg-[var(--surface-active)]'
      )}
    >
      {href ? (
        renderLink ? (
          renderLink(linkProps)
        ) : (
          <a {...linkProps} />
        )
      ) : (
        <button
          type='button'
          onClick={onClick}
          aria-label={clickLabel}
          aria-describedby={description != null ? describedById : undefined}
          className={controlClass}
        >
          {cluster}
        </button>
      )}
      {end}
    </div>
  )
}
