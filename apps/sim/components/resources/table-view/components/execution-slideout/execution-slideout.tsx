'use client'

import { useCallback, useMemo } from 'react'
import { Button, cn } from '@sim/emcn'
import { X } from '@sim/emcn/icons'
import { LogView } from '@/components/resources/log-view'
import type { WorkflowLogRow } from '@/lib/api/contracts/logs'
import { useLogDetailsResize } from '@/hooks/use-log-details-resize'
import { type ResourceGrants, workspaceSource } from '@/resources'
import { useLogDetailsUIStore } from '@/stores/logs/store'
import { MAX_LOG_DETAILS_WIDTH_RATIO, MIN_LOG_DETAILS_WIDTH } from '@/stores/logs/utils'

interface ExecutionSlideoutProps {
  log: WorkflowLogRow | null
  isOpen: boolean
  onClose: () => void
  workspaceId: string
  grants: ResourceGrants
  /**
   * Whether this viewer may see trace internals. Required, not
   * optional-defaulting-to-true: forgetting it must fail to compile rather than
   * silently reveal payloads a permission group hid. Same contract, and the same
   * reason, as {@link LogView}'s own prop.
   */
  showExecutionInternals: boolean
  onNavigate?: (path: string) => void
}

/**
 * A workflow run, slid in beside the table that triggered it.
 *
 * Mounts the canonical {@link LogView} directly rather than borrowing the logs
 * page's `LogDetails` shell. That shell reads `useParams`, `useRouter`,
 * `useQueryState` and the permission context — four route couplings a table has
 * no use for — and it deep-links its active tab, which meant opening a run from
 * the tables page wrote `?tab` onto the tables URL, and onto the host page's URL
 * from the chat panel. This slideout omits `tab`/`onTabChange` entirely and
 * mounts the log as `host='panel'` — deliberately NOT the host the table itself
 * is on. A run slid in beside a table is embedded no matter where that table
 * renders: it has no address of its own on either surface, so its tab must stay
 * local state. Forwarding the table's host instead made `hostOwnsUrl` true on
 * the tables page, where the view then read a `tab` prop nobody passes and the
 * Trace tab became unreachable.
 *
 * Only the chrome is reproduced: the frame, the resize handle, and a close
 * button. The logs page's prev/next and retry controls belong to a list this
 * surface does not have.
 */
export function ExecutionSlideout({
  log,
  isOpen,
  onClose,
  workspaceId,
  grants,
  showExecutionInternals,
  onNavigate,
}: ExecutionSlideoutProps) {
  const panelWidth = useLogDetailsUIStore((state) => state.panelWidth)
  const { handleMouseDown } = useLogDetailsResize()

  const source = useMemo(
    () => workspaceSource({ kind: 'log' as const, workspaceId, resourceId: log?.id ?? '' }),
    [workspaceId, log?.id]
  )

  const handleNavigate = useCallback((path: string) => onNavigate?.(path), [onNavigate])

  const maxVw = `${MAX_LOG_DETAILS_WIDTH_RATIO * 100}vw`
  const effectiveWidth = `clamp(min(${MIN_LOG_DETAILS_WIDTH}px, ${maxVw}), ${panelWidth}px, ${maxVw})`

  return (
    <>
      {isOpen && (
        <div
          className='absolute top-0 bottom-0 z-[var(--z-dropdown)] w-[8px] cursor-ew-resize'
          style={{ right: `calc(${effectiveWidth} - 4px)` }}
          onMouseDown={handleMouseDown}
          role='separator'
          aria-label='Resize execution details panel'
          aria-orientation='vertical'
        />
      )}

      <div
        className={cn(
          'absolute top-0 right-0 bottom-0 z-[var(--z-dropdown)] overflow-hidden border-l bg-[var(--bg)] shadow-md transition-transform duration-200 ease-out',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
        style={{ width: effectiveWidth }}
        aria-label='Execution details sidebar'
      >
        {log && (
          <div className='flex h-full flex-col px-3.5 pt-3'>
            <div className='flex items-center justify-between'>
              <h2 className='font-medium text-[var(--text-primary)] text-sm'>Execution Details</h2>
              <Button variant='ghost' className='!p-1' onClick={onClose} aria-label='Close'>
                <X className='size-[14px]' />
              </Button>
            </div>

            <LogView
              source={source}
              grants={grants}
              host='panel'
              log={log}
              showExecutionInternals={showExecutionInternals}
              onNavigate={handleNavigate}
            />
          </div>
        )}
      </div>
    </>
  )
}
