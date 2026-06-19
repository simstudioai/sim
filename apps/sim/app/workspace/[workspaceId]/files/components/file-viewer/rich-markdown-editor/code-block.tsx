import { useEffect, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import { CodeBlock } from '@tiptap/extension-code-block'
import type { ReactNodeViewProps } from '@tiptap/react'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { Check, ChevronDown, Copy, WrapText } from 'lucide-react'
import {
  chipVariants,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { detectLanguage } from './detect-language'

const PLAIN = 'plain'

/** Languages the Prism highlighter has registered (see {@link CodeBlockHighlight}). */
const LANGUAGE_OPTIONS = [
  { value: PLAIN, label: 'Plain text' },
  { value: 'bash', label: 'Bash' },
  { value: 'css', label: 'CSS' },
  { value: 'markup', label: 'HTML' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'json', label: 'JSON' },
  { value: 'python', label: 'Python' },
  { value: 'sql', label: 'SQL' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'yaml', label: 'YAML' },
] as const

const CONTROL_CLASS =
  'flex size-[24px] items-center justify-center rounded-lg text-[var(--text-icon)] outline-none transition-colors hover-hover:bg-[var(--surface-hover)] hover-hover:text-[var(--text-body)] focus-visible:bg-[var(--surface-hover)] [&_svg]:size-[14px]'

function CodeBlockView({ node, updateAttributes }: ReactNodeViewProps) {
  const [wrap, setWrap] = useState(false)
  const [copied, setCopied] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const explicitLanguage = node.attrs.language as string | null
  const language = explicitLanguage ?? detectLanguage(node.textContent) ?? PLAIN
  const label =
    LANGUAGE_OPTIONS.find((option) => option.value === language)?.label ??
    explicitLanguage ??
    'Plain text'

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    const ok = await navigator.clipboard
      ?.writeText(node.textContent)
      .then(() => true)
      .catch(() => false)
    if (ok) setCopied(true)
  }

  return (
    <NodeViewWrapper className='group relative'>
      <div
        className={cn(
          'absolute top-1.5 right-2 z-10 flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100',
          menuOpen && 'opacity-100'
        )}
        contentEditable={false}
      >
        <DropdownMenu onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              aria-label='Code language'
              className={cn(
                chipVariants({ variant: 'default', flush: true }),
                'h-[24px] gap-1 px-1.5 text-[var(--text-muted)] data-[state=open]:bg-[var(--surface-active)] data-[state=open]:text-[var(--text-body)]'
              )}
            >
              {label}
              <ChevronDown className='size-[14px] text-[var(--text-icon)]' />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            {LANGUAGE_OPTIONS.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onSelect={() =>
                  updateAttributes({ language: option.value === PLAIN ? null : option.value })
                }
              >
                {option.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type='button'
          aria-label='Toggle line wrap'
          aria-pressed={wrap}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setWrap((value) => !value)}
          className={cn(
            CONTROL_CLASS,
            wrap && 'bg-[var(--surface-active)] text-[var(--text-body)]'
          )}
        >
          <WrapText />
        </button>
        <button
          type='button'
          aria-label='Copy code'
          onMouseDown={(event) => event.preventDefault()}
          onClick={copy}
          className={CONTROL_CLASS}
        >
          {copied ? <Check /> : <Copy />}
        </button>
      </div>
      <pre className='code-editor-theme pr-20' data-wrap={wrap}>
        <NodeViewContent<'code'> as='code' />
      </pre>
    </NodeViewWrapper>
  )
}

function codeBlockText(node: JSONContent): string {
  return (node.content ?? []).map((child) => child.text ?? '').join('')
}

/** Fence sized to one backtick longer than the longest run inside the code (CommonMark rule). */
function fenceFor(text: string): string {
  const longestRun = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length))
  return '`'.repeat(Math.max(3, longestRun + 1))
}

/**
 * Code block whose markdown serializer sizes the fence to the interior backtick runs, so a code
 * block that itself contains a ``` line round-trips instead of shattering. Shared by the test
 * (plain) and live ({@link CodeBlockWithLanguage}) paths.
 */
export const MarkdownCodeBlock = CodeBlock.extend({
  renderMarkdown: (node: JSONContent) => {
    const language = typeof node.attrs?.language === 'string' ? node.attrs.language : ''
    const text = codeBlockText(node)
    const fence = fenceFor(text)
    return `${fence}${language}\n${text}\n${fence}`
  },
})

/**
 * Code block with hover-revealed controls (language picker, line-wrap toggle, copy). The
 * `language` attribute drives {@link CodeBlockHighlight}'s Prism highlighting and serializes to
 * the ```lang fence on save; wrap is a view-only preference.
 */
export const CodeBlockWithLanguage = MarkdownCodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView)
  },
})
