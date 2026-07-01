import { memo, type ReactNode } from 'react'
import remarkBreaks from 'remark-breaks'
import { Streamdown } from 'streamdown'
import 'streamdown/styles.css'
import { cn, handleKeyboardActivation } from '@sim/emcn'
import { getEmbedInfo } from '@sim/utils/media-embed'

const EMBED_SCALE = 0.78
const EMBED_INVERSE_SCALE = `${(1 / EMBED_SCALE) * 100}%`

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
    <h1 className='mt-3 mb-3 break-words font-semibold text-[var(--text-primary)] text-lg first:mt-0'>
      {children}
    </h1>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <h2 className='mt-2.5 mb-2.5 break-words font-semibold text-[var(--text-primary)] text-base first:mt-0'>
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <h3 className='mt-2 mb-2 break-words font-semibold text-[var(--text-primary)] text-sm first:mt-0'>
      {children}
    </h3>
  ),
  h4: ({ children }: { children?: ReactNode }) => (
    <h4 className='mt-2 mb-2 break-words font-semibold text-[var(--text-primary)] text-xs first:mt-0'>
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
    <blockquote className='my-4 break-words border-[var(--divider)] border-l-2 pl-4 text-[var(--text-primary)] italic [&>p:first-child]:mt-0 [&>p:last-child]:mb-0 [&>p]:my-2'>
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
    <th className='px-2 py-1 text-left font-semibold text-[var(--text-primary)]'>{children}</th>
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

  return (
    <div className='group relative'>
      <div
        role='button'
        tabIndex={0}
        className={cn(
          'note-drag-handle relative z-[20] w-[250px] cursor-grab select-none rounded-lg border border-[var(--border)] bg-[var(--surface-2)] [&:active]:cursor-grabbing'
        )}
        onClick={onSelect}
        onKeyDown={(event) => handleKeyboardActivation(event, onSelect)}
      >
        {actionBar}

        <div className='flex items-center justify-between border-[var(--divider)] border-b p-2'>
          <div className='flex min-w-0 flex-1 items-center'>
            <span
              className={cn(
                'truncate font-medium text-md',
                !isEnabled && 'text-[var(--text-muted)]'
              )}
              title={name}
            >
              {name}
            </span>
          </div>
        </div>

        <div className='relative overflow-hidden p-2'>
          <div className='relative max-w-full break-all'>
            {isEmpty ? (
              <p className='text-[var(--text-placeholder)] text-sm'>Add note…</p>
            ) : (
              <NoteMarkdown content={content} />
            )}
          </div>
        </div>
        {hasRing && (
          <div className={cn('pointer-events-none absolute inset-0 z-40 rounded-lg', ringStyles)} />
        )}
      </div>
    </div>
  )
}
