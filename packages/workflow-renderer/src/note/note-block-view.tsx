import { memo, type ReactNode, useMemo } from 'react'
import remarkBreaks from 'remark-breaks'
import { Streamdown } from 'streamdown'
import 'streamdown/styles.css'
import { cn, handleKeyboardActivation } from '@sim/emcn'
import { getEmbedInfo } from '@sim/utils/media-embed'
import { BLOCK_DIMENSIONS, getNoteBlockHeight } from '../dimensions'
import { OverflowSpan } from '../lib/overflow-span'
import { useActionMenuSwell } from '../workflow-block/use-action-menu-swell'
import {
  WorkflowBlockBorder,
  type WorkflowBorderPort,
} from '../workflow-block/workflow-block-border'

const EMBED_SCALE = 0.78
const EMBED_INVERSE_SCALE = `${(1 / EMBED_SCALE) * 100}%`
const ACTION_MENU_RIGHT_INSET_PX = 24
const ACTION_MENU_MAX_WIDTH_PX = BLOCK_DIMENSIONS.FIXED_WIDTH - ACTION_MENU_RIGHT_INSET_PX * 2
const ACTION_MENU_AMPLITUDE = 7

/**
 * Compact markdown renderer for note blocks with tight spacing
 */
const NOTE_REMARK_PLUGINS = [remarkBreaks]

const NOTE_COMPONENTS = {
  p: ({ children }: { children?: ReactNode }) => (
    <p className='mb-1 break-words text-[var(--text-primary)] text-sm leading-[1.25rem] last:mb-0'>
      {children}
    </p>
  ),
  h1: ({ children }: { children?: ReactNode }) => (
    <h1 className='mt-3 mb-3 break-words text-[var(--text-primary)] text-lg first:mt-0'>
      {children}
    </h1>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <h2 className='mt-2.5 mb-2.5 break-words text-[var(--text-primary)] text-base first:mt-0'>
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <h3 className='mt-2 mb-2 break-words text-[var(--text-primary)] text-sm first:mt-0'>
      {children}
    </h3>
  ),
  h4: ({ children }: { children?: ReactNode }) => (
    <h4 className='mt-2 mb-2 break-words text-[var(--text-primary)] text-xs first:mt-0'>
      {children}
    </h4>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className='mt-1 mb-1 list-disc space-y-1 break-words pl-6 text-[var(--text-primary)] text-sm'>
      {children}
    </ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className='mt-1 mb-1 list-decimal space-y-1 break-words pl-6 text-[var(--text-primary)] text-sm'>
      {children}
    </ol>
  ),
  li: ({ children }: { children?: ReactNode }) => <li className='break-words'>{children}</li>,
  inlineCode: ({ children }: { children?: ReactNode }) => (
    <code className='whitespace-normal rounded bg-[var(--surface-5)] px-1 py-0.5 font-mono text-[var(--caution)] text-xs'>
      {children}
    </code>
  ),
  code: ({ children, className, ...props }: { children?: ReactNode; className?: string }) => (
    <code
      {...props}
      className='block whitespace-pre-wrap break-words rounded bg-[var(--surface-5)] p-2 text-[var(--text-primary)] text-xs'
    >
      {children}
    </code>
  ),
  a: ({ href, children }: { href?: string; children?: ReactNode }) => {
    const embedInfo = href ? getEmbedInfo(href) : null
    if (embedInfo) {
      return (
        <span className='my-2 block w-full'>
          <a
            href={href}
            target='_blank'
            rel='noopener noreferrer'
            className='mb-1 block break-all text-[var(--brand-secondary)] underline-offset-2 hover-hover:underline'
          >
            {children}
          </a>
          <span className='block w-full overflow-hidden rounded-md'>
            {embedInfo.type === 'iframe' && (
              <span
                className='block overflow-hidden'
                style={{
                  width: '100%',
                  aspectRatio: embedInfo.aspectRatio || '16/9',
                }}
              >
                <iframe
                  src={embedInfo.url}
                  title='Media'
                  allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
                  allowFullScreen
                  loading='lazy'
                  className='origin-top-left'
                  style={{
                    width: EMBED_INVERSE_SCALE,
                    height: EMBED_INVERSE_SCALE,
                    transform: `scale(${EMBED_SCALE})`,
                  }}
                />
              </span>
            )}
            {embedInfo.type === 'video' && (
              <video
                src={embedInfo.url}
                controls
                preload='metadata'
                className='aspect-video w-full'
              >
                <track kind='captions' src='' default />
              </video>
            )}
            {embedInfo.type === 'audio' && (
              <audio src={embedInfo.url} controls preload='metadata' className='w-full'>
                <track kind='captions' src='' default />
              </audio>
            )}
          </span>
        </span>
      )
    }
    return (
      <a
        href={href}
        target='_blank'
        rel='noopener noreferrer'
        className='break-all text-[var(--brand-secondary)] underline-offset-2 hover-hover:underline'
      >
        {children}
      </a>
    )
  },
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className='break-words font-semibold text-[var(--text-primary)]'>{children}</strong>
  ),
  em: ({ children }: { children?: ReactNode }) => (
    <em className='break-words text-[var(--text-tertiary)]'>{children}</em>
  ),
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className='my-4 break-words border-[var(--border)] border-l-2 pl-4 text-[var(--text-primary)] italic [&>p:first-child]:mt-0 [&>p:last-child]:mb-0 [&>p]:my-2'>
      {children}
    </blockquote>
  ),
  table: ({ children }: { children?: ReactNode }) => (
    <div className='my-2 max-w-full overflow-x-auto'>
      <table className='w-full border-collapse text-xs'>{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: ReactNode }) => (
    <thead className='border-[var(--border)] border-b'>{children}</thead>
  ),
  tbody: ({ children }: { children?: ReactNode }) => <tbody>{children}</tbody>,
  tr: ({ children }: { children?: ReactNode }) => (
    <tr className='border-[var(--border)] border-b last:border-b-0'>{children}</tr>
  ),
  th: ({ children }: { children?: ReactNode }) => (
    <th className='px-2 py-1 text-left text-[var(--text-primary)]'>{children}</th>
  ),
  td: ({ children }: { children?: ReactNode }) => (
    <td className='px-2 py-1 text-[var(--text-secondary)]'>{children}</td>
  ),
}

