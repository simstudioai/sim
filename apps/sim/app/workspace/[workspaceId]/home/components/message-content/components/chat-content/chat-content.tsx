'use client'

import {
  type ComponentPropsWithoutRef,
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { Nodes } from 'hast'
import { defaultRehypePlugins, defaultRemarkPlugins, Streamdown } from 'streamdown'
import 'streamdown/styles.css'
// prismjs core must load before its language components — they register on the
// global `Prism` it installs (on `window`/`global`); fixes SSR + client order.
import 'prismjs'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-markup'
import '@sim/emcn/components/code/code.css'
import {
  Checkbox,
  CopyCodeButton,
  chipFilledFillTokens,
  cn,
  Lightbox,
  languages,
  overflowFadeSizeClass,
  highlight as prismHighlight,
  scrollFadeAttributes,
  scrollFadeXClass,
  useScrollEdges,
} from '@sim/emcn'
import { extractTextContent } from '@/lib/core/utils/react-node-text'
import {
  inlineChatImageUrl,
  isInlineFileReference,
} from '@/lib/mothership/chat/inline-image-reference'
import { inter } from '@/app/_styles/fonts/inter/inter'
import { useChatSurface } from '@/app/workspace/[workspaceId]/home/components/chat-surface-context'
import { sanitizeChatDisplayContent } from '@/app/workspace/[workspaceId]/home/components/message-content/components/chat-content/chat-sanitize'
import {
  ExternalLink,
  LinkSourcesContext,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/chat-content/external-link'
import { HighlightedLines } from '@/app/workspace/[workspaceId]/home/components/message-content/components/chat-content/highlighted-lines'
import { remarkPlainText } from '@/app/workspace/[workspaceId]/home/components/message-content/components/chat-content/remark-plain-text'
import {
  SourceChip,
  sourceLabel,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-chip'
import {
  externalLinkHostname,
  PROSE_LINK_CLASS,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-link'
import {
  type ContentSegment,
  type CredentialSubmissionPayload,
  parseSpecialTags,
  type SourceTagData,
  SpecialTags,
  WorkspaceResourceDisplay,
  type WorkspaceResourceTagData,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import { indexSourcesByUrl } from '@/app/workspace/[workspaceId]/home/components/message-content/sources-by-url'
import type { WorkspaceResourceRef } from '@/app/workspace/[workspaceId]/home/types'
import { useSmoothText } from '@/hooks/use-smooth-text'

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

const MARKDOWN_REMARK_PLUGINS = [
  ...Object.values(defaultRemarkPlugins),
  remarkPlainText,
] as const satisfies NonNullable<ComponentPropsWithoutRef<typeof Streamdown>['remarkPlugins']>

const PROSE_CLASSES = cn(
  'prose prose-base dark:prose-invert max-w-none',
  'antialiased break-words tracking-[0]',
  'prose-headings:font-semibold prose-headings:tracking-[0] prose-headings:text-[var(--text-primary)]',
  'prose-headings:mb-3 prose-headings:mt-6 first:prose-headings:mt-0',
  'prose-p:text-base prose-p:leading-[25px] prose-p:text-[var(--text-primary)]',
  'prose-li:text-base prose-li:leading-[25px] prose-li:text-[var(--text-primary)]',
  'prose-li:my-1',
  'prose-ul:my-4 prose-ol:my-4 [&_li>ul]:my-1 [&_li>ol]:my-1',
  'prose-strong:font-semibold prose-strong:text-[var(--text-primary)]',
  'prose-a:text-[var(--text-primary)] prose-a:no-underline',
  'prose-hr:border-[var(--border)] prose-hr:my-6',
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
  if (segment.type === 'source') return sourceLabel(segment.data)
  return ''
}

/**
 * The `<source>` payloads of the segment being rendered, in emission order. An
 * inline citation is written into the markdown as a link to a sentinel
 * fragment carrying the payload's index, so it flows with its paragraph, and
 * the link renderer resolves the index back through this context — the
 * component map is static, so it is the one channel from segment data into it.
 */
const SourceRefsContext = createContext<readonly SourceTagData[]>([])

/**
 * Fragment prefix of a generated citation link. Internal — never navigated —
 * and deliberately not a name the model would write on its own; an index that
 * resolves to no parsed source falls back to the link text.
 */
const SOURCE_LINK_PREFIX = '#sim-source-ref-'

interface SourceReferenceProps {
  index: number
  children?: React.ReactNode
}

/** The inline citation chip; a dangling index falls back to the link text. */
function SourceReference({ index, children }: SourceReferenceProps) {
  const source = useContext(SourceRefsContext)[index]
  if (!source) return <>{children}</>
  return <SourceChip source={source} />
}

const WORKSPACE_LINK_PREFIX = '#sim-workspace-ref-'
const WorkspaceRefsContext = createContext<{
  resources: WorkspaceResourceTagData[]
  onSelect?: (resource: WorkspaceResourceRef) => void
}>({ resources: [] })

/** Keeps complete resource addresses local to each rendered message, including interleaved turns. */
function WorkspaceReference({ index, children }: SourceReferenceProps) {
  const { resources, onSelect } = useContext(WorkspaceRefsContext)
  const resource = resources[index]
  return resource ? (
    <WorkspaceResourceDisplay data={resource} onSelect={onSelect} />
  ) : (
    <>{children}</>
  )
}

/**
 * A source's name as a Markdown link label. A site name or knowledge-base
 * name is free text: an unescaped `]` would end the label early and a `*` or
 * `_` would style it, so the delimiters are backslash-escaped.
 */
function escapeLinkLabel(label: string): string {
  return label.replace(/[\\[\]*_`<>]/g, '\\$&')
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
 * Bounded LRU cache for Prism highlight output. Chat rows are virtualized, so a
 * message re-highlights every time it scrolls back into view; a component
 * `useMemo` would not survive the unmount, so the cache lives at module scope.
 * Output for an unregistered language is never cached — it renders through the
 * JavaScript fallback, so caching it would keep serving that stale render if the
 * real grammar registers later in the session.
 */
const HIGHLIGHT_CACHE_LIMIT = 512
const highlightCache = new Map<string, string>()

function highlight(code: string, language: string): string {
  const resolved = LANG_ALIASES[language] || language || 'javascript'
  const grammar = languages[resolved]
  if (!grammar) return prismHighlight(code, languages.javascript, resolved)

  const key = `${resolved}\n${code}`
  const cached = highlightCache.get(key)
  if (cached !== undefined) {
    highlightCache.delete(key)
    highlightCache.set(key, cached)
    return cached
  }
  const html = prismHighlight(code, grammar, resolved)
  highlightCache.set(key, html)
  if (highlightCache.size > HIGHLIGHT_CACHE_LIMIT) {
    const oldest = highlightCache.keys().next().value
    if (oldest !== undefined) highlightCache.delete(oldest)
  }
  return html
}

interface MarkdownTableProps {
  children?: React.ReactNode
}

function MarkdownTable({ children }: MarkdownTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const edges = useScrollEdges(scrollRef, { axis: 'x' })
  const isOverflowing = edges.left || edges.right

  return (
    <div
      ref={scrollRef}
      role={isOverflowing ? 'region' : undefined}
      aria-label={isOverflowing ? 'Scrollable table' : undefined}
      tabIndex={isOverflowing ? 0 : undefined}
      className={cn(
        'not-prose my-4 w-full overflow-x-auto [&_strong]:font-semibold',
        scrollFadeXClass,
        overflowFadeSizeClass
      )}
      {...scrollFadeAttributes(edges)}
    >
      <table className='min-w-full border-collapse [&_tbody_tr:last-child_td]:border-b-0'>
        {children}
      </table>
    </div>
  )
}

const MARKDOWN_COMPONENTS = {
  table: MarkdownTable,
  thead({ children }: { children?: React.ReactNode }) {
    return <thead>{children}</thead>
  },
  th({ children, style }: ThProps) {
    return (
      <th
        style={{ textAlign: style?.textAlign }}
        className='whitespace-nowrap border-[var(--border)] border-b px-3 py-2 text-left font-semibold text-[var(--text-primary)] text-sm leading-6'
      >
        {children}
      </th>
    )
  },
  td({ children, style }: TdProps) {
    return (
      <td
        style={{ textAlign: style?.textAlign }}
        className='whitespace-nowrap border-[var(--border)] border-b px-3 py-2 text-[var(--text-primary)] text-sm leading-6'
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
        <pre className='not-prose my-6 overflow-x-auto rounded-lg bg-[var(--surface-5)] p-4 font-mono text-[var(--text-primary)] text-small leading-[21px] dark:bg-[var(--code-bg)]'>
          <code>{children}</code>
        </pre>
      )
    }

    const html = highlight(codeString.trimEnd(), language)

    return (
      <div className='not-prose my-6 overflow-hidden rounded-lg border border-[var(--border)]'>
        <div className='flex items-center justify-between border-[var(--border)] border-b bg-[var(--surface-4)] px-4 py-2 dark:bg-[var(--surface-4)]'>
          <span className='text-[var(--text-tertiary)] text-xs'>{language || 'code'}</span>
          <CopyCodeButton
            code={codeString}
            className='-mr-2 text-[var(--text-tertiary)] hover-hover:bg-[var(--surface-5)] hover-hover:text-[var(--text-secondary)]'
          />
        </div>
        <div className='code-editor-theme bg-[var(--surface-5)] dark:bg-[var(--code-bg)]'>
          <pre className='m-0 overflow-x-auto whitespace-pre p-4 font-mono text-[var(--text-primary)] text-small leading-[21px]'>
            <HighlightedLines html={html} />
          </pre>
        </div>
      </div>
    )
  },
  a({ children, href }: { children?: React.ReactNode; href?: string }) {
    if (href?.startsWith(SOURCE_LINK_PREFIX)) {
      return (
        <SourceReference index={Number(href.slice(SOURCE_LINK_PREFIX.length))}>
          {children}
        </SourceReference>
      )
    }
    if (href?.startsWith(WORKSPACE_LINK_PREFIX)) {
      return (
        <WorkspaceReference index={Number(href.slice(WORKSPACE_LINK_PREFIX.length))}>
          {children}
        </WorkspaceReference>
      )
    }
    const hostname = externalLinkHostname(href)
    if (hostname && href) {
      return <ExternalLink href={href}>{children}</ExternalLink>
    }
    if (href?.startsWith('mailto:')) {
      return (
        <a href={href} className={PROSE_LINK_CLASS}>
          {children}
        </a>
      )
    }
    return (
      <a href={href} className={PROSE_LINK_CLASS} target='_blank' rel='noopener noreferrer'>
        {children}
      </a>
    )
  },
  ul({ children, className }: { children?: React.ReactNode; className?: string }) {
    if (className?.includes('contains-task-list')) {
      return (
        <ul
          className={cn(
            'my-4 list-none space-y-2 ps-0 [&>li:not(.task-list-item)]:ms-5 [&>li:not(.task-list-item)]:list-disc',
            className
          )}
        >
          {children}
        </ul>
      )
    }
    return <ul className='my-4 list-disc pl-5 marker:text-[var(--text-primary)]'>{children}</ul>
  },
  ol({ children }: { children?: React.ReactNode }) {
    return <ol className='my-4 list-decimal pl-5 marker:text-[var(--text-primary)]'>{children}</ol>
  },
  li({ children, className }: { children?: React.ReactNode; className?: string }) {
    if (className?.includes('task-list-item')) {
      return (
        <li
          className={cn(
            'list-none ps-6 text-[var(--text-primary)] text-base leading-[25px] [&>p:only-child]:inline [&>p]:my-0',
            className
          )}
        >
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
      <code
        className={cn(
          'whitespace-normal rounded px-1 py-[1px] font-mono font-normal text-[var(--text-primary)] not-italic before:content-none after:content-none',
          chipFilledFillTokens
        )}
      >
        {children}
      </code>
    )
  },
  blockquote({ children }: { children?: React.ReactNode }) {
    return (
      <blockquote className='my-4 break-words border-[var(--border)] border-l-2 pl-4 text-[var(--text-primary)] italic [&>p:first-child]:mt-0 [&>p:last-child]:mb-0 [&>p]:my-2'>
        {children}
      </blockquote>
    )
  },
  input({ type, checked }: { type?: string; checked?: boolean }) {
    if (type === 'checkbox') {
      return (
        <Checkbox
          checked={checked || false}
          disabled
          size='sm'
          className='-ms-6 mr-2 inline-flex align-middle'
        />
      )
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
      <Lightbox src={src} alt={alt ?? ''}>
        <button
          type='button'
          aria-label={alt ? `Preview ${alt}` : 'Preview image'}
          className='my-4 block max-w-full cursor-zoom-in rounded-lg'
        >
          <img
            src={src}
            alt={alt ?? ''}
            loading='lazy'
            className='m-0 block h-auto max-h-[360px] w-auto max-w-full rounded-lg border border-[var(--border)] object-contain'
          />
        </button>
      </Lightbox>
    )
  },
}

interface ChatContentProps {
  content: string
  messageId?: string
  imageRequestId?: string
  requestMode?: 'agent' | 'assistant' | 'plan'
  isStreaming?: boolean
  /** Transcript-derived answers for this message's question card (renders the recap). */
  questionAnswers?: string[]
  /** Transcript-derived status payload for this message's credential card. */
  credentialSubmission?: CredentialSubmissionPayload
  /** The user moved on without submitting this message's credential card. */
  credentialAbandoned?: boolean
  onOptionSelect?: (id: string) => void
  onQuestionDismiss?: () => void
  onWorkspaceResourceSelect?: (resource: WorkspaceResourceRef) => void
  onRevealStateChange?: (isRevealing: boolean) => void
  /** Reports whether this segment is actively painting text. */
  onStreamActivityChange?: (active: boolean) => void
  /**
   * Reports whether a special tag is mid-stream — bytes arriving but rendering
   * nothing (tags are suppressed until complete). A wait from the user's POV.
   */
  onPendingTagChange?: (pending: boolean) => void
  /** The turn's retrieved sources by URL, which title the answer's plain links to them. */
  linkSources?: ReadonlyMap<string, SourceTagData>
}

/** Explicit options keep Streamdown's processor cache scoped to this chat and turn. */
function privateImageUrls({
  chatId,
  imageRequestId,
}: {
  chatId?: string | null
  imageRequestId?: string
}) {
  return (tree: Nodes) => {
    function visit(node: Nodes): void {
      if (node.type === 'element' && node.tagName === 'img') {
        const src = node.properties.src
        if (typeof src === 'string' && isInlineFileReference(src)) {
          node.properties.src =
            chatId && imageRequestId ? inlineChatImageUrl(chatId, imageRequestId, src) : ''
        }
      }
      if ('children' in node) node.children.forEach(visit)
    }
    visit(tree)
  }
}

function ChatContentInner({
  content,
  messageId,
  imageRequestId,
  requestMode,
  isStreaming = false,
  questionAnswers,
  credentialSubmission,
  credentialAbandoned,
  onOptionSelect,
  onQuestionDismiss,
  onWorkspaceResourceSelect,
  onRevealStateChange,
  onStreamActivityChange,
  onPendingTagChange,
  linkSources,
}: ChatContentProps) {
  const { chatId } = useChatSurface()
  const imageRehypePlugins = useMemo<
    NonNullable<ComponentPropsWithoutRef<typeof Streamdown>['rehypePlugins']>
  >(
    () => [[privateImageUrls, { chatId, imageRequestId }], ...Object.values(defaultRehypePlugins)],
    [chatId, imageRequestId]
  )
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
   * place. The settled instance keeps the streaming parser (`parserTree`
   * below) so the remount only sheds the spans, never re-interprets the
   * markdown.
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
   * `parserTree` (drives `mode`) stays latched for the mount's life: streaming
   * mode is the only one that applies remend/incomplete-markdown repair and
   * block-split parsing, so a settled message must KEEP the streaming parser —
   * swapping to `mode='static'` at drain re-parses the same source through a
   * different pipeline (no remend, whole-doc parse) and visibly flashes on any
   * reply with unbalanced markdown. `streamingTree` (drives the remount key
   * and animation props) additionally drops at drain, so the settled instance
   * re-renders through the SAME parser minus the per-word animation spans —
   * byte-identical pixels. Only never-streamed mounts (reloaded history)
   * render static.
   */
  const parserTree = isRevealing || streamedThisSession
  const streamingTree = parserTree && !animationDrained

  /**
   * One-way fade cutoff (see {@link FADE_MAX_REVEALED_CHARS}). Latched so a
   * sanitize-induced content shrink back across the boundary cannot re-arm
   * `animated` — a fresh animate plugin has no prev-content tracking and would
   * re-fade the entire visible segment.
   */
  if (!fadeCutoff && streamedContent.length > FADE_MAX_REVEALED_CHARS) setFadeCutoff(true)
  const fadeActive = streamingTree && !fadeCutoff

  const parsed = useMemo(
    () => parseSpecialTags(streamedContent, isRevealing),
    [streamedContent, isRevealing]
  )

  useEffect(() => {
    onStreamActivityChange?.(hasRevealBacklog)
    return () => onStreamActivityChange?.(false)
  }, [hasRevealBacklog, onStreamActivityChange])

  const hasPendingTag = parsed.hasPendingTag && isRevealing
  useEffect(() => {
    onPendingTagChange?.(hasPendingTag)
    return () => onPendingTagChange?.(false)
  }, [hasPendingTag, onPendingTagChange])

  type BlockSegment = Exclude<
    ContentSegment,
    { type: 'text' } | { type: 'thinking' } | { type: 'workspace_resource' } | { type: 'source' }
  >
  type RenderGroup =
    | { kind: 'inline'; markdown: string }
    | { kind: 'block'; segment: BlockSegment; index: number }

  const sourceRefs = useMemo(
    () => parsed.segments.flatMap((segment) => (segment.type === 'source' ? [segment.data] : [])),
    [parsed]
  )
  /** Retrieved sources first, then this segment's own citations, first URL wins. */
  const linkSourcesByUrl = useMemo(
    () => indexSourcesByUrl(linkSources?.values() ?? [], sourceRefs),
    [linkSources, sourceRefs]
  )

  const groups: RenderGroup[] = []
  let pendingMarkdown = ''
  let sourceIndex = 0

  const flushMarkdown = () => {
    if (pendingMarkdown.trim()) {
      groups.push({ kind: 'inline', markdown: pendingMarkdown })
    }
    pendingMarkdown = ''
  }

  const workspaceRefs: WorkspaceResourceTagData[] = []

  for (let i = 0; i < parsed.segments.length; i++) {
    const s = parsed.segments[i]
    const nextSegment = parsed.segments[i + 1]
    if (s.type === 'workspace_resource') {
      const label = s.data.title || s.data.path || s.data.id || ''
      pendingMarkdown = appendInlineReferenceMarkdown(
        pendingMarkdown,
        `[${escapeLinkLabel(label)}](<${WORKSPACE_LINK_PREFIX}${workspaceRefs.length}>)`,
        nextSegment
      )
      workspaceRefs.push(s.data)
    } else if (s.type === 'source') {
      // A citation always stands off from the sentence it supports, even when
      // the model closes the sentence on punctuation the word-boundary rule
      // would otherwise glue the chip to.
      if (pendingMarkdown && !/\s$/.test(pendingMarkdown)) pendingMarkdown += ' '
      pendingMarkdown = appendInlineReferenceMarkdown(
        pendingMarkdown,
        `[${escapeLinkLabel(sourceLabel(s.data))}](<${SOURCE_LINK_PREFIX}${sourceIndex++}>)`,
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
    <LinkSourcesContext.Provider value={linkSourcesByUrl}>
      <SourceRefsContext.Provider value={sourceRefs}>
        <WorkspaceRefsContext.Provider
          value={{ resources: workspaceRefs, onSelect: onWorkspaceResourceSelect }}
        >
          <div className={cn('space-y-4', inter.className)}>
            {groups.map((group, i) => {
              if (group.kind === 'inline') {
                return (
                  <div
                    key={`inline-${i}`}
                    className={cn(PROSE_CLASSES, '[&>:first-child]:mt-0 [&>:last-child]:mb-0')}
                  >
                    <Streamdown
                      key={streamingTree ? 'stream' : 'settled'}
                      mode={parserTree ? undefined : 'static'}
                      animated={fadeActive ? STREAM_ANIMATION : false}
                      isAnimating={streamingTree}
                      components={MARKDOWN_COMPONENTS}
                      rehypePlugins={imageRehypePlugins}
                      remarkPlugins={MARKDOWN_REMARK_PLUGINS}
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
                  interactionId={`${messageId ?? 'message'}:${group.index}`}
                  questionAnswers={questionAnswers}
                  credentialSubmission={credentialSubmission}
                  credentialAbandoned={credentialAbandoned}
                  requestMode={requestMode}
                  onOptionSelect={onOptionSelect}
                  onQuestionDismiss={onQuestionDismiss}
                />
              )
            })}
          </div>
        </WorkspaceRefsContext.Provider>
      </SourceRefsContext.Provider>
    </LinkSourcesContext.Provider>
  )
}

export const ChatContent = memo(ChatContentInner)
