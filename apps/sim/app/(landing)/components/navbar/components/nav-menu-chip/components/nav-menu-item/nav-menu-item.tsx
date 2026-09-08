import { ChipTag, cn } from '@sim/emcn'
import Link from 'next/link'
import { ChevronArrow } from '@/app/(landing)/components/chevron-arrow'
import type { NavMenuItemData } from '@/app/(landing)/components/navbar/components/nav-menu-chip/types'
import { SimWordmark } from '@/app/(landing)/components/navbar/components/sim-wordmark'

/**
 * One destination inside the mega-menu's editorial link columns.
 *
 * Hover and keyboard focus update the dynamic preview through `onActivate`.
 * `onSelect` fires on click so the parent menu can close itself.
 *
 * Internal routes render a crawlable Next {@link Link}; `external` items render
 * a new-tab `<a>` with `rel='noopener noreferrer'`.
 */

interface NavMenuItemProps {
  item: NavMenuItemData
  /** Highlights the description of the previewed destination while the menu is open. */
  active?: boolean
  prefetch?: boolean | null
  /** Called when the row is activated, so the parent menu can close. */
  onSelect?: () => void
  /** Called on hover or focus to update the menu's preview region. */
  onActivate?: () => void
}

const ROW_CLASS =
  'group/item group/link flex min-w-0 items-start text-left focus-visible:outline-none'
const DESC_CLASS =
  'mt-2 max-w-[32ch] text-pretty text-[13px] leading-[1.45] transition-colors group-hover/item:text-[var(--text-body)] group-focus-visible/item:text-[var(--text-body)]'

export function NavMenuItem({
  item,
  active = false,
  prefetch,
  onSelect,
  onActivate,
}: NavMenuItemProps) {
  const { brand, title, description, href, external } = item
  const content = (
    <span className='flex min-w-0 flex-1 flex-col'>
      <span className='flex items-center gap-2 font-normal text-[15px]'>
        {brand ? (
          <ChipTag
            variant='brand'
            brandColor='var(--bg)'
            brandStrokeColor='var(--surface-6)'
            brandForeground='dark'
            aria-label={brand}
          >
            <SimWordmark size='tag' tone='brand-muted' />
          </ChipTag>
        ) : null}
        <span className='text-[var(--text-body)] transition-colors'>{title}</span>
        <span className='flex size-3 shrink-0 items-center justify-center opacity-0 transition-opacity duration-200 ease-out group-hover/link:opacity-100 group-focus-visible/link:opacity-100 motion-reduce:transition-none'>
          <ChevronArrow />
        </span>
      </span>
      <span
        className={cn(
          DESC_CLASS,
          active ? 'text-[var(--text-body)]' : 'text-[var(--text-secondary)]'
        )}
      >
        {description}
      </span>
    </span>
  )

  if (external) {
    return (
      <a
        href={href}
        data-active={active || undefined}
        target='_blank'
        rel='noopener noreferrer'
        onClick={onSelect}
        onMouseEnter={onActivate}
        onFocus={onActivate}
        className={ROW_CLASS}
      >
        {content}
      </a>
    )
  }

  return (
    <Link
      href={href}
      prefetch={prefetch}
      data-active={active || undefined}
      onClick={onSelect}
      onMouseEnter={onActivate}
      onFocus={onActivate}
      className={ROW_CLASS}
    >
      {content}
    </Link>
  )
}
