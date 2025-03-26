import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { AlertCircle, AlertTriangle, Calendar, CheckCircle2, Clock, Terminal } from 'lucide-react'
import { ConsoleEntry as ConsoleEntryType } from '@/stores/panel/console/types'
import { getBlock } from '@/blocks'
import { JSONView } from '../json-view/json-view'
import { formatDuration } from '@/lib/utils'

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

  const formattedTime = useMemo(() => {
    const date = new Date(entry.timestamp)
    return date.toLocaleTimeString()
  }, [entry.timestamp])

  const renderOutput = (output: any) => {
    if (!output) return null;

    // Handle image upload output
    if (output.type === 'image') {
      return (
        <div className="mt-2">
          <img 
            src={output.data} 
            alt={output.metadata?.fileName || 'Uploaded image'} 
            className="max-w-full h-auto rounded-md shadow-sm"
            style={{ maxHeight: '300px' }}
          />
          <div className="mt-2 text-sm text-muted-foreground">
            <div>File: {output.metadata?.fileName}</div>
            <div>Size: {(output.metadata?.fileSize / 1024).toFixed(2)} KB</div>
            <div>Type: {output.metadata?.mimeType}</div>
          </div>
        </div>
      )
    }

    // Handle image generation output
    if (output.imageUrl) {
      return (
        <div className="mt-2">
          <img 
            src={output.imageUrl} 
            alt={output.metadata?.prompt || 'Generated image'} 
            className="max-w-full h-auto rounded-md shadow-sm"
            style={{ maxHeight: '300px' }}
          />
          <div className="mt-2 text-sm text-muted-foreground">
            <div>Provider: {output.provider}</div>
            {output.metadata && (
              <>
                <div>Prompt: {output.metadata.prompt}</div>
                <div>Model: {output.metadata.model}</div>
                <div>Size: {output.metadata.width}x{output.metadata.height}</div>
              </>
            )}
          </div>
        </div>
      )
    }

    // Handle other types of output
    if (typeof output === 'object') {
      return <pre className="text-sm whitespace-pre-wrap">{JSON.stringify(output, null, 2)}</pre>
    }

    return <span className="text-sm">{String(output)}</span>
  }

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
              <span>{formattedTime}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              <span>{formatDuration(entry.durationMs)}</span>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {!entry.error && !entry.warning && (
            <div className="flex items-start gap-2">
              <Terminal className="h-4 w-4 text-muted-foreground mt-1" />
              <div className="text-sm font-mono flex-1">
                {renderOutput(entry.output)}
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
