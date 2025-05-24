'use client'

import { useMemo } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useConsoleStore } from '@/stores/panel/console/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { ConsoleEntry } from './components/console-entry/console-entry'

interface ConsoleProps {
  panelWidth: number
}

export function Console({ panelWidth }: ConsoleProps) {
  const entries = useConsoleStore((state) => state.entries)
  const { activeWorkflowId } = useWorkflowRegistry()

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => entry.workflowId === activeWorkflowId)
  }, [entries, activeWorkflowId])

  return (
    <ScrollArea className='h-full'>
      <div>
        {filteredEntries.length === 0 ? (
          <div className='flex h-32 items-center justify-center pt-4 text-muted-foreground text-sm'>
            No console entries
          </div>
        ) : (
          filteredEntries.map((entry) => (
            <ConsoleEntry key={entry.id} entry={entry} consoleWidth={panelWidth} />
          ))
        )}
      </div>
    </ScrollArea>
  )
}
