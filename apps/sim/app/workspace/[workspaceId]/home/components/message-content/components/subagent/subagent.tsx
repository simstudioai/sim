import { cn } from '@/lib/core/utils/cn'
import type { ToolCallStatus } from '../../../../types'
import { getToolIcon } from '../../utils'

const STATUS_STYLES: Record<ToolCallStatus, string> = {
  executing: 'bg-[var(--text-tertiary)] animate-pulse',
  success: 'bg-[var(--text-tertiary)]',
  error: 'bg-red-500',
}

interface SubagentProps {
  id: string
  name: string
  label: string
  status: ToolCallStatus
}

export function Subagent({ name, label, status }: SubagentProps) {
  const Icon = getToolIcon(name)

  return (
    <div className='flex items-center gap-[6px]'>
      <div className={cn('h-[5px] w-[5px] shrink-0 rounded-full', STATUS_STYLES[status])} />
      {Icon && <Icon className='h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]' />}
      <span className='font-base text-[13px] text-[var(--text-tertiary)]'>{label}</span>
    </div>
  )
}
