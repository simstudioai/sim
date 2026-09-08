import type { ReactNode } from 'react'
import { ShimmerText } from '@/components/ui'

interface ToolCallRowProps {
  title: string
  isExecuting: boolean
  icon?: ReactNode
}

/** Shared activity chrome; callers resolve tool semantics and brand icons. */
export function ToolCallRow({ title, isExecuting, icon }: ToolCallRowProps) {
  return (
    <div className='flex min-w-0 items-center gap-[6px] pl-6'>
      {icon}
      {isExecuting ? (
        <ShimmerText className='min-w-0 truncate text-[13px] leading-[18px] [--shimmer-rest:var(--text-secondary)]'>
          {title}
        </ShimmerText>
      ) : (
        <span className='min-w-0 truncate text-[13px] text-[var(--text-secondary)] leading-[18px]'>
          {title}
        </span>
      )}
    </div>
  )
}
