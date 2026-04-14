import { useMemo } from 'react'
import { PillsRing } from '@/components/emcn'
import { WorkspaceFile } from '@/lib/copilot/generated/tool-catalog-v1'
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

function StatusIcon({ status, toolName }: { status: ToolCallStatus; toolName: string }) {
  if (status === 'executing') {
    return <PillsRing className='h-[15px] w-[15px] text-[var(--text-tertiary)]' animate />
  }
  if (status === 'cancelled') {
    return <CircleStop className='h-[15px] w-[15px] text-[var(--text-tertiary)]' />
  }
  const Icon = getToolIcon(toolName)
  if (Icon) {
    return <Icon className='h-[15px] w-[15px] text-[var(--text-tertiary)]' />
  }
  return <CircleCheck className='h-[15px] w-[15px] text-[var(--text-tertiary)]' />
}

interface ToolCallItemProps {
  toolName: string
  displayTitle: string
  status: ToolCallStatus
  streamingArgs?: string
}

export function ToolCallItem({ toolName, displayTitle, status, streamingArgs }: ToolCallItemProps) {
  const liveWorkspaceFileTitle = useMemo(() => {
    if (toolName !== WorkspaceFile.id || !streamingArgs) return null
    const titleMatch = streamingArgs.match(/"title"\s*:\s*"([^"]+)"/)
    if (!titleMatch?.[1]) return null
    const opMatch = streamingArgs.match(/"operation"\s*:\s*"(\w+)"/)
    const op = opMatch?.[1] ?? ''
    const verb =
      op === 'create'
        ? 'Creating'
        : op === 'append'
          ? 'Adding'
          : op === 'patch'
            ? 'Editing'
            : op === 'update'
              ? 'Writing'
              : op === 'rename'
                ? 'Renaming'
                : op === 'delete'
                  ? 'Deleting'
                  : 'Writing'
    const unescaped = titleMatch[1]
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16))
      )
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
    return `${verb} ${unescaped}`
  }, [toolName, streamingArgs])

  return (
    <div className='flex items-center gap-[8px] pl-[24px]'>
      <div className='flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center'>
        <StatusIcon status={status} toolName={toolName} />
      </div>
      <span className='font-base text-[13px] text-[var(--text-secondary)]'>
        {liveWorkspaceFileTitle || displayTitle}
      </span>
    </div>
  )
}
