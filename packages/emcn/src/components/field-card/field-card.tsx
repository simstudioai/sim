import type * as React from 'react'
import { cn } from '../../lib/cn'
import { OverflowText, overflowTextClipClass } from '../overflow-text/overflow-text'

export interface FieldCardProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title' | 'children'> {
  /** Field name; plain text uses the standard fade and full-value tooltip. */
  title: React.ReactNode
  /** Optional content adjacent to the field name, such as a type badge. */
  badge?: React.ReactNode
  /** Always-visible field controls or description. */
  children: React.ReactNode
}

interface FieldCardFrameProps extends React.HTMLAttributes<HTMLDivElement> {
  header: React.ReactNode
}

/** Internal frame shared by static and collapsible field cards. */
export function FieldCardFrame({ header, children, className, ...props }: FieldCardFrameProps) {
  return (
    <div {...props} className={cn('rounded-sm border border-[var(--border-1)]', className)}>
      <div className='flex items-center justify-between rounded-t-[4px] bg-[var(--surface-4)]'>
        {header}
      </div>
      {children}
    </div>
  )
}

/** Internal body shared by static and collapsible field cards. */
export function FieldCardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn(
        'flex flex-col gap-2 rounded-b-[4px] border-[var(--border-1)] border-t bg-[var(--surface-2)] px-2.5 pt-1.5 pb-2.5',
        className
      )}
    />
  )
}

/**
 * An always-open field card with the same frame and body as CollapsibleCard.
 * The header is a label, not a button; controls retain their own behavior.
 *
 * @example
 * <FieldCard title='query' badge={<Badge variant='type' size='sm'>string</Badge>}>
 *   {descriptionField}
 * </FieldCard>
 */
export function FieldCard({ title, badge, children, className, ...props }: FieldCardProps) {
  return (
    <FieldCardFrame
      {...props}
      className={cn('overflow-hidden', className)}
      header={
        <div className='flex min-w-0 flex-1 items-center gap-2 px-2.5 py-[5px]'>
          {typeof title === 'string' || typeof title === 'number' ? (
            <OverflowText label={String(title)} className='text-[var(--text-tertiary)] text-sm' />
          ) : (
            <span className={cn(overflowTextClipClass, 'text-[var(--text-tertiary)] text-sm')}>
              {title}
            </span>
          )}
          {badge}
        </div>
      }
    >
      <FieldCardContent>{children}</FieldCardContent>
    </FieldCardFrame>
  )
}
