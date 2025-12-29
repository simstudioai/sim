import { memo, useCallback, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import type { NodeProps } from 'reactflow'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/core/utils/cn'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useBlockVisual } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
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
 * Extract YouTube video ID from various YouTube URL formats
 */
function getYouTubeVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})/,
  ]
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }
  return null
}

/**
 * Compact markdown renderer for note blocks with tight spacing
 */
const NoteMarkdown = memo(function NoteMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }: any) => (
          <p className='mb-1 break-words text-[var(--text-primary)] text-sm leading-[1.25rem] last:mb-0'>
            {children}
          </p>
        ),
        h1: ({ children }: any) => (
          <h1 className='mt-3 mb-3 break-words font-semibold text-[var(--text-primary)] text-lg first:mt-0'>
            {children}
          </h1>
        ),
        h2: ({ children }: any) => (
          <h2 className='mt-2.5 mb-2.5 break-words font-semibold text-[var(--text-primary)] text-base first:mt-0'>
            {children}
          </h2>
        ),
        h3: ({ children }: any) => (
          <h3 className='mt-2 mb-2 break-words font-semibold text-[var(--text-primary)] text-sm first:mt-0'>
            {children}
          </h3>
        ),
        h4: ({ children }: any) => (
          <h4 className='mt-2 mb-2 break-words font-semibold text-[var(--text-primary)] text-xs first:mt-0'>
            {children}
          </h4>
        ),
        ul: ({ children }: any) => (
          <ul className='mt-1 mb-1 list-disc space-y-1 break-words pl-6 text-[var(--text-primary)] text-sm'>
            {children}
          </ul>
        ),
        ol: ({ children }: any) => (
          <ol className='mt-1 mb-1 list-decimal space-y-1 break-words pl-6 text-[var(--text-primary)] text-sm'>
            {children}
          </ol>
        ),
        li: ({ children }: any) => <li className='break-words'>{children}</li>,
        code: ({ inline, className, children, ...props }: any) => {
          const isInline = inline || !className?.includes('language-')

          if (isInline) {
            return (
              <code
                {...props}
                className='whitespace-normal rounded bg-[var(--surface-5)] px-1 py-0.5 font-mono text-[#F59E0B] text-xs'
              >
                {children}
              </code>
            )
          }

          return (
            <code
              {...props}
              className='block whitespace-pre-wrap break-words rounded bg-[var(--surface-5)] p-2 text-[var(--text-primary)] text-xs'
            >
              {children}
            </code>
          )
        },
        a: ({ href, children }: any) => {
          const videoId = href ? getYouTubeVideoId(href) : null
          if (videoId) {
            return (
              <span className='inline'>
                <a
                  href={href}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-[var(--brand-secondary)] underline-offset-2 hover:underline'
                >
                  {children}
                </a>
                <span className='mt-1.5 block overflow-hidden rounded-md'>
                  <iframe
                    src={`https://www.youtube.com/embed/${videoId}`}
                    title='YouTube video'
                    allow='accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share'
                    allowFullScreen
                    loading='lazy'
                    referrerPolicy='strict-origin-when-cross-origin'
                    sandbox='allow-scripts allow-same-origin allow-presentation allow-popups'
                    className='aspect-video w-full'
                  />
                </span>
              </span>
            )
          }
          return (
            <a
              href={href}
              target='_blank'
              rel='noopener noreferrer'
              className='text-[var(--brand-secondary)] underline-offset-2 hover:underline'
            >
              {children}
            </a>
          )
        },
        strong: ({ children }: any) => (
          <strong className='break-words font-semibold text-[var(--text-primary)]'>
            {children}
          </strong>
        ),
        em: ({ children }: any) => (
          <em className='break-words text-[var(--text-tertiary)]'>{children}</em>
        ),
        blockquote: ({ children }: any) => (
          <blockquote className='my-4 break-words border-[var(--border-1)] border-l-4 py-1 pl-4 text-[var(--text-tertiary)] italic'>
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

  const { activeWorkflowId, isEnabled, handleClick, hasRing, ringStyles } = useBlockVisual({
    blockId: id,
    data,
  })
  const storedValues = useSubBlockStore(
    useCallback(
      (state) => {
        if (!activeWorkflowId) return undefined
        return state.workflowValues[activeWorkflowId]?.[id]
      },
      [activeWorkflowId, id]
    )
  )

  const content = useMemo(() => {
    if (data.isPreview && data.subBlockValues) {
      const extractedContent = extractFieldValue(data.subBlockValues.content)
      return typeof extractedContent === 'string' ? extractedContent : ''
    }
    const storedContent = extractFieldValue(storedValues?.content)
    return typeof storedContent === 'string' ? storedContent : ''
  }, [data.isPreview, data.subBlockValues, storedValues])

  const isEmpty = content.trim().length === 0

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
          'relative z-[20] w-[250px] cursor-default select-none rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)]'
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
          <div className='flex min-w-0 flex-1 items-center'>
            <span
              className={cn(
                'truncate font-medium text-[16px]',
                !isEnabled && 'text-[var(--text-muted)]'
              )}
              title={name}
            >
              {name}
            </span>
          </div>
        </div>

        <div className='relative p-[8px]'>
          <div className='relative break-words'>
            {isEmpty ? (
              <p className='text-[#868686] text-sm'>Add note...</p>
            ) : (
              <NoteMarkdown content={content} />
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
