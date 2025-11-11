import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { type NodeProps, useUpdateNodeInternals } from 'reactflow'
import { cn } from '@/lib/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { usePanelEditorStore } from '@/stores/panel-new/editor/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { useCurrentWorkflow } from '../../hooks'
import { ActionBar } from '../workflow-block/components'
import { useBlockState } from '../workflow-block/hooks'
import type { WorkflowBlockProps } from '../workflow-block/types'

interface NoteBlockNodeData extends WorkflowBlockProps {}

const NOTE_MIN_WIDTH = 220
const NOTE_MIN_HEIGHT = 140

/**
 * Extract string value from subblock value object or primitive
 */
function extractFieldValue(rawValue: unknown): string | undefined {
  if (typeof rawValue === 'string') return rawValue
  if (rawValue && typeof rawValue === 'object' && 'value' in rawValue) {
    const candidate = (rawValue as { value?: unknown }).value
    return typeof candidate === 'string' ? candidate : undefined
  }
  return undefined
}

/**
 * Compact markdown renderer for note blocks with tight spacing
 */
const NoteMarkdown = memo(function NoteMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className='mb-0 text-sm text-[#E5E5E5]'>{children}</p>,
        h1: ({ children }) => <h1 className='mt-0 mb-[-2px] text-lg font-semibold text-[#E5E5E5]'>{children}</h1>,
        h2: ({ children }) => <h2 className='mt-0 mb-[-2px] text-base font-semibold text-[#E5E5E5]'>{children}</h2>,
        h3: ({ children }) => <h3 className='mt-0 mb-[-2px] text-sm font-semibold text-[#E5E5E5]'>{children}</h3>,
        h4: ({ children }) => <h4 className='mt-0 mb-[-2px] text-xs font-semibold text-[#E5E5E5]'>{children}</h4>,
        ul: ({ children }) => <ul className='-mt-[2px] mb-0 list-disc pl-4 text-sm text-[#E5E5E5]'>{children}</ul>,
        ol: ({ children }) => <ol className='-mt-[2px] mb-0 list-decimal pl-4 text-sm text-[#E5E5E5]'>{children}</ol>,
        li: ({ children }) => <li className='mb-0'>{children}</li>,
        code: ({ inline, children }: any) =>
          inline ? (
            <code className='rounded bg-[#393939] px-1 py-0.5 text-xs text-[#F59E0B]'>{children}</code>
          ) : (
            <code className='block rounded bg-[#1A1A1A] p-2 text-xs text-[#E5E5E5]'>{children}</code>
          ),
        a: ({ href, children }) => (
          <a href={href} target='_blank' rel='noopener noreferrer' className='text-[#33B4FF] underline-offset-2 hover:underline'>
            {children}
          </a>
        ),
        strong: ({ children }) => <strong className='font-semibold text-white'>{children}</strong>,
        em: ({ children }) => <em className='text-[#B8B8B8]'>{children}</em>,
        blockquote: ({ children }) => (
          <blockquote className='m-0 border-l-2 border-[#F59E0B] pl-3 italic text-[#B8B8B8]'>{children}</blockquote>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  )
})

