import type { ReactNode } from 'react'
import { chipHoverSurfaceClass, chipTagVariants, cn, OverflowText } from '@sim/emcn'

interface ResourceMentionProps {
  icon: ReactNode
  title: string
  onSelect?: () => void
}

export function ResourceMention({ icon, title, onSelect }: ResourceMentionProps) {
  const classes = cn(chipTagVariants({ variant: 'mono' }), 'max-w-full align-middle')
  const content = (
    <>
      {icon}
      <OverflowText label={title} focusTarget='nearest-interactive' />
    </>
  )
  if (!onSelect) return <span className={classes}>{content}</span>
  return (
    <button
      type='button'
      onClick={onSelect}
      className={cn(classes, 'cursor-pointer transition-colors', chipHoverSurfaceClass)}
    >
      {content}
    </button>
  )
}
