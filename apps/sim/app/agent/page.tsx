'use client'

import { useEffect } from 'react'
import { Tooltip } from '@/components/emcn'
import { Copilot } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/copilot'
import { useCopilotStore } from '@/stores/panel/copilot/store'

/**
 * Superagent page - standalone AI agent with full credential access
 * Uses the exact same Copilot UI but with superagent mode forced
 */
export default function AgentPage() {
  const { setMode } = useCopilotStore()

  // Set superagent mode on mount
  useEffect(() => {
    setMode('superagent')
  }, [setMode])

  return (
    <Tooltip.Provider delayDuration={600} skipDelayDuration={0}>
      <div className='flex h-screen flex-col bg-[var(--surface-1)]'>
        {/* Header */}
        <header className='flex h-14 flex-shrink-0 items-center justify-between border-b border-[var(--border)] px-4'>
          <div className='flex items-center gap-3'>
            <h1 className='font-semibold text-lg text-[var(--text-primary)]'>Superagent</h1>
            <span className='rounded-full bg-[var(--accent)]/10 px-2 py-0.5 font-medium text-[var(--accent)] text-xs'>
              Full Access
            </span>
          </div>
        </header>

        {/* Copilot - exact same component in standalone mode */}
        <div className='flex-1 overflow-hidden p-4'>
          <div className='mx-auto h-full max-w-4xl'>
            <Copilot panelWidth={800} standalone />
          </div>
        </div>
      </div>
    </Tooltip.Provider>
  )
}