export const NoteBlock = memo(function NoteBlock({ id, data }: NodeProps<NoteBlockNodeData>) {
  const { type, config, name } = data
  const containerRef = useRef<HTMLDivElement>(null)
  const sizeRef = useRef<{ width: number; height: number } | null>(null)
  const updateNodeInternals = useUpdateNodeInternals()
  const updateBlockLayoutMetrics = useWorkflowStore((state) => state.updateBlockLayoutMetrics)

  const setCurrentBlockId = usePanelEditorStore((state) => state.setCurrentBlockId)
  const currentBlockId = usePanelEditorStore((state) => state.currentBlockId)
  const isFocused = currentBlockId === id

  const currentWorkflow = useCurrentWorkflow()
  const { isEnabled, isActive, diffStatus, isDeletedBlock } = useBlockState(
    id,
    currentWorkflow,
    data
  )

  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const storedValues = useSubBlockStore(
    useCallback(
      (state) => {
        if (!activeWorkflowId) return undefined
        return state.workflowValues[activeWorkflowId]?.[id]
      },
      [activeWorkflowId, id]
    )
  )

  const noteValues = useMemo(() => {
    if (data.isPreview && data.subBlockValues) {
      const extractedPreviewFormat = extractFieldValue(data.subBlockValues.format)
      const extractedPreviewContent = extractFieldValue(data.subBlockValues.content)
      return {
        format: typeof extractedPreviewFormat === 'string' ? extractedPreviewFormat : 'plain',
        content: typeof extractedPreviewContent === 'string' ? extractedPreviewContent : '',
      }
    }

    const format = extractFieldValue(storedValues?.format)
    const content = extractFieldValue(storedValues?.content)

    return {
      format: typeof format === 'string' ? format : 'plain',
      content: typeof content === 'string' ? content : '',
    }
  }, [data.isPreview, data.subBlockValues, storedValues])

  const content = noteValues.content ?? ''
  const isEmpty = content.trim().length === 0
  const showMarkdown = noteValues.format === 'markdown' && !isEmpty

  const userPermissions = useUserPermissionsContext()

  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return

      const width = Math.max(Math.round(entry.contentRect.width), NOTE_MIN_WIDTH)
      const height = Math.max(Math.round(entry.contentRect.height), NOTE_MIN_HEIGHT)

      const previous = sizeRef.current
      if (!previous || previous.width !== width || previous.height !== height) {
        sizeRef.current = { width, height }
        updateBlockLayoutMetrics(id, { width, height })
        updateNodeInternals(id)
      }
    })

    observer.observe(element)
    return () => observer.disconnect()
  }, [id, updateBlockLayoutMetrics, updateNodeInternals])

  const hasRing =
    isActive || isFocused || diffStatus === 'new' || diffStatus === 'edited' || isDeletedBlock
  const ringStyles = cn(
    hasRing && 'ring-[1.75px]',
    isActive && 'ring-[#8C10FF] animate-pulse-ring',
    isFocused && 'ring-[#33B4FF]',
    diffStatus === 'new' && 'ring-[#22C55F]',
    diffStatus === 'edited' && 'ring-[#FF6600]',
    isDeletedBlock && 'ring-[#EF4444]'
  )

  return (
    <div className='group relative'>
      <div
        ref={containerRef}
        className={cn(
          'relative z-[20] w-[250px] cursor-default select-none rounded-[8px] bg-[#232323]'
        )}
        onClick={() => setCurrentBlockId(id)}
      >
        <ActionBar blockId={id} blockType={type} disabled={!userPermissions.canEdit} />

        <div
          className='note-drag-handle flex cursor-grab items-center justify-between border-[#393939] border-b p-[8px] [&:active]:cursor-grabbing'
          onMouseDown={(event) => {
            event.stopPropagation()
          }}
        >
          <div className='flex min-w-0 flex-1 items-center gap-[10px]'>
            <div
              className='flex h-[24px] w-[24px] flex-shrink-0 items-center justify-center rounded-[6px]'
              style={{ backgroundColor: isEnabled ? config.bgColor : 'gray' }}
            >
              <config.icon className='h-[16px] w-[16px] text-white' />
            </div>
            <span
              className={cn('font-medium text-[16px]', !isEnabled && 'truncate text-[#808080]')}
              title={name}
            >
              {name}
            </span>
          </div>
        </div>

        <div className='relative px-[12px] pt-[6px] pb-[8px]'>
          <div className='relative whitespace-pre-wrap break-words'>
            {isEmpty ? (
              <p className='text-[#868686] text-sm italic'>Add a note...</p>
            ) : showMarkdown ? (
              <NoteMarkdown content={content} />
            ) : (
              <p className='whitespace-pre-wrap text-[#E5E5E5] text-sm leading-relaxed'>{content}</p>
            )}
          </div>
        </div>
        {hasRing && (
          <div
            className={cn('pointer-events-none absolute inset-0 z-40 rounded-[8px]', ringStyles)}
          />
        )}
      </div>
    </div>
  )
})
