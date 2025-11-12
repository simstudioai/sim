import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { BlockDataDisplay } from '@/app/workspace/[workspaceId]/logs/components/trace-spans'
import type { TraceSpan } from '@/stores/logs/filters/types'

interface CollapsibleInputOutputProps {
  span: TraceSpan
  spanId: string
  depth: number
}

export function CollapsibleInputOutput({ span, spanId, depth }: CollapsibleInputOutputProps) {
  const [inputExpanded, setInputExpanded] = useState(false)
  const [outputExpanded, setOutputExpanded] = useState(false)

  const leftMargin = depth * 16 + 8 + 24

  return (
    <div
      className='mt-2 mr-4 mb-4 space-y-3 overflow-hidden'
      style={{ marginLeft: `${leftMargin}px` }}
    >
      {span.input && (
        <div>
          <button
            onClick={() => setInputExpanded(!inputExpanded)}
            className='mb-2 flex items-center gap-2 font-medium text-muted-foreground text-xs transition-colors hover:text-foreground'
          >
            {inputExpanded ? (
              <ChevronDown className='h-3 w-3' />
            ) : (
              <ChevronRight className='h-3 w-3' />
            )}
            Input
          </button>
          {inputExpanded && (
            <div className='mb-2 overflow-hidden rounded-[4px] border border-[var(--border-strong)] bg-[#1F1F1F] p-3'>
              <BlockDataDisplay data={span.input} blockType={span.type} isInput={true} />
            </div>
          )}
        </div>
      )}

      {span.output && (
        <div>
          <button
            onClick={() => setOutputExpanded(!outputExpanded)}
            className='mb-2 flex items-center gap-2 font-medium text-muted-foreground text-xs transition-colors hover:text-foreground'
          >
            {outputExpanded ? (
              <ChevronDown className='h-3 w-3' />
            ) : (
              <ChevronRight className='h-3 w-3' />
            )}
            {span.status === 'error' ? 'Error Details' : 'Output'}
          </button>
          {outputExpanded && (
            <div className='mb-2 overflow-hidden rounded-[4px] border border-[var(--border-strong)] bg-[#1F1F1F] p-3'>
              <BlockDataDisplay
                data={span.output}
                blockType={span.type}
                isInput={false}
                isError={span.status === 'error'}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
