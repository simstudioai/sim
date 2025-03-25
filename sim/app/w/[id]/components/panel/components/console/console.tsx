'use client'

import { useMemo } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useConsoleStore } from '@/stores/panel/console/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { ConsoleEntry } from './components/console-entry/console-entry'
import { ImageIcon } from '@/components/icons'

interface ConsoleProps {
  panelWidth: number
}

export function Console({ panelWidth }: ConsoleProps) {
  const entries = useConsoleStore((state) => state.entries)
  const { activeWorkflowId } = useWorkflowRegistry()

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => entry.workflowId === activeWorkflowId)
  }, [entries, activeWorkflowId])

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const reader = new FileReader()
      reader.onload = (e) => {
        const imageData = e.target?.result as string
        useConsoleStore.getState().addConsole({
          workflowId: activeWorkflowId,
          output: {
            type: 'image',
            data: imageData,
            metadata: {
              fileName: file.name,
              fileSize: file.size,
              mimeType: file.type
            }
          },
          durationMs: 0,
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          timestamp: new Date().toISOString()
        })
      }
      reader.readAsDataURL(file)
    } catch (error) {
      console.error('Failed to upload image:', error)
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="pb-16">
        <div className="sticky top-0 z-10 bg-background border-b p-2 flex items-center justify-between">
          <div className="text-sm font-medium">Console</div>
          <label className="cursor-pointer hover:bg-accent p-2 rounded-md">
            <ImageIcon className="h-4 w-4" />
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageUpload}
            />
          </label>
        </div>
        {filteredEntries.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground pt-4">
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
