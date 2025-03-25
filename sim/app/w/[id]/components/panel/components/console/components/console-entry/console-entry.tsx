import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { AlertCircle, AlertTriangle, Calendar, CheckCircle2, Clock, Terminal } from 'lucide-react'
import { ConsoleEntry as ConsoleEntryType } from '@/stores/panel/console/types'
import { getBlock } from '@/blocks'
import { JSONView } from '../json-view/json-view'

interface ConsoleEntryProps {
  entry: ConsoleEntryType
  consoleWidth: number
}

export function ConsoleEntry({ entry, consoleWidth }: ConsoleEntryProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const blockConfig = useMemo(() => {
    if (!entry.blockType) return null
    return getBlock(entry.blockType)
  }, [entry.blockType])

  const BlockIcon = blockConfig?.icon

  const statusIcon = entry.error ? (
    <AlertCircle className="h-4 w-4 text-destructive" />
  ) : entry.warning ? (
    <AlertTriangle className="h-4 w-4 text-warning" />
  ) : (
    <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
  )

  return (
    <div
      className={`border-b border-border transition-colors ${
        !entry.error && !entry.warning ? 'hover:bg-accent/50 cursor-pointer' : ''
      }`}
      onClick={() => !entry.error && !entry.warning && setIsExpanded(!isExpanded)}
    >
      <div className="p-4 space-y-4">
        <div
          className={`${
            consoleWidth >= 400 ? 'flex items-center justify-between' : 'grid gap-4 grid-cols-1'
          }`}
        >
          {entry.blockName && (
            <div className="flex items-center gap-2 text-sm">
              {BlockIcon ? (
                <BlockIcon className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Terminal className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="text-muted-foreground">{entry.blockName}</span>
            </div>
          )}
          <div
            className={`${
              consoleWidth >= 400 ? 'flex gap-4' : 'grid grid-cols-2 gap-4'
            } text-sm text-muted-foreground`}
          >
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              <span>{format(new Date(entry.startedAt), 'HH:mm:ss')}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              <span>Duration: {entry.durationMs}ms</span>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {!entry.error && !entry.warning && (
            <div className="flex items-start gap-2">
              <Terminal className="h-4 w-4 text-muted-foreground mt-1" />
              <div className="text-sm font-mono flex-1">
                <JSONView data={entry.output} initiallyExpanded={isExpanded} />
              </div>
            </div>
          )}

          {entry.error && (
            <div className="flex items-start gap-2 border rounded-md p-3 border-red-500 bg-red-50 text-destructive dark:border-border dark:text-foreground dark:bg-background">
              <AlertCircle className="h-4 w-4 text-red-500 mt-1" />
              <div className="flex-1 break-all">
                <div className="font-medium">Error</div>
                <pre className="text-sm whitespace-pre-wrap">{entry.error}</pre>
              </div>
            </div>
          )}

          {entry.warning && (
            <div className="flex items-start gap-2 border rounded-md p-3 border-yellow-500 bg-yellow-50 text-yellow-700 dark:border-border dark:text-yellow-500 dark:bg-background">
              <AlertTriangle className="h-4 w-4 text-yellow-500 mt-1" />
              <div className="flex-1 break-all">
                <div className="font-medium">Warning</div>
                <pre className="text-sm whitespace-pre-wrap">{entry.warning}</pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
