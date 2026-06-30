import Link from 'next/link'
import { ArrowRight } from '@/components/emcn/icons'
import type { NavMenuItemData } from '@/app/(landing)/components/navbar/components/nav-menu-chip/types'

/**
 * One row inside a navbar mega-menu panel - a title, a one-line description, and
 * a right-arrow that slides in on hover.
 *
 * The row is its own `group/item`, so the arrow reveal (`opacity-0
 * -translate-x-1` → visible on `group-hover/item` and `group-focus-visible/item`)
 * is pure CSS, scoped to the hovered or keyboard-focused row and never to the
 * whole panel. `onSelect` fires on click so the parent menu can close itself.
 *
 * Internal routes render a crawlable Next {@link Link}; `external` items render
 * a new-tab `<a>` with `rel='noopener noreferrer'`.
 */

interface NavMenuItemProps {
  item: NavMenuItemData
  /** Called when the row is activated, so the parent menu can close. */
  onSelect?: () => void
}

const ROW_CLASS =
  'group/item flex items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover-hover:bg-[var(--surface-active)] focus-visible:bg-[var(--surface-active)] focus-visible:outline-none'
const TITLE_CLASS = 'truncate text-[14px] text-[var(--text-body)]'
const DESC_CLASS = 'text-[12px] text-[var(--text-muted)] leading-snug'
const ARROW_CLASS =
  'size-4 flex-shrink-0 -translate-x-1 text-[var(--text-icon)] opacity-0 transition-all group-hover/item:translate-x-0 group-hover/item:opacity-100 group-focus-visible/item:translate-x-0 group-focus-visible/item:opacity-100 motion-reduce:transition-none'

export function NavMenuItem({ item, onSelect }: NavMenuItemProps) {
  const { title, description, href, external } = item
  const content = (
    <>
      <span className='flex min-w-0 flex-1 flex-col'>
        <span className={TITLE_CLASS}>{title}</span>
        <span className={DESC_CLASS}>{description}</span>
      </span>
      <ArrowRight className={ARROW_CLASS} aria-hidden='true' />
    </>
  )

  if (external) {
    return (
      <a
        href={href}
        target='_blank'
        rel='noopener noreferrer'
        onClick={onSelect}
        className={ROW_CLASS}
      >
        {content}
      </a>
    )
  }

  return (
    <Link href={href} onClick={onSelect} className={ROW_CLASS}>
      {content}
    </Link>
  )
}
