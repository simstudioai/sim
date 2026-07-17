'use client'

import { type ComponentPropsWithoutRef, memo, useEffect, useMemo, useRef, useState } from 'react'
import { Streamdown } from 'streamdown'
import 'streamdown/styles.css'
// prismjs core must load before its language components — they register on the
// global `Prism` it installs (on `window`/`global`); fixes SSR + client order.
import 'prismjs'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-markup'
import '@sim/emcn/components/code/code.css'
import { Checkbox, CopyCodeButton, cn, highlight, languages, Tooltip } from '@sim/emcn'
import { decodeVfsSegmentSafe } from '@/lib/copilot/vfs/path-utils'
import { faviconUrl } from '@/lib/core/utils/favicon'
import { extractTextContent } from '@/lib/core/utils/react-node-text'
import { ContextMentionIcon } from '@/app/workspace/[workspaceId]/home/components/context-mention-icon'
import {
  type ContentSegment,
  PendingTagIndicator,
  parseSpecialTags,
  SpecialTags,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import type { ChatContextKind, MothershipResource } from '@/app/workspace/[workspaceId]/home/types'
import { useLinkPreview } from '@/hooks/queries/link-preview'
import { useSmoothText } from '@/hooks/use-smooth-text'
import { sanitizeChatDisplayContent } from './chat-sanitize'

const LANG_ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  jsx: 'javascript',
  sh: 'bash',
  shell: 'bash',
  html: 'markup',
  xml: 'markup',
  yml: 'yaml',
  py: 'python',
}

const PROSE_CLASSES = cn(
  'prose prose-base dark:prose-invert max-w-none',
  'font-[family-name:var(--font-inter)] antialiased break-words font-[430] tracking-[0]',
  'prose-headings:font-[600] prose-headings:tracking-[0] prose-headings:text-[var(--text-primary)]',
  'prose-headings:mb-3 prose-headings:mt-6 first:prose-headings:mt-0',
  'prose-p:text-base prose-p:leading-[25px] prose-p:text-[var(--text-primary)]',
  'prose-li:text-base prose-li:leading-[25px] prose-li:text-[var(--text-primary)]',
  'prose-li:my-1',
  'prose-ul:my-4 prose-ol:my-4',
  'prose-strong:font-[600] prose-strong:text-[var(--text-primary)]',
  'prose-a:text-[var(--text-primary)] prose-a:underline prose-a:decoration-dashed prose-a:underline-offset-4',
  'prose-hr:border-[var(--divider)] prose-hr:my-6',
  'prose-table:my-0'
)

/**
 * Soft fade for newly revealed text. Paired with {@link useSmoothText}, which
 * paces the reveal; `stagger: 0` keeps the cadence driven by the pacer rather
 * than an overlapping per-token delay ramp — every span revealed in one tick
 * fades as a unit, so `sep: 'word'` looks identical to `sep: 'char'` while
 * creating ~5x fewer spans. That span count is the dominant mid-stream cost:
 * the animate plugin rebuilds a span per token for the WHOLE trailing block on
 * every reveal tick, so per-char wrapping of a long paragraph meant thousands
 * of hast nodes + React elements reconciled ~40x/sec. Streamdown's
 * prev-content tracking keeps a word that grows across two ticks from
 * re-fading (its continuation renders unfaded), and the pacer's word-boundary
 * snapping makes such splits rare to begin with.
 */
const STREAM_ANIMATION = {
  animation: 'fadeIn',
  duration: 220,
  stagger: 0,
  sep: 'word',
} as const

/**
 * How long after the reveal fully settles before the animated tree is dropped.
 * Must exceed {@link STREAM_ANIMATION}'s 220ms duration so the last characters
 * finish fading at full opacity before their spans are swapped for plain text.
 */
const ANIMATION_DRAIN_MS = 300

/**
 * Once a segment has revealed this many characters, new text stops fading in;
 * the word-paced reveal itself is unchanged. Fade cost scales with segment
 * length — every reveal tick rebuilds a span per word for the WHOLE trailing
 * markdown block — so on an unbroken wall of text it eventually swamps the
 * frame budget (measured: ~9k-char single paragraphs spent ~30% of main-thread
 * time in long tasks) while the fade itself is imperceptible detail that deep
 * into a reply.
 */
const FADE_MAX_REVEALED_CHARS = 6000

