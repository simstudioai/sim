'use client'

import { useMemo } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ConsoleEntry } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/console/components'
import { useTerminalConsoleStore } from '@/stores/terminal'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface ConsoleProps {
  panelWidth: number
}

export function Console({ panelWidth }: ConsoleProps) {
  const entries = useTerminalConsoleStore((state) => state.entries)
  const { activeWorkflowId } = useWorkflowRegistry()

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => entry.workflowId === activeWorkflowId)
  }, [entries, activeWorkflowId])

  return (
    <div className='h-full pt-2 pl-[1px]'>
      {filteredEntries.length === 0 ? (
        <div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
          No console entries
        </div>
      ) : (
        <ScrollArea className='h-full' hideScrollbar={false}>
          <div className='space-y-3'>
            {filteredEntries.map((entry) => (
              <ConsoleEntry key={entry.id} entry={entry} consoleWidth={panelWidth} />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
