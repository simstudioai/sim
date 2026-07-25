'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  ChevronDown,
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  ShieldCheck,
  Tooltip,
} from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { copilotToolPermissionContract } from '@/lib/api/contracts/copilot'
import { generalSettingsKeys } from '@/hooks/queries/general-settings'
import { useToolPermissionStore } from '@/stores/tool-permission/store'

const logger = createLogger('ToolPermissionCard')

type Decision = 'allow' | 'allow_chat' | 'always_allow' | 'skip'

interface ToolPermissionCardProps {
  toolCallId: string
  toolName: string
  /** The same human phrase the ordinary tool row would show, e.g. "Run bun test". */
  displayTitle: string
  params?: Record<string, unknown>
}

/**
 * What the tool was asked to do, for the tooltip.
 *
 * Truncated hard: arguments can be arbitrarily large (a whole file body), and
 * this is a confirmation affordance, not an inspector.
 */
function argsPreview(params: Record<string, unknown> | undefined): string | undefined {
  if (!params || Object.keys(params).length === 0) return undefined
  try {
    const json = JSON.stringify(params, null, 2)
    return json.length > 600 ? `${json.slice(0, 600)}…` : json
  } catch {
    return undefined
  }
}

/**
 * The inline "Allow / Don't ask again / Skip" prompt for a gated tool call.
 *
 * Nothing runs until one of these is clicked: the Sim orchestrator is holding
 * the tool's result, and therefore the whole mothership turn, on the answer.
 * Rendered as a chip cluster on one row so a gated call reads as the same kind
 * of transcript line as every other tool, just one you have to answer.
 */
export function ToolPermissionCard({
  toolCallId,
  toolName,
  displayTitle,
  params,
}: ToolPermissionCardProps) {
  const queryClient = useQueryClient()
  const [submitting, setSubmitting] = useState<Decision | null>(null)

  const register = useToolPermissionStore((state) => state.register)
  const unregister = useToolPermissionStore((state) => state.unregister)
  const markSubmitted = useToolPermissionStore((state) => state.markSubmitted)
  const clearSubmitted = useToolPermissionStore((state) => state.clearSubmitted)
  const awaitingIds = useToolPermissionStore((state) => state.awaitingIds)
  const submittedIds = useToolPermissionStore((state) => state.submittedIds)

  useEffect(() => {
    register(toolCallId)
    return () => unregister(toolCallId)
  }, [register, unregister, toolCallId])

  const outstandingIds = awaitingIds.filter((id) => !submittedIds.includes(id))
  const isSubmitted = submittedIds.includes(toolCallId)
  // Only the first outstanding card offers the bulk action, so N cards do not
  // each render their own "Allow all".
  const showBulkActions = outstandingIds.length > 1 && outstandingIds[0] === toolCallId

  const submit = useCallback(
    async (decision: Decision, ids: string[]) => {
      setSubmitting(decision)
      markSubmitted(ids)
      try {
        await requestJson(copilotToolPermissionContract, {
          body: { decisions: ids.map((id) => ({ toolCallId: id, decision })) },
        })
        if (decision === 'always_allow') {
          void queryClient.invalidateQueries({ queryKey: generalSettingsKeys.settings() })
        }
      } catch (error) {
        // The decision never landed, so put the cards back rather than leaving
        // the user staring at a dead prompt the turn is still blocked on.
        logger.error('Failed to submit tool permission decision', { toolCallId, decision, error })
        clearSubmitted(ids)
        setSubmitting(null)
      }
    },
    [clearSubmitted, markSubmitted, queryClient, toolCallId]
  )

  const preview = argsPreview(params)
  const busy = submitting !== null || isSubmitted

  return (
    <div className='flex flex-col gap-1'>
      {/* Chips carry their own `mx-0.5` cluster spacing, so this row sets no gap. */}
      <div className='flex flex-wrap items-center'>
        <ShieldCheck className='mr-1.5 size-[16px] shrink-0 text-[var(--text-icon)]' />
        {preview ? (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <span className='mr-1 min-w-0 flex-1 cursor-default truncate text-[var(--text-body)] text-sm'>
                {displayTitle}
              </span>
            </Tooltip.Trigger>
            <Tooltip.Content>
              <div className='max-w-[320px]'>
                <div className='mb-1 font-medium text-xs'>{toolName}</div>
                <pre className='whitespace-pre-wrap break-all font-mono text-xs'>{preview}</pre>
              </div>
            </Tooltip.Content>
          </Tooltip.Root>
        ) : (
          <span className='mr-1 min-w-0 flex-1 truncate text-[var(--text-body)] text-sm'>
            {displayTitle}
          </span>
        )}

        <Chip variant='primary' disabled={busy} onClick={() => void submit('allow', [toolCallId])}>
          Allow
        </Chip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Chip variant='border' rightIcon={ChevronDown} disabled={busy}>
              Don't ask again
            </Chip>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start'>
            <DropdownMenuItem onSelect={() => void submit('allow_chat', [toolCallId])}>
              For this chat
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void submit('always_allow', [toolCallId])}>
              For every chat
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Chip disabled={busy} onClick={() => void submit('skip', [toolCallId])}>
          Skip
        </Chip>
      </div>

      {showBulkActions && (
        <div className='flex flex-wrap items-center pl-[22px]'>
          <span className='mr-1 text-[var(--text-tertiary)] text-xs'>
            {outstandingIds.length} tools need permission
          </span>
          <Chip disabled={busy} onClick={() => void submit('allow', outstandingIds)}>
            Allow all
          </Chip>
          <Chip disabled={busy} onClick={() => void submit('skip', outstandingIds)}>
            Skip all
          </Chip>
        </div>
      )}
    </div>
  )
}