function startsInlineWord(value: string): boolean {
  return /^[A-Za-z0-9_(]/.test(value)
}

function endsInlineWord(value: string): boolean {
  return /[A-Za-z0-9_)]$/.test(value)
}

function nextInlineSegmentLabel(segment?: ContentSegment): string {
  if (!segment) return ''
  // Thinking segments are never rendered, so they contribute no following text.
  if (segment.type === 'text') return segment.content
  if (segment.type === 'workspace_resource') return segment.data.title || segment.data.id || ''
  return ''
}

function appendInlineReferenceMarkdown(
  currentMarkdown: string,
  referenceMarkdown: string,
  nextSegment?: ContentSegment
): string {
  let nextMarkdown = currentMarkdown
  if (currentMarkdown && endsInlineWord(currentMarkdown) && !/\s$/.test(currentMarkdown)) {
    nextMarkdown += ' '
  }

  nextMarkdown += referenceMarkdown

  const followingText = nextInlineSegmentLabel(nextSegment)
  if (
    followingText &&
    startsInlineWord(followingText) &&
    !/^\s/.test(followingText) &&
    !/\s$/.test(nextMarkdown)
  ) {
    nextMarkdown += ' '
  }

  return nextMarkdown
}

type TdProps = ComponentPropsWithoutRef<'td'>
type ThProps = ComponentPropsWithoutRef<'th'>

/**
 * Maps a `#wsres-{type}-{ref}` link's resource type to the chat-context kind
 * whose icon represents it, so inline resource references render the same
 * type icon as the user-input context chips.
 */
const WSRES_LINK_KINDS: Record<string, ChatContextKind | undefined> = {
  workflow: 'workflow',
  table: 'table',
  file: 'file',
}

/**
 * Label used to pick a file link's extension-aware document icon. The visible
 * link text can be a custom title without an extension, so prefer the file
 * name carried in the link's VFS path (its last extension-bearing segment).
 */
function fileIconLabel(ref: string, fallback: string): string {
  const segments = ref.split('/').filter(Boolean)
  for (let i = segments.length - 1; i >= 0; i--) {
    const decoded = decodeVfsSegmentSafe(segments[i])
    if (decoded.includes('.')) return decoded
  }
  return fallback
}

/** Hides a favicon img that failed to load so the link degrades to plain text. */
function hideBrokenFavicon(e: React.SyntheticEvent<HTMLImageElement>): void {
  e.currentTarget.style.display = 'none'
}

interface ExternalLinkTooltipProps {
  href: string
  hostname: string
}

/**
 * OG-metadata card for an external link's tooltip. Rendered only while the
 * tooltip is open (Radix lazy-mounts content), so the preview request fires on
 * hover intent; until metadata arrives — or when the site has none — it shows
 * the destination URL.
 */
function ExternalLinkTooltip({ href, hostname }: ExternalLinkTooltipProps) {
  const { data } = useLinkPreview(href)
  const preview = data?.preview

  if (!preview?.title && !preview?.description) {
    return <span className='break-all'>{href}</span>
  }

  return (
    <span className='flex flex-col gap-0.5'>
      {preview.title && <span className='font-medium'>{preview.title}</span>}
      {preview.description && (
        <span className='line-clamp-2 text-[var(--text-muted)]'>{preview.description}</span>
      )}
      <span className='text-[var(--text-muted)]'>{preview.siteName ?? hostname}</span>
    </span>
  )
}

/**
 * Hostname for an external http(s) link, used to fetch its favicon. Returns
 * null for relative, anchor, mailto, and unparsable hrefs so those keep the
 * plain underlined treatment.
 */
