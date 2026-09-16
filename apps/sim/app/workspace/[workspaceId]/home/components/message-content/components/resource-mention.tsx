import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'

interface ResourceMentionProps {
  icon: ReactNode
  title: string
  onSelect?: () => void
}

export function ResourceMention({ icon, title, onSelect }: ResourceMentionProps) {
  const classes =
    'inline-flex items-baseline gap-1 rounded-[5px] bg-[var(--surface-5)] px-[5px] align-baseline font-[inherit] text-[inherit] leading-[inherit]'
  const content = (
    <>
      {icon}
      {title}
    </>
  )
  if (!onSelect) return <span className={classes}>{content}</span>
  return (
    <button
      type='button'
      onClick={onSelect}
      className={cn(classes, 'cursor-pointer transition-colors hover-hover:bg-[var(--surface-6)]')}
    >
      {content}
    </button>
  )
}
