import { cn } from '@/lib/core/utils/cn'
import type { MothershipToolName, SubagentName, ToolCallStatus, ToolPhase } from '../../../../types'
import { SUBAGENT_LABELS, TOOL_UI_METADATA } from '../../../../types'
import { getToolIcon } from '../../utils'

const STATUS_STYLES: Record<ToolCallStatus, string> = {
  executing: 'bg-[var(--text-tertiary)] animate-pulse',
  success: 'bg-[var(--text-tertiary)]',
  error: 'bg-red-500',
}

const PHASE_COLORS: Record<ToolPhase, string> = {
  workspace: 'text-blue-500',
  search: 'text-emerald-500',
  management: 'text-amber-500',
  execution: 'text-purple-500',
  resource: 'text-cyan-500',
  subagent: 'text-orange-500',
}

interface ToolCallProps {
  id: string
  toolName: string
  displayTitle?: string
  status: ToolCallStatus
  phaseLabel?: string
  calledBy?: string
}

export function ToolCall({ toolName, displayTitle, status, phaseLabel, calledBy }: ToolCallProps) {
  const metadata = TOOL_UI_METADATA[toolName as MothershipToolName]
  const resolvedTitle = displayTitle || metadata?.title || toolName
  const resolvedPhase = phaseLabel || metadata?.phaseLabel
  const resolvedPhaseType = metadata?.phase
  const Icon = getToolIcon(toolName)
  const callerLabel = calledBy
    ? (SUBAGENT_LABELS[calledBy as SubagentName] ?? calledBy)
    : 'Mothership'

  return (
    <div className='flex items-center gap-[6px]'>
      <div className={cn('h-[5px] w-[5px] shrink-0 rounded-full', STATUS_STYLES[status])} />
      {Icon && <Icon className='h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]' />}
      <span className='font-base text-[13px] text-[var(--text-tertiary)]'>{resolvedTitle}</span>
      {resolvedPhase && (
        <span
          className={cn(
            'rounded bg-[var(--surface-5)] px-1.5 py-0.5 font-[500] text-[10px]',
            resolvedPhaseType ? PHASE_COLORS[resolvedPhaseType] : 'text-[var(--text-tertiary)]'
          )}
        >
          {resolvedPhase}
        </span>
      )}
      <span className='text-[11px] text-[var(--text-quaternary)]'>via {callerLabel}</span>
    </div>
  )
}
