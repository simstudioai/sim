import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Terminal,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConsoleEntry as ConsoleEntryType } from '@/stores/panel/console/types'
import { getBlock } from '@/blocks'
import { JSONView } from '../json-view/json-view'

interface ConsoleEntryProps {
  entry: ConsoleEntryType
  consoleWidth: number
}

// Maximum character length for a word before it's broken up
const MAX_WORD_LENGTH = 25

const WordWrap = ({ text }: { text: string }) => {
  if (!text) return null

  // Split text into words, keeping spaces and punctuation
  const parts = text.split(/(\s+)/g)

  return (
    <>
      {parts.map((part, index) => {
        // If the part is whitespace or shorter than the max length, render it as is
        if (part.match(/\s+/) || part.length <= MAX_WORD_LENGTH) {
          return <span key={index}>{part}</span>
        }

        // For long words, break them up into chunks
        const chunks = []
        for (let i = 0; i < part.length; i += MAX_WORD_LENGTH) {
          chunks.push(part.substring(i, i + MAX_WORD_LENGTH))
        }

        return (
          <span key={index} className="break-all">
            {chunks.map((chunk, chunkIndex) => (
              <span key={chunkIndex}>{chunk}</span>
            ))}
          </span>
        )
      })}
    </>
  )
}

export function ConsoleEntry({ entry, consoleWidth }: ConsoleEntryProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [expandAllJson, setExpandAllJson] = useState(false)

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

  // Helper function to check if data has nested objects or arrays
  const hasNestedStructure = (data: any): boolean => {
    if (data === null || typeof data !== 'object') return false

    // Check if it's an empty object or array
    if (Object.keys(data).length === 0) return false

    // For arrays, check if any element is an object
    if (Array.isArray(data)) {
      return data.some((item) => typeof item === 'object' && item !== null)
    }

    // For objects, check if any value is an object
    return Object.values(data).some((value) => typeof value === 'object' && value !== null)
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
              <div className="text-sm font-mono flex-1 break-normal whitespace-normal overflow-wrap-anywhere relative">
                {typeof entry.output === 'object' &&
                  entry.output !== null &&
                  hasNestedStructure(entry.output) && (
                    <div className="absolute right-0 top-0 z-10">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation()
                          setExpandAllJson(!expandAllJson)
                        }}
                      >
                        <span className="flex items-center">
                          {expandAllJson ? (
                            <>
                              <ChevronUp className="h-3 w-3 mr-1" />
                              <span className="text-xs">Collapse all</span>
                            </>
                          ) : (
                            <>
                              <ChevronDown className="h-3 w-3 mr-1" />
                              <span className="text-xs">Expand all</span>
                            </>
                          )}
                        </span>
                      </Button>
                    </div>
                  )}
                <JSONView data={entry.output} initiallyExpanded={expandAllJson} />
              </div>
            </div>
          )}

          {entry.error && (
            <div className="flex items-start gap-2 border rounded-md p-3 border-red-500 bg-red-50 text-destructive dark:border-border dark:text-foreground dark:bg-background">
              <AlertCircle className="h-4 w-4 text-red-500 mt-1 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium">Error</div>
                <div className="text-sm whitespace-pre-wrap overflow-hidden w-full">
                  <WordWrap text={entry.error} />
                </div>
              </div>
            </div>
          )}

          {entry.warning && (
            <div className="flex items-start gap-2 border rounded-md p-3 border-yellow-500 bg-yellow-50 text-yellow-700 dark:border-border dark:text-yellow-500 dark:bg-background">
              <AlertTriangle className="h-4 w-4 text-yellow-500 mt-1 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium">Warning</div>
                <div className="text-sm whitespace-pre-wrap overflow-hidden w-full">
                  <WordWrap text={entry.warning} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
