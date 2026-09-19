'use client'

import type * as React from 'react'
import { cn } from '../../lib/cn'
import { handleKeyboardActivation } from '../../lib/keyboard'
import { Expandable, ExpandableContent } from '../expandable/expandable'
import { FieldCardContent, FieldCardFrame } from '../field-card/field-card'
import { OverflowText, overflowTextClipClass } from '../overflow-text/overflow-text'

export interface CollapsibleCardProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title' | 'children'> {
  /** Header label rendered with the standard fade-only overflow treatment. */
  title: React.ReactNode
  /** Optional trailing header content, e.g. a type `Badge`. */
  badge?: React.ReactNode
  /** Header actions, outside the collapse target and arranged with standard spacing. */
  actions?: React.ReactNode
  collapsed: boolean
  onToggleCollapse: () => void
  /** Animate expansion using the shared Expandable height transition. */
  animated?: boolean
  /** Native body attributes and layout, including an ID linked from the trigger. */
  contentProps?: React.HTMLAttributes<HTMLDivElement>
  /** Body content, shown when expanded. */
  children: React.ReactNode
}

/**
 * A collapsible field card: a `--surface-4` header (click / keyboard to toggle)
 * with a fade-clipped title + optional badge, over a `--surface-2` body. Shared by
 * the workflow input-mapping rows and the enrichment output-column config.
 * Its frame and body are also used by the always-open FieldCard.
 *
 * @example
 * <CollapsibleCard title='Condition' collapsed={collapsed} onToggleCollapse={toggle}
 *   actions={<Button onClick={addCondition}>Add condition</Button>}>
 *   {fields}
 * </CollapsibleCard>
 */
export function CollapsibleCard({
  title,
  badge,
  actions,
  collapsed,
  onToggleCollapse,
  animated = false,
  contentProps,
  children,
  className,
  ...props
}: CollapsibleCardProps) {
  const content = <FieldCardContent {...contentProps}>{children}</FieldCardContent>
  return (
    <FieldCardFrame
      {...props}
      className={cn(collapsed ? 'overflow-hidden' : 'overflow-visible', className)}
      header={
        <>
          <div
            role='button'
            tabIndex={0}
            aria-expanded={!collapsed}
            aria-controls={contentProps?.id}
            className={cn(
              'flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2.5 py-[5px]',
              actions && 'pr-2'
            )}
            onClick={onToggleCollapse}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return
              handleKeyboardActivation(event, onToggleCollapse)
            }}
          >
            {typeof title === 'string' || typeof title === 'number' ? (
              <OverflowText
                label={String(title)}
                className='flex-1 text-[var(--text-tertiary)] text-sm'
                focusTarget='nearest-interactive'
              />
            ) : (
              <span
                className={cn(overflowTextClipClass, 'flex-1 text-[var(--text-tertiary)] text-sm')}
              >
                {title}
              </span>
            )}
            {badge}
          </div>
          {actions && (
            <div
              role='presentation'
              className='flex shrink-0 items-center gap-2 py-[5px] pr-2.5'
              onClick={(event) => event.stopPropagation()}
            >
              {actions}
            </div>
          )}
        </>
      }
    >
      {animated ? (
        <Expandable expanded={!collapsed}>
          <ExpandableContent>{content}</ExpandableContent>
        </Expandable>
      ) : (
        !collapsed && content
      )}
    </FieldCardFrame>
  )
}
