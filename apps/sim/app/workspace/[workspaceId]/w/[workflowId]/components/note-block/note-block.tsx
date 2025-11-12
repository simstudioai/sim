import { memo, useCallback, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import type { NodeProps } from 'reactflow'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useBlockCore } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import {
  BLOCK_DIMENSIONS,
  useBlockDimensions,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-block-dimensions'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { ActionBar } from '../workflow-block/components'
import type { WorkflowBlockProps } from '../workflow-block/types'

interface NoteBlockNodeData extends WorkflowBlockProps {}

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
        p: ({ children }) => <p className='mb-0 text-[#E5E5E5] text-sm'>{children}</p>,
        h1: ({ children }) => (
          <h1 className='mt-0 mb-[-2px] font-semibold text-[#E5E5E5] text-lg'>{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className='mt-0 mb-[-2px] font-semibold text-[#E5E5E5] text-base'>{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className='mt-0 mb-[-2px] font-semibold text-[#E5E5E5] text-sm'>{children}</h3>
        ),
        h4: ({ children }) => (
          <h4 className='mt-0 mb-[-2px] font-semibold text-[#E5E5E5] text-xs'>{children}</h4>
        ),
        ul: ({ children }) => (
          <ul className='-mt-[2px] mb-0 list-disc pl-4 text-[#E5E5E5] text-sm'>{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className='-mt-[2px] mb-0 list-decimal pl-4 text-[#E5E5E5] text-sm'>{children}</ol>
        ),
        li: ({ children }) => <li className='mb-0'>{children}</li>,
        code: ({ inline, children }: any) =>
          inline ? (
            <code className='rounded bg-[var(--divider)] px-1 py-0.5 text-[#F59E0B] text-xs'>
              {children}
            </code>
          ) : (
            <code className='block rounded bg-[#1A1A1A] p-2 text-[#E5E5E5] text-xs'>
              {children}
            </code>
          ),
        a: ({ href, children }) => (
          <a
            href={href}
            target='_blank'
            rel='noopener noreferrer'
            className='text-[var(--brand-secondary)] underline-offset-2 hover:underline'
          >
            {children}
          </a>
        ),
        strong: ({ children }) => <strong className='font-semibold text-white'>{children}</strong>,
        em: ({ children }) => <em className='text-[#B8B8B8]'>{children}</em>,
        blockquote: ({ children }) => (
          <blockquote className='m-0 border-[#F59E0B] border-l-2 pl-3 text-[#B8B8B8] italic'>
            {children}
          </blockquote>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  )
})

export const NoteBlock = memo(function NoteBlock({ id, data }: NodeProps<NoteBlockNodeData>) {
  const { type, config, name } = data

  const { activeWorkflowId, isEnabled, isFocused, handleClick, hasRing, ringStyles } = useBlockCore(
    { blockId: id, data }
  )
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

  /**
   * Calculate deterministic dimensions based on content structure.
   * Uses fixed width and computed height to avoid ResizeObserver jitter.
   */
  useBlockDimensions({
    blockId: id,
    calculateDimensions: () => {
      const contentHeight = isEmpty
        ? BLOCK_DIMENSIONS.NOTE_MIN_CONTENT_HEIGHT
        : BLOCK_DIMENSIONS.NOTE_BASE_CONTENT_HEIGHT
      const calculatedHeight =
        BLOCK_DIMENSIONS.HEADER_HEIGHT + BLOCK_DIMENSIONS.NOTE_CONTENT_PADDING + contentHeight

      return { width: BLOCK_DIMENSIONS.FIXED_WIDTH, height: calculatedHeight }
    },
    dependencies: [isEmpty],
  })

  return (
    <div className='group relative'>
      <div
        className={cn(
          'relative z-[20] w-[250px] cursor-default select-none rounded-[8px] bg-[var(--surface-2)]'
        )}
        onClick={handleClick}
      >
        <ActionBar blockId={id} blockType={type} disabled={!userPermissions.canEdit} />

        <div
          className='note-drag-handle flex cursor-grab items-center justify-between border-[var(--divider)] border-b p-[8px] [&:active]:cursor-grabbing'
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
              <p className='whitespace-pre-wrap text-[#E5E5E5] text-sm leading-relaxed'>
                {content}
              </p>
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
