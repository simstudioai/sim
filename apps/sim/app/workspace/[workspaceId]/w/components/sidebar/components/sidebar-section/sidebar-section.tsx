'use client'

import { type ReactNode, useState } from 'react'
import { cn, disclosureChevronClass, Expandable, ExpandableContent, OverflowText } from '@sim/emcn'
import { ChevronDown } from '@sim/emcn/icons'

/**
 * Title-row layout, shared by the toggle and its rail-collapsed counterpart so the
 * label lands identically either way. The row's gutter lives here rather than on the
 * row itself: the toggle stretches edge to edge and insets only its own content, so
 * the full width of the rail is clickable rather than just the text and chevron.
 */
const TITLE_ROW_CLASS = 'flex h-full min-w-0 flex-1 items-center gap-2 px-4'

interface SidebarSectionProps {
  title: string
  /** Controls pinned to the right of the title (e.g. the Workflows create/more buttons). */
  action?: ReactNode
  /**
   * True while the rail is collapsed. Only icons are visible there, so the title
   * renders as a static label — no chevron, nothing focusable — and the content
   * stays open regardless of what the user last toggled.
   */
  railCollapsed?: boolean
  /** Layout classes for the section wrapper (section gap, positioning). */
  className?: string
  children: ReactNode
}

/**
 * A titled, collapsible group of sidebar items ("Chats", "Workspace", "Workflows",
 * and each settings group).
 *
 * Owns the section's vertical rhythm so every section matches: an 18px header row
 * — exactly the title's line box at `text-caption` — then a 6px gap to the content,
 * sitting between the 2px item gap and the 16px section gap. The gap rides inside
 * the collapsing content, so it closes along with it. Consumers supply only the
 * item container.
 *
 * The title carries `sidebar-collapse-hide` so it fades out with the rail while the
 * row keeps its height, holding the collapsed rail on the expanded rail's grid.
 */
export function SidebarSection({
  title,
  action,
  railCollapsed = false,
  className,
  children,
}: SidebarSectionProps) {
  const [expanded, setExpanded] = useState(true)

  const handleToggle = () => {
    setExpanded((prev) => !prev)
  }

  const label = (
    <OverflowText
      label={title}
      className='sidebar-collapse-hide text-[var(--text-muted)] text-caption'
    />
  )

  return (
    <div className={cn('group/section flex flex-col', className)}>
      <div className='flex h-[18px] shrink-0 items-center'>
        {railCollapsed ? (
          <div className={TITLE_ROW_CLASS}>{label}</div>
        ) : (
          <button
            type='button'
            onClick={handleToggle}
            aria-expanded={expanded}
            className={cn('group/toggle cursor-pointer', TITLE_ROW_CLASS)}
          >
            {label}
            {/*
             * Revealed by hovering anywhere in the section: the group sits on the
             * section wrapper rather than this row, so the items below arm it just as
             * the header does. Focus is keyed off the toggle instead — the only element
             * here that can hold it — and matters because globals clear focus outlines.
             */}
            <ChevronDown
              className={cn(
                disclosureChevronClass,
                'opacity-0 group-hover/section:opacity-100 group-focus-visible/toggle:opacity-100',
                !expanded && '-rotate-90'
              )}
            />
          </button>
        )}
        {/* Carries the gutter the row gave up so the toggle can reach the rail's edge. */}
        {action ? <div className='flex shrink-0 items-center pr-4'>{action}</div> : null}
      </div>
      {/* `animate-none!`: the disclosure opens and closes in one frame, like every
          other change of the rail's shape. */}
      <Expandable expanded={railCollapsed || expanded}>
        <ExpandableContent className='animate-none!'>
          {/* The header gap pads an inner wrapper rather than the animated element:
              `collapsible-up`/`-down` interpolate height alone, so a margin here would
              hold its full 6px for the whole close and then vanish on unmount, snapping
              the next section up. Padding on the content itself can't work either —
              border-box keeps it rendered at `height: 0`, so the section never shuts. */}
          <div className='pt-1.5'>{children}</div>
        </ExpandableContent>
      </Expandable>
    </div>
  )
}
