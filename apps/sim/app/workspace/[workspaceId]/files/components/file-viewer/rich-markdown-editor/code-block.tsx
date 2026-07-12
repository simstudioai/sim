import { useEffect, useState } from 'react'
import {
  chipVariants,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  useCopyToClipboard,
} from '@sim/emcn'
import type { JSONContent } from '@tiptap/core'
import { CodeBlock } from '@tiptap/extension-code-block'
import type { ReactNodeViewProps } from '@tiptap/react'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { Check, ChevronDown, Code, Copy, Eye, WrapText } from 'lucide-react'
import { looksLikeMermaid, MermaidDiagram } from '../mermaid-diagram'
import { detectLanguage } from './detect-language'
import { useEditorEditable } from './use-editor-editable'

const PLAIN = 'plain'
const MERMAID = 'mermaid'

/** Languages the Prism highlighter has registered (see {@link CodeBlockHighlight}). Every non-plain
 * value MUST have a grammar registered in {@link CodeBlockHighlight} — enforced by a unit test. */
export const LANGUAGE_OPTIONS = [
  { value: PLAIN, label: 'Plain text' },
  { value: 'bash', label: 'Bash' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'csharp', label: 'C#' },
  { value: 'css', label: 'CSS' },
  { value: 'go', label: 'Go' },
  { value: 'java', label: 'Java' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'json', label: 'JSON' },
  { value: 'markup', label: 'HTML' },
  { value: 'php', label: 'PHP' },
  { value: 'python', label: 'Python' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'rust', label: 'Rust' },
  { value: 'sql', label: 'SQL' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'yaml', label: 'YAML' },
] as const

const CONTROL_CLASS =
  'flex size-[24px] items-center justify-center rounded-lg text-[var(--text-icon)] outline-none transition-colors hover-hover:bg-[var(--surface-hover)] hover-hover:text-[var(--text-body)] focus-visible:bg-[var(--surface-hover)] [&_svg]:size-[14px]'

/**
 * Code block view with hover controls (language picker, line-wrap, copy). When the block holds
 * Mermaid — tagged ```mermaid or {@link looksLikeMermaid auto-detected} — it renders as a diagram
 * whenever the cursor is outside it (and always in read-only), and as editable source while the
 * cursor is inside, re-rendering on blur (the Linear/GitHub model). The source `<pre>` stays mounted
 * (hidden behind the diagram) so ProseMirror keeps managing its contentDOM, and the node remains an
 * ordinary code block, so markdown round-trips unchanged.
 */
function CodeBlockView({ node, updateAttributes, editor, getPos }: ReactNodeViewProps) {
  const [wrap, setWrap] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editingInline, setEditingInline] = useState(false)
  const [peekSource, setPeekSource] = useState(false)
  const { copied, copy } = useCopyToClipboard({ resetMs: 1500 })
  const editable = useEditorEditable(editor)

  const explicitLanguage = node.attrs.language as string | null
  const text = node.textContent
  const isMermaid = explicitLanguage === MERMAID || (!explicitLanguage && looksLikeMermaid(text))

  // Editable Mermaid shows source while the caret is focused inside the block and re-renders the
  // diagram on blur (the Linear/GitHub model). The Show source / Show diagram control drives this by
  // focusing into / blurring the block; read-only uses {@link peekSource} since there is no caret.
  useEffect(() => {
    if (!isMermaid || !editable) {
      setEditingInline(false)
      return
    }
    const sync = () => {
      const pos = typeof getPos === 'function' ? getPos() : null
      if (typeof pos !== 'number') {
        setEditingInline(false)
        return
      }
      const size = editor.state.doc.nodeAt(pos)?.nodeSize ?? 0
      const { from } = editor.state.selection
      setEditingInline(editor.isFocused && from > pos && from < pos + size)
    }
    sync()
    editor.on('selectionUpdate', sync)
    editor.on('focus', sync)
    editor.on('blur', sync)
    return () => {
      editor.off('selectionUpdate', sync)
      editor.off('focus', sync)
      editor.off('blur', sync)
    }
  }, [editor, getPos, isMermaid, editable])

  const showSource = editable ? editingInline : peekSource
  const showDiagram = isMermaid && text.trim().length > 0 && !showSource

  // Skip language detection on the mermaid path — the picker/label never render there.
  const language = explicitLanguage ?? (isMermaid ? null : detectLanguage(text)) ?? PLAIN
  const label =
    LANGUAGE_OPTIONS.find((option) => option.value === language)?.label ??
    explicitLanguage ??
    'Plain text'

  const toggleSource = () => {
    if (!editable) {
      setPeekSource((value) => !value)
      return
    }
    const pos = typeof getPos === 'function' ? getPos() : null
    if (typeof pos !== 'number') return
    if (editingInline) {
      // Back to the diagram: select the whole node (reliable, and shows the same ring) rather than
      // relying on a blur event to fire.
      editor.commands.setNodeSelection(pos)
      return
    }
    editor
      .chain()
      .focus()
      .setTextSelection(pos + 1)
      .run()
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
        {isMermaid && (
          <button
            type='button'
            aria-label={showSource ? 'Show diagram' : 'Show source'}
            onMouseDown={(event) => event.preventDefault()}
            onClick={toggleSource}
            className={CONTROL_CLASS}
          >
            {showSource ? <Eye /> : <Code />}
          </button>
        )}
        {!isMermaid &&
          (editable ? (
            // Editable: a language picker. Read-only: a static label — selecting a language calls
            // updateAttributes, which would mutate a doc that must not change.
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
          ) : (
            <span className='flex h-[24px] items-center px-1.5 text-[var(--text-muted)] text-caption'>
              {label}
            </span>
          ))}
        {!isMermaid && editable && (
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
        )}
        <button
          type='button'
          aria-label='Copy code'
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => copy(text)}
          className={CONTROL_CLASS}
        >
          {copied ? <Check /> : <Copy />}
        </button>
      </div>
      <pre className={cn('code-editor-theme pr-20', showDiagram && 'hidden')} data-wrap={wrap}>
        <NodeViewContent<'code'> as='code' />
      </pre>
      {showDiagram && (
        // Clicking the diagram selects the whole node (same selection ring as an image/code block)
        // instead of dropping a caret inside — preventDefault stops ProseMirror placing the caret,
        // which would otherwise flip to source. Editing is an explicit Show source / blur action.
        <div
          contentEditable={false}
          onMouseDown={(event) => {
            event.preventDefault()
            const pos = typeof getPos === 'function' ? getPos() : null
            if (typeof pos === 'number') editor.commands.setNodeSelection(pos)
          }}
        >
          <MermaidDiagram definition={text} className='mermaid-diagram-frame' />
        </div>
      )}
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
