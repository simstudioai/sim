import { Loader } from '@/components/emcn'
import type { ToolCallStatus } from '../../../../types'
import { getToolIcon } from '../../utils'

function CircleCheck({ className }: { className?: string }) {
  return (
    <svg
      width='16'
      height='16'
      viewBox='0 0 16 16'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={className}
    >
      <circle cx='8' cy='8' r='6.5' stroke='currentColor' strokeWidth='1.25' />
      <path
        d='M5.5 8.5L7 10L10.5 6.5'
        stroke='currentColor'
        strokeWidth='1.25'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

export function CircleStop({ className }: { className?: string }) {
  return (
    <svg
      width='16'
      height='16'
      viewBox='0 0 16 16'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={className}
    >
      <circle cx='8' cy='8' r='6.5' stroke='currentColor' strokeWidth='1.25' />
      <rect x='6' y='6' width='4' height='4' rx='0.5' fill='currentColor' />
    </svg>
  )
}

interface ToolCallItemProps {
  toolName: string
  displayTitle: string
  status: ToolCallStatus
}

export function ToolCallItem({ toolName, displayTitle, status }: ToolCallItemProps) {
  const Icon = getToolIcon(toolName)

  return (
    <div className='flex items-center gap-[8px] pl-[24px]'>
      <div className='flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center'>
        {status === 'executing' ? (
          <Loader className='h-[15px] w-[15px] text-[var(--text-tertiary)]' animate />
        ) : status === 'cancelled' ? (
          <CircleStop className='h-[15px] w-[15px] text-[var(--text-tertiary)]' />
        ) : Icon ? (
          <Icon className='h-[15px] w-[15px] text-[var(--text-tertiary)]' />
        ) : (
          <CircleCheck className='h-[15px] w-[15px] text-[var(--text-tertiary)]' />
        )}
      </div>
      <span className='font-base text-[13px] text-[var(--text-secondary)]'>{displayTitle}</span>
    </div>
  )
}
