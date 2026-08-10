'use client'

import type * as React from 'react'
import { Children } from 'react'
import { cn } from '../../lib/cn'
import { chipContentLabelClass, chipFieldSurfaceClass } from '../chip/chip-chrome'

interface FieldCardSharedProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children' | 'title'> {
  /** Header label (rendered in the standard truncated field-title style). */
  title: React.ReactNode
  /** Optional trailing header content, e.g. a type `Badge`. */
  badge?: React.ReactNode
  /** Optional interactive actions rendered outside the header toggle. */
  actions?: React.ReactNode
  /** Removes the default body padding for edge-to-edge editors. */
  flush?: boolean
  /** Body content rendered below the header. */
  children?: React.ReactNode
}

export type FieldCardProps = FieldCardSharedProps

export interface CollapsibleCardProps extends FieldCardSharedProps {
  collapsed: boolean
  onToggleCollapse: () => void
}

/**
 * Shared chip-aligned frame used by static and collapsible field cards.
 */
function FieldCardFrame({
  header,
  actions,
  children,
  flush = false,
  className,
  ...props
}: Omit<FieldCardSharedProps, 'title' | 'badge'> & { header: React.ReactNode }) {
  const hasBody = Children.toArray(children).length > 0

  return (
    <div className={cn(chipFieldSurfaceClass, 'overflow-hidden', className)} {...props}>
      <div
        className={cn(
          'flex min-h-[30px] items-center justify-between px-2',
          hasBody && 'border-[var(--border-1)] border-b'
        )}
      >
        {header}
        {actions ? <div className='flex items-center gap-1 pl-2'>{actions}</div> : null}
      </div>
      {hasBody ? (
        <div
          className={cn(
            'bg-[var(--surface-2)]',
            !flush && 'flex flex-col gap-2 px-2.5 pt-1.5 pb-2.5'
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}

/**
 * A chip-aligned field card with a static header and optional edge-to-edge body.
 */
export function FieldCard({ title, badge, actions, children, ...props }: FieldCardProps) {
  return (
    <FieldCardFrame
      header={
        <div className='flex min-w-0 flex-1 items-center gap-2'>
          <span className={chipContentLabelClass}>{title}</span>
          {badge}
        </div>
      }
      actions={actions}
      {...props}
    >
      {children}
    </FieldCardFrame>
  )
}

/**
 * A chip-aligned field card whose header toggles the body.
 */
export function CollapsibleCard({
  title,
  badge,
  actions,
  collapsed,
  onToggleCollapse,
  children,
  ...props
}: CollapsibleCardProps) {
  return (
    <FieldCardFrame
      header={
        <button
          type='button'
          className='flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left'
          aria-expanded={!collapsed}
          onClick={onToggleCollapse}
        >
          <span className={chipContentLabelClass}>{title}</span>
          {badge}
        </button>
      }
      actions={actions}
      {...props}
    >
      {collapsed ? null : children}
    </FieldCardFrame>
  )
}