const NoteMarkdown = memo(function NoteMarkdown({ content }: { content: string }) {
  return (
    <Streamdown mode='static' remarkPlugins={NOTE_REMARK_PLUGINS} components={NOTE_COMPONENTS}>
      {content}
    </Streamdown>
  )
})

/**
 * Props for the pure note renderer. The container resolves the markdown content
 * (from the block's subblock value), enabled/ring visual state, and the select
 * handler; the editor-only action bar is injected via the `actionBar` slot.
 */
export interface NoteBlockViewProps {
  name?: string
  /** Markdown content; an empty string renders the placeholder. */
  content: string
  isEnabled: boolean
  hasRing: boolean
  ringStyles: string
  /** Selects this note in the editor panel. */
  onSelect: () => void
  /** Editor-only action bar; omit in read-only / preview contexts. */
  actionBar?: ReactNode
}

/**
 * Pure renderer for a note block: a draggable card with a title and a markdown
 * body (rich text + embeds). Carries no store, socket, or permission coupling.
 */
export function NoteBlockView({
  name,
  content,
  isEnabled,
  hasRing,
  ringStyles,
  onSelect,
  actionBar,
}: NoteBlockViewProps) {
  const isEmpty = content.trim().length === 0
  const isSelected = hasRing && ringStyles.includes('--text-secondary')
  const blockHeight = getNoteBlockHeight(isEmpty)
  const showActionMenu = Boolean(actionBar)
  const {
    rootRef: actionMenuRootRef,
    hostRef: actionMenuHostRef,
    width: actionMenuWidth,
    swellOpen: actionMenuSwellOpen,
    contentVisible: actionMenuContentVisible,
    setReady: setActionMenuSwellReady,
    onFocusCapture: handleActionMenuFocus,
    onBlurCapture: handleActionMenuBlur,
  } = useActionMenuSwell({
    enabled: showActionMenu,
    forceOpen: isSelected,
    maxWidth: ACTION_MENU_MAX_WIDTH_PX,
  })
  const borderPorts = useMemo<WorkflowBorderPort[]>(
    () =>
      showActionMenu
        ? [
            {
              id: 'action-menu',
              side: 'top',
              position: { fromEnd: ACTION_MENU_RIGHT_INSET_PX + actionMenuWidth / 2 },
              plateau: actionMenuWidth,
              restAmplitude: actionMenuSwellOpen ? ACTION_MENU_AMPLITUDE : 0,
              hoverAmplitude: ACTION_MENU_AMPLITUDE,
              magnetizable: false,
            },
          ]
        : [],
    [actionMenuSwellOpen, actionMenuWidth, showActionMenu]
  )

  return (
    <div
      ref={actionMenuRootRef}
      className='group relative'
      data-action-menu-ready={actionMenuContentVisible ? '' : undefined}
      data-node-selected={isSelected ? '' : undefined}
    >
      {showActionMenu && (
        <>
          <div
            aria-hidden='true'
            data-workflow-action-bar-bridge=''
            className='-top-[28px] pointer-events-auto absolute inset-x-0 z-10 h-[28px]'
          />
          <div
            ref={actionMenuHostRef}
            onFocusCapture={handleActionMenuFocus}
            onBlurCapture={handleActionMenuBlur}
          >
            {actionBar}
          </div>
        </>
      )}
      <div
        role='button'
        tabIndex={0}
        className='note-drag-handle relative z-20 w-[250px] cursor-grab select-none rounded-2xl [&:active]:cursor-grabbing'
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.target === event.currentTarget) {
            handleKeyboardActivation(event, onSelect)
          }
        }}
      >
        <WorkflowBlockBorder
          ports={borderPorts}
          cursorSwellEnabled={false}
          hasRing={hasRing}
          ringStyles={ringStyles}
          isSelected={isSelected}
          bodyFill='var(--surface-3)'
          width={BLOCK_DIMENSIONS.FIXED_WIDTH}
          height={blockHeight}
          onActionMenuReadyChange={setActionMenuSwellReady}
        />

        <div className='relative z-10 flex h-10 items-center justify-between px-2'>
          <div className='flex min-w-0 flex-1 items-center transition-opacity duration-150 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]'>
            <OverflowSpan
              value={name ?? ''}
              className={cn(
                'truncate text-md',
                !isEnabled && 'text-[var(--text-muted)] opacity-50'
              )}
            />
          </div>
        </div>

        <div
          data-note-scroll-region=''
          role='region'
          aria-label={`${name || 'Note'} content`}
          tabIndex={isEmpty ? -1 : 0}
          className={cn(
            'nodrag nopan allow-scroll scrollbar-none relative z-10 max-w-full touch-pan-y overflow-x-hidden break-all p-2',
            !isEmpty && [
              'h-44 overflow-y-auto',
              '[-webkit-mask-image:linear-gradient(to_bottom,transparent_0%,transparent_8%,black_18%,black_94%,transparent_100%)]',
              '[mask-image:linear-gradient(to_bottom,transparent_0%,transparent_8%,black_18%,black_94%,transparent_100%)]',
            ],
            !isEnabled && 'opacity-50'
          )}
        >
          <div className='relative max-w-full py-2'>
            {isEmpty ? (
              <p className='text-[var(--text-placeholder)] text-sm'>Add note…</p>
            ) : (
              <NoteMarkdown content={content} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
