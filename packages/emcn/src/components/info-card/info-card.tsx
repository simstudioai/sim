/**
 * Chip-input-styled bordered surface containing a scrollable bulleted list.
 * Shares the same outer chrome tokens as `Input` / `Textarea` / `TagInput`
 * (default variant) so any `ChipModalField` child reads as a uniform item.
 *
 * @example
 * ```tsx
 * <ChipModalField type='custom' title='Permissions requested'>
 *   <InfoCard>
 *     <InfoCardList>
 *       {scopes.map((scope) => (
 *         <InfoCardItem key={scope}>{getScopeDescription(scope)}</InfoCardItem>
 *       ))}
 *     </InfoCardList>
 *   </InfoCard>
 * </ChipModalField>
 * ```
 */

'use client'

import * as React from 'react'
import { Check } from 'lucide-react'
import { cn } from '../../lib/cn'

export interface InfoCardProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * Root container. Owns the chip-input chrome — same tokens as `Input` and
 * `Textarea` so the surface visually matches sibling controls in a
 * `ChipModalField`.
 */
const InfoCard = React.forwardRef<HTMLDivElement, InfoCardProps>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'rounded-lg border border-[var(--border-1)] bg-[var(--surface-5)] dark:bg-[var(--surface-4)]',
      className
    )}
    {...props}
  />
))

InfoCard.displayName = 'InfoCard'

export interface InfoCardListProps extends React.HTMLAttributes<HTMLUListElement> {
  /**
   * Tailwind class controlling the scrollable region's max height.
   * @default 'max-h-[200px]'
   */
  maxHeightClassName?: string
}

/**
 * Scrollable list container. Children should be `<InfoCardItem>`s.
 * Padding (`p-2`) matches the modal's text-control chrome so the card aligns
 * with sibling `Input` / `Textarea` rhythm. Items are spaced `gap-2`
 * vertically to mirror sidebar-item rhythm.
 */
const InfoCardList = React.forwardRef<HTMLUListElement, InfoCardListProps>(
  ({ className, maxHeightClassName = 'max-h-[200px]', ...props }, ref) => (
    <ul
      ref={ref}
      className={cn('flex flex-col gap-2 overflow-y-auto p-2', maxHeightClassName, className)}
      {...props}
    />
  )
)

InfoCardList.displayName = 'InfoCardList'

export interface InfoCardItemProps extends React.LiHTMLAttributes<HTMLLIElement> {
  /**
   * Leading glyph. Defaults to lucide `Check`. Pass `null` to omit.
   */
  icon?: React.ComponentType<{ className?: string }> | null
}

/**
 * Single list row. Mirrors sidebar-item tokens: `gap-2`, `text-icon` glyph,
 * and `text-body` label at `text-sm`. Icon renders at `size-[12px]` —
 * smaller than the default `14px` so it reads as a supporting bullet
 * rather than competing with the label.
 */
const InfoCardItem = React.forwardRef<HTMLLIElement, InfoCardItemProps>(
  ({ className, children, icon: Icon = Check, ...props }, ref) => (
    <li ref={ref} className={cn('flex items-center gap-2', className)} {...props}>
      {Icon ? <Icon className='size-[12px] flex-shrink-0 text-[var(--text-icon)]' /> : null}
      <span className='text-[var(--text-body)] text-sm'>{children}</span>
    </li>
  )
)

InfoCardItem.displayName = 'InfoCardItem'

export { InfoCard, InfoCardList, InfoCardItem }
