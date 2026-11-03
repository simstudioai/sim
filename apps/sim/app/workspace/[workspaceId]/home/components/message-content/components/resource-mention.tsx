import type { ReactNode } from 'react'
import { ChipTag, chipHoverSurfaceClass, chipTagVariants, cn, OverflowText } from '@sim/emcn'
import { X } from '@sim/emcn/icons'

interface ResourceMentionProps {
  icon: ReactNode
  title: string
  onSelect?: () => void
  onRemove?: () => void
  removeLabel?: string
  ariaLabel?: string
  variant?: 'mono' | 'field'
}

export function ResourceMention({
  icon,
  title,
  onSelect,
  onRemove,
  removeLabel,
  ariaLabel,
  variant = 'mono',
}: ResourceMentionProps) {
  const classes = cn(chipTagVariants({ variant }), 'max-w-full align-middle')
  const content = (
    <>
      {icon}
      <OverflowText label={title} focusTarget='nearest-interactive' />
    </>
  )
  if (onRemove) {
    return (
      <ChipTag
        variant={variant}
        className='max-w-full align-middle'
        rightIcon={X}
        onRightIconClick={onRemove}
        rightIconLabel={removeLabel ?? `Remove ${title}`}
      >
        {onSelect ? (
          <button
            type='button'
            onClick={onSelect}
            aria-label={ariaLabel}
            className='inline-flex min-w-0 items-center gap-[3px]'
          >
            {content}
          </button>
        ) : (
          content
        )}
      </ChipTag>
    )
  }
  if (!onSelect) return <span className={classes}>{content}</span>
  return (
    <button
      type='button'
      onClick={onSelect}
      aria-label={ariaLabel}
      className={cn(classes, 'cursor-pointer transition-colors', chipHoverSurfaceClass)}
    >
      {content}
    </button>
  )
}
