'use client'

import { type ComponentPropsWithoutRef, useEffect, useMemo, useRef } from 'react'
import { Streamdown } from 'streamdown'
import 'streamdown/styles.css'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-markup'
import '@/components/emcn/components/code/code.css'
import { Checkbox, highlight, languages } from '@/components/emcn'
import { CopyCodeButton } from '@/components/ui/copy-code-button'
import { cn } from '@/lib/core/utils/cn'
import { extractTextContent } from '@/lib/core/utils/react-node-text'
import {
  type ContentSegment,
  PendingTagIndicator,
  parseSpecialTags,
  SpecialTags,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'
import { useStreamingText } from '@/hooks/use-streaming-text'

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

function startsInlineWord(value: string): boolean {
  return /^[A-Za-z0-9_(]/.test(value)
}

function endsInlineWord(value: string): boolean {
  return /[A-Za-z0-9_)]$/.test(value)
}

function nextInlineSegmentLabel(segment?: ContentSegment): string {
  if (!segment) return ''
  if (segment.type === 'text' || segment.type === 'thinking') return segment.content
  if (segment.type === 'workspace_resource') return segment.data.title || segment.data.id
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
            className='text-[var(--text-tertiary)] hover:bg-[var(--surface-5)] hover:text-[var(--text-secondary)]'
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
      return (
        <a
          href={href}
          className='text-[var(--text-primary)] underline decoration-dashed underline-offset-4'
          onClick={(e) => {
            e.preventDefault()
            const match = href.match(/^#wsres-(\w+)-(.+)$/)
            if (match) {
              const linkText = e.currentTarget.textContent || match[2]
              window.dispatchEvent(
                new CustomEvent('wsres-click', {
                  detail: { type: match[1], id: match[2], title: linkText },
                })
              )
            }
          }}
        >
          {children}
        </a>
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
      <code className='rounded bg-[var(--surface-5)] px-1.5 py-0.5 font-[400] font-mono text-[var(--text-primary)] text-small before:content-none after:content-none'>
        {children}
      </code>
    )
  },
  input({ type, checked }: { type?: string; checked?: boolean }) {
    if (type === 'checkbox') {
      return <Checkbox checked={checked || false} disabled size='sm' className='mt-1.5 shrink-0' />
    }
    return <input type={type} checked={checked} readOnly />
  },
}

interface ChatContentProps {
  content: string
  isStreaming?: boolean
  onOptionSelect?: (id: string) => void
  onWorkspaceResourceSelect?: (resource: MothershipResource) => void
  smoothStreaming?: boolean
}

export function ChatContent({
  content,
  isStreaming = false,
  onOptionSelect,
  onWorkspaceResourceSelect,
  smoothStreaming = true,
}: ChatContentProps) {
  const hydratedStreamingRef = useRef(isStreaming && content.trim().length > 0)
  const previousIsStreamingRef = useRef(isStreaming)

  useEffect(() => {
    if (!previousIsStreamingRef.current && isStreaming && content.trim().length > 0) {
      hydratedStreamingRef.current = true
    } else if (!isStreaming) {
      hydratedStreamingRef.current = false
    }
    previousIsStreamingRef.current = isStreaming
  }, [content, isStreaming])

  const onWorkspaceResourceSelectRef = useRef(onWorkspaceResourceSelect)
  onWorkspaceResourceSelectRef.current = onWorkspaceResourceSelect

  useEffect(() => {
    const handler = (e: Event) => {
      const { type, id, title } = (e as CustomEvent).detail
      const RESOURCE_TYPE_MAP: Record<string, string> = {}
      onWorkspaceResourceSelectRef.current?.({
        type: RESOURCE_TYPE_MAP[type] || type,
        id,
        title: title || id,
      })
    }
    window.addEventListener('wsres-click', handler)
    return () => window.removeEventListener('wsres-click', handler)
  }, [])

  const rendered = useStreamingText(content, isStreaming && smoothStreaming)

  const parsed = useMemo(() => parseSpecialTags(rendered, isStreaming), [rendered, isStreaming])
  const hasSpecialContent = parsed.hasPendingTag || parsed.segments.some((s) => s.type !== 'text')

  if (hasSpecialContent) {
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
        const label = s.data.title || s.data.id
        pendingMarkdown = appendInlineReferenceMarkdown(
          pendingMarkdown,
          `[${label}](#wsres-${s.data.type}-${s.data.id})`,
          nextSegment
        )
      } else if (s.type === 'text' || s.type === 'thinking') {
        pendingMarkdown += s.content
      } else {
        flushMarkdown()
        groups.push({ kind: 'block', segment: s, index: i })
      }
    }
    flushMarkdown()

    return (
      <div className='space-y-3'>
        {groups.map((group, i) => {
          if (group.kind === 'inline') {
            return (
              <div
                key={`inline-${i}`}
                className={cn(PROSE_CLASSES, '[&>:first-child]:mt-0 [&>:last-child]:mb-0')}
              >
                <Streamdown mode='static' components={MARKDOWN_COMPONENTS}>
                  {group.markdown}
                </Streamdown>
              </div>
            )
          }
          return (
            <SpecialTags
              key={`special-${group.index}`}
              segment={group.segment}
              onOptionSelect={onOptionSelect}
            />
          )
        })}
        {parsed.hasPendingTag && isStreaming && <PendingTagIndicator />}
      </div>
    )
  }

  return (
    <div className={cn(PROSE_CLASSES, '[&>:first-child]:mt-0 [&>:last-child]:mb-0')}>
      <Streamdown
        mode={isStreaming ? undefined : 'static'}
        isAnimating={isStreaming}
        animated={isStreaming && !hydratedStreamingRef.current}
        components={MARKDOWN_COMPONENTS}
      >
        {rendered}
      </Streamdown>
    </div>
  )
}