function externalLinkHostname(href?: string): string | null {
  if (!href || !/^https?:\/\//i.test(href)) return null
  try {
    return new URL(href).hostname
  } catch {
    return null
  }
}

const MARKDOWN_COMPONENTS = {
  table({ children }: { children?: React.ReactNode }) {
    return (
      <div className='not-prose my-4 w-full overflow-x-auto [&_strong]:font-[600]'>
        <table className='min-w-full border-collapse [&_tbody_tr:last-child_td]:border-b-0'>
          {children}
        </table>
      </div>
    )
  },
  thead({ children }: { children?: React.ReactNode }) {
    return <thead>{children}</thead>
  },
  th({ children, style }: ThProps) {
    return (
      <th
        style={style}
        className='whitespace-nowrap border-[var(--divider)] border-b px-3 py-2 text-left font-[600] text-[var(--text-primary)] text-sm leading-6'
      >
        {children}
      </th>
    )
  },
  td({ children, style }: TdProps) {
    return (
      <td
        style={style}
        className='whitespace-nowrap border-[var(--divider)] border-b px-3 py-2 text-[var(--text-primary)] text-sm leading-6'
      >
        {children}
      </td>
    )
  },
  code({ children, className }: { children?: React.ReactNode; className?: string }) {
    const langMatch = className?.match(/language-(\w+)/)
    const language = langMatch ? langMatch[1] : ''
    const codeString = extractTextContent(children)

    if (!codeString) {
      return (
        <pre className='not-prose my-6 overflow-x-auto rounded-lg bg-[var(--surface-5)] p-4 font-[430] font-mono text-[var(--text-primary)] text-small leading-[21px] dark:bg-[var(--code-bg)]'>
          <code>{children}</code>
        </pre>
      )
    }

    const resolved = LANG_ALIASES[language] || language || 'javascript'
    const grammar = languages[resolved] || languages.javascript
    const html = highlight(codeString.trimEnd(), grammar, resolved)

    return (
      <div className='not-prose my-6 overflow-hidden rounded-lg border border-[var(--divider)]'>
        <div className='flex items-center justify-between border-[var(--divider)] border-b bg-[var(--surface-4)] px-4 py-2 dark:bg-[var(--surface-4)]'>
          <span className='text-[var(--text-tertiary)] text-xs'>{language || 'code'}</span>
          <CopyCodeButton
            code={codeString}
            className='-mr-2 text-[var(--text-tertiary)] hover-hover:bg-[var(--surface-5)] hover-hover:text-[var(--text-secondary)]'
          />
        </div>
        <div className='code-editor-theme bg-[var(--surface-5)] dark:bg-[var(--code-bg)]'>
          <pre
            className='m-0 overflow-x-auto whitespace-pre p-4 font-[430] font-mono text-[var(--text-primary)] text-small leading-[21px]'
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>
    )
  },
  a({ children, href }: { children?: React.ReactNode; href?: string }) {
    if (href?.startsWith('#wsres-')) {
      const match = href.match(/^#wsres-(\w+)-(.+)$/)
      const type = match?.[1]
      const ref = match?.[2]
      const kind = type ? WSRES_LINK_KINDS[type] : undefined
      const label = extractTextContent(children)
      return (
        <a
          href={href}
          className={cn(
            'text-[var(--text-primary)]',
            kind
              ? 'not-prose inline-flex items-baseline gap-1 rounded-[5px] bg-[var(--surface-5)] px-[5px] no-underline transition-colors hover-hover:bg-[var(--surface-6)]'
              : 'underline decoration-dashed underline-offset-4'
          )}
          onClick={(e) => {
            e.preventDefault()
            if (!type || !ref) return
            const linkText = label || ref
            window.dispatchEvent(
              new CustomEvent('wsres-click', {
                detail:
                  type === 'file'
                    ? { type, path: ref, title: linkText }
                    : { type, id: ref, title: linkText },
              })
            )
          }}
        >
          {kind && ref && (
            <ContextMentionIcon
              context={{ kind, label: kind === 'file' ? fileIconLabel(ref, label) : label }}
              className='relative top-0.5 size-[12px] flex-shrink-0 text-[var(--text-icon)]'
            />
          )}
          {children}
        </a>
      )
    }
    const hostname = externalLinkHostname(href)
    if (hostname && href) {
      return (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <a
              href={href}
              className='not-prose group text-[var(--text-primary)] no-underline'
              target='_blank'
              rel='noopener noreferrer'
            >
              <img
                src={faviconUrl(hostname, 32)}
                alt=''
                className='relative top-[0.5px] mr-[2px] inline size-[12px] rounded-[3px]'
                onError={hideBrokenFavicon}
              />
              <span className='underline decoration-[color:var(--text-muted)] underline-offset-4 transition-colors group-hover:decoration-[color:var(--text-primary)]'>
                {children}
              </span>
            </a>
          </Tooltip.Trigger>
          <Tooltip.Content side='top'>
            <ExternalLinkTooltip href={href} hostname={hostname} />
          </Tooltip.Content>
        </Tooltip.Root>
      )
    }
    return (
      <a
        href={href}
        className='text-[var(--text-primary)] underline decoration-dashed underline-offset-4'
        target='_blank'
        rel='noopener noreferrer'
      >
        {children}
      </a>
    )
  },
  ul({ children, className }: { children?: React.ReactNode; className?: string }) {
    if (className?.includes('contains-task-list')) {
      return <ul className='my-4 list-none space-y-2 pl-0'>{children}</ul>
    }
    return <ul className='my-4 list-disc pl-5 marker:text-[var(--text-primary)]'>{children}</ul>
  },
  ol({ children }: { children?: React.ReactNode }) {
    return <ol className='my-4 list-decimal pl-5 marker:text-[var(--text-primary)]'>{children}</ol>
  },
  li({ children, className }: { children?: React.ReactNode; className?: string }) {
    if (className?.includes('task-list-item')) {
      return (
        <li className='flex list-none items-start gap-2 text-[var(--text-primary)] text-base leading-[25px] [&>p:only-child]:inline [&>p]:my-0'>
          {children}
        </li>
      )
    }
    return (
      <li className='my-1 text-[var(--text-primary)] text-base leading-[25px] marker:text-[var(--text-primary)] [&>p:only-child]:inline [&>p]:my-0'>
        {children}
      </li>
    )
  },
  inlineCode({ children }: { children?: React.ReactNode }) {
    return (
      <code className='whitespace-normal rounded bg-[var(--surface-5)] px-1.5 py-0.5 font-[400] font-mono text-[var(--text-primary)] not-italic before:content-none after:content-none'>
        {children}
      </code>
    )
  },
  blockquote({ children }: { children?: React.ReactNode }) {
    return (
      <blockquote className='my-4 break-words border-[var(--divider)] border-l-2 pl-4 text-[var(--text-primary)] italic [&>p:first-child]:mt-0 [&>p:last-child]:mb-0 [&>p]:my-2'>
        {children}
      </blockquote>
    )
  },
  input({ type, checked }: { type?: string; checked?: boolean }) {
    if (type === 'checkbox') {
      return <Checkbox checked={checked || false} disabled size='sm' className='mt-1.5 shrink-0' />
    }
    return <input type={type} checked={checked} readOnly />
  },
  em({ children }: { children?: React.ReactNode }) {
    return <em className='text-[var(--text-primary)] italic'>{children}</em>
  },
  del({ children }: { children?: React.ReactNode }) {
    return <del className='text-[var(--text-tertiary)] line-through'>{children}</del>
  },
  img({ src, alt }: ComponentPropsWithoutRef<'img'>) {
    if (typeof src !== 'string' || !src) return null
    return (
      <img
        src={src}
        alt={alt ?? ''}
        loading='lazy'
        className='my-4 h-auto max-w-full rounded-lg border border-[var(--divider)]'
      />
    )
  },
}

interface ChatContentProps {
  content: string
  isStreaming?: boolean
  /** Transcript-derived answers for this message's question card (renders the recap). */
  questionAnswers?: string[]
  onOptionSelect?: (id: string) => void
  onWorkspaceResourceSelect?: (resource: MothershipResource) => void
  onRevealStateChange?: (isRevealing: boolean) => void
  /** Reports whether this segment is actively painting text or its own pending-tag indicator. */
  onStreamActivityChange?: (active: boolean) => void
}

function ChatContentInner({
  content,
  isStreaming = false,
  questionAnswers,
  onOptionSelect,
  onWorkspaceResourceSelect,
  onRevealStateChange,
  onStreamActivityChange,
}: ChatContentProps) {
  const onWorkspaceResourceSelectRef = useRef(onWorkspaceResourceSelect)
  onWorkspaceResourceSelectRef.current = onWorkspaceResourceSelect

  const onRevealStateChangeRef = useRef(onRevealStateChange)
  onRevealStateChangeRef.current = onRevealStateChange

  const displayContent = useMemo(() => sanitizeChatDisplayContent(content), [content])
  const streamedContent = useSmoothText(displayContent, isStreaming)
  const hasRevealBacklog = streamedContent.length < displayContent.length
  const isRevealing = isStreaming || hasRevealBacklog

  useEffect(() => {
    onRevealStateChangeRef.current?.(isRevealing)
  }, [isRevealing])

  /**
   * Streaming-tree lifecycle. While a message streams (and until its reveal
   * drains), it renders through Streamdown's streaming/animated pipeline, whose
   * animate plugin wraps every character in its own `<span data-sd-animate>` —
   * thousands of DOM nodes per streamed message. Holding that tree forever made
   * long sessions progressively laggier until a refresh (which renders the same
   * transcript static). `animationDrained` flips one-way
   * {@link ANIMATION_DRAIN_MS} after the reveal settles and swaps to the static
   * pipeline; the drain window lets the last 220ms fades finish so the swap
   * trades identical pixels, unlike flipping at `isRevealing`'s edge, which cut
   * running fades short (the old completion flash).
   *
   * The swap must REMOUNT Streamdown (via `key`), not just flip its props:
   * Streamdown's default element components are memoized on className + source
   * position (`E`/`qe` in streamdown 2.5), so a re-parse of unchanged content
   * without the animate plugin bails at every unoverridden element (`p`,
   * `strong`, `tr`, headings, …) and leaves the stale per-char span DOM in
   * place. Every instance renders through the streaming parser (see
   * `streamingTree` below) so the remount only sheds the spans, never
   * re-interprets the markdown.
   *
   * The drain is deliberately one-way: a stream that resumes afterwards
   * (reconnect/continuation) reveals paced but unfaded, because re-arming
   * mounts a fresh animate plugin with no prev-content tracking, which would
   * re-fade the entire already-visible message.
   */
  const [streamedThisSession, setStreamedThisSession] = useState(false)
  const [animationDrained, setAnimationDrained] = useState(false)
  const [fadeCutoff, setFadeCutoff] = useState(false)

  /**
   * The per-session latches above outlive the content when React reuses this
   * instance for a different logical message — parent rows key by turn
   * position and text segments by run ordinal (both deliberately stable across
   * the live→persisted id swap), so an ordinal shift or regeneration can hand
   * a settled instance brand-new content whose stale `animationDrained` would
   * silently render the new stream static. Reset the latches when the content
   * is REPLACED (not an append of the previous string) after the instance has
   * settled. A resumed turn only ever appends, so this never undoes the
   * one-way drain; mid-stream sanitize rewrites are excluded by the
   * `animationDrained` gate (the drain only fires after settle). All latches
   * are render-phase `useState` adjustments (prev-tracker idiom), not refs —
   * they are read during render, and state is concurrent-safe where a
   * render-phase ref mutation is not.
   */
  const [prevDisplayContent, setPrevDisplayContent] = useState(displayContent)
  if (prevDisplayContent !== displayContent) {
    setPrevDisplayContent(displayContent)
    if (!displayContent.startsWith(prevDisplayContent) && animationDrained) {
      setStreamedThisSession(false)
      setFadeCutoff(false)
      setAnimationDrained(false)
    }
  }

  if (isStreaming && !streamedThisSession) setStreamedThisSession(true)

  useEffect(() => {
    if (isRevealing || animationDrained || !streamedThisSession) return
    const timeout = setTimeout(() => setAnimationDrained(true), ANIMATION_DRAIN_MS)
    return () => clearTimeout(timeout)
  }, [isRevealing, animationDrained, streamedThisSession])

  /**
   * Every mount renders through the streaming parser (remend +
   * incomplete-markdown repair + block-split) — `mode='static'` is never used.
   * The two pipelines parse edge-case markdown differently (unbalanced fences,
   * list continuation across blocks), so a message you watched stream would
   * render subtly differently from the same message reloaded from the DB; one
   * pipeline makes in-session and refreshed renders byte-identical. The rows
   * are virtualized, so only visible messages pay the block-split mount cost.
   * `streamingTree` (the remount key and animation props) still drops at
   * drain, so a settled instance re-renders through the SAME parser minus the
   * per-word animation spans — identical pixels.
   */
  const streamingTree = (isRevealing || streamedThisSession) && !animationDrained

  /**
   * One-way fade cutoff (see {@link FADE_MAX_REVEALED_CHARS}). Latched so a
   * sanitize-induced content shrink back across the boundary cannot re-arm
   * `animated` — a fresh animate plugin has no prev-content tracking and would
   * re-fade the entire visible segment.
   */
  if (!fadeCutoff && streamedContent.length > FADE_MAX_REVEALED_CHARS) setFadeCutoff(true)
  const fadeActive = streamingTree && !fadeCutoff

  useEffect(() => {
    const handler = (e: Event) => {
      const { type, id, path, title } = (e as CustomEvent).detail
      onWorkspaceResourceSelectRef.current?.({
        type,
        id: id ?? '',
        path,
        title: title || id || path || '',
      })
    }
    window.addEventListener('wsres-click', handler)
    return () => window.removeEventListener('wsres-click', handler)
  }, [])

  const parsed = useMemo(
    () => parseSpecialTags(streamedContent, isRevealing),
    [streamedContent, isRevealing]
  )
  const hasPendingIndicator = parsed.hasPendingTag && isRevealing

  useEffect(() => {
    onStreamActivityChange?.(hasRevealBacklog || hasPendingIndicator)
    return () => onStreamActivityChange?.(false)
  }, [hasPendingIndicator, hasRevealBacklog, onStreamActivityChange])

  type BlockSegment = Exclude<
    ContentSegment,
    { type: 'text' } | { type: 'thinking' } | { type: 'workspace_resource' }
  >
  type RenderGroup =
    | { kind: 'inline'; markdown: string }
    | { kind: 'block'; segment: BlockSegment; index: number }

  const groups: RenderGroup[] = []
  let pendingMarkdown = ''

  const flushMarkdown = () => {
    if (pendingMarkdown.trim()) {
      groups.push({ kind: 'inline', markdown: pendingMarkdown })
    }
    pendingMarkdown = ''
  }

  for (let i = 0; i < parsed.segments.length; i++) {
    const s = parsed.segments[i]
    const nextSegment = parsed.segments[i + 1]
    if (s.type === 'workspace_resource') {
      // Files are addressed by their encoded VFS path (copied verbatim from the tag);
      // workflows/tables/KBs by id. The angle-bracket link destination keeps the path
      // intact through markdown parsing (tolerates parens) without re-encoding it.
      const ref = s.data.type === 'file' ? (s.data.path ?? s.data.id ?? '') : (s.data.id ?? '')
      const label = s.data.title || ref
      pendingMarkdown = appendInlineReferenceMarkdown(
        pendingMarkdown,
        `[${label}](<#wsres-${s.data.type}-${ref}>)`,
        nextSegment
      )
    } else if (s.type === 'thinking') {
      // Model-emitted <thinking> tag bodies are reasoning, not answer text —
      // never rendered (matches the block-level thinking omission in
      // message-content and the tag stripping in the inbox executor).
    } else if (s.type === 'text') {
      pendingMarkdown += s.content
    } else {
      flushMarkdown()
      groups.push({ kind: 'block', segment: s, index: i })
    }
  }
  flushMarkdown()

  /**
   * Plain text and special-tag content share ONE render structure. A message
   * with no special tags is simply a single inline group — it must NOT get a
   * dedicated JSX branch, because most replies gain a trailing `<options>` tag
   * (suggested follow-ups) at the very end, and switching branches at that
   * moment re-parents the Streamdown to a different tree position. React then
   * remounts it with a fresh animate plugin and the ENTIRE message re-fades
   * from transparent — the "flash at the conclusion". With the unified
   * structure the leading text group keeps its position (`inline-0`) and only
   * the new special block mounts.
   */
  return (
    <div className='space-y-3'>
      {groups.map((group, i) => {
        if (group.kind === 'inline') {
          return (
            <div
              key={`inline-${i}`}
              className={cn(PROSE_CLASSES, '[&>:first-child]:mt-0 [&>:last-child]:mb-0')}
            >
              <Streamdown
                key={streamingTree ? 'stream' : 'settled'}
                animated={fadeActive ? STREAM_ANIMATION : false}
                isAnimating={streamingTree}
                components={MARKDOWN_COMPONENTS}
              >
                {group.markdown}
              </Streamdown>
            </div>
          )
        }
        return (
          <SpecialTags
            key={`special-${group.index}`}
            segment={group.segment}
            questionAnswers={questionAnswers}
            onOptionSelect={onOptionSelect}
          />
        )
      })}
      {hasPendingIndicator && <PendingTagIndicator />}
    </div>
  )
}

export const ChatContent = memo(ChatContentInner)
