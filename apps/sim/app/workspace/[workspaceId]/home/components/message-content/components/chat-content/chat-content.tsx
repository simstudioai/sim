'use client'

import { Children, type ComponentPropsWithoutRef, isValidElement, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
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
  PendingTagIndicator,
  parseSpecialTags,
  SpecialTags,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import { useStreamingReveal } from '@/hooks/use-streaming-reveal'
import { useStreamingText } from '@/hooks/use-streaming-text'

const REMARK_PLUGINS = [remarkGfm]

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
  'prose-code:rounded prose-code:bg-[var(--surface-5)] prose-code:px-1.5 prose-code:py-0.5 prose-code:text-small prose-code:font-mono prose-code:font-[400] prose-code:text-[var(--text-primary)]',
  'prose-code:before:content-none prose-code:after:content-none',
  'prose-hr:border-[var(--divider)] prose-hr:my-6',
  'prose-table:my-0'
)

type TdProps = ComponentPropsWithoutRef<'td'>
type ThProps = ComponentPropsWithoutRef<'th'>

const MARKDOWN_COMPONENTS: React.ComponentProps<typeof ReactMarkdown>['components'] = {
  table({ children }) {
    return (
      <div className='not-prose my-4 w-full overflow-x-auto [&_strong]:font-[600]'>
        <table className='min-w-full border-collapse [&_tbody_tr:last-child_td]:border-b-0'>
          {children}
        </table>
      </div>
    )
  },
  thead({ children }) {
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
  pre({ children }) {
    let codeString = ''
    let language = ''

    for (const child of Children.toArray(children)) {
      if (isValidElement(child) && child.type === 'code') {
        const props = child.props as { className?: string; children?: React.ReactNode }
        codeString = extractTextContent(props.children)
        if (props.className?.startsWith('language-')) {
          language = props.className.slice(9)
        }
        break
      }
    }

    if (!codeString) {
      return (
        <pre className='not-prose my-6 overflow-x-auto rounded-lg bg-[var(--surface-5)] p-4 font-[430] font-mono text-[var(--text-primary)] text-small leading-[21px] dark:bg-[var(--code-bg)]'>
          {children}
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
  a({ children, href }) {
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
  ul({ children, className }) {
    if (className?.includes('contains-task-list')) {
      return <ul className='my-4 list-none space-y-2 pl-0'>{children}</ul>
    }
    return <ul className='my-4 list-disc pl-5 marker:text-[var(--text-primary)]'>{children}</ul>
  },
  ol({ children }) {
    return <ol className='my-4 list-decimal pl-5 marker:text-[var(--text-primary)]'>{children}</ol>
  },
  li({ children, className }) {
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
  input({ type, checked }) {
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
}

function MarkdownChunk({
  content,
  animate = false,
  trimTop = true,
  trimBottom = true,
}: {
  content: string
  animate?: boolean
  trimTop?: boolean
  trimBottom?: boolean
}) {
  return (
    <div
      className={cn(
        PROSE_CLASSES,
        trimTop && '[&>:first-child]:mt-0',
        trimBottom && '[&>:last-child]:mb-0',
        animate && 'animate-stream-fade-in'
      )}
    >
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

export function ChatContent({ content, isStreaming = false, onOptionSelect }: ChatContentProps) {
  const rendered = useStreamingText(content, isStreaming)

  const parsed = useMemo(() => parseSpecialTags(rendered, isStreaming), [rendered, isStreaming])
  const hasSpecialContent = parsed.hasPendingTag || parsed.segments.some((s) => s.type !== 'text')

  const plainText = hasSpecialContent ? '' : rendered
  const { committed, incoming, generation } = useStreamingReveal(
    plainText,
    !hasSpecialContent && isStreaming
  )

  const committedMarkdown = useMemo(
    () => (committed ? <MarkdownChunk content={committed} trimTop trimBottom={!incoming} /> : null),
    [committed, incoming]
  )

  if (hasSpecialContent) {
    return (
      <div className='space-y-3'>
        {parsed.segments.map((segment, i) => {
          if (segment.type === 'text' || segment.type === 'thinking') {
            return <MarkdownChunk key={`${segment.type}-${i}`} content={segment.content} />
          }
          return (
            <SpecialTags key={`special-${i}`} segment={segment} onOptionSelect={onOptionSelect} />
          )
        })}
        {parsed.hasPendingTag && isStreaming && <PendingTagIndicator />}
      </div>
    )
  }

  return (
    <div>
      {committedMarkdown}
      {incoming && (
        <MarkdownChunk
          key={generation}
          content={incoming}
          trimTop
          trimBottom
          animate={isStreaming}
        />
      )}
    </div>
  )
}
