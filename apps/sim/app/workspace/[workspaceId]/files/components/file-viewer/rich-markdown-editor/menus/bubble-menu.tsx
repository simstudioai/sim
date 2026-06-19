import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import {
  Bold,
  Check,
  Code,
  Heading1,
  Heading2,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  type LucideIcon,
  Strikethrough,
  TextQuote,
  Unlink,
} from 'lucide-react'
import { Tooltip } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { normalizeLinkHref } from '../markdown-fidelity'

interface ToolbarButtonProps {
  icon: LucideIcon
  label: string
  shortcut?: string
  isActive: boolean
  onClick: () => void
}

function ToolbarButton({ icon: Icon, label, shortcut, isActive, onClick }: ToolbarButtonProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type='button'
          aria-label={label}
          aria-pressed={isActive}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onClick}
          className={cn(
            'flex size-[28px] items-center justify-center rounded-md text-[var(--text-icon)] outline-none transition-colors focus-visible:bg-[var(--surface-hover)] [&_svg]:size-[14px]',
            isActive
              ? 'bg-[var(--surface-active)] text-[var(--text-body)]'
              : 'hover-hover:bg-[var(--surface-hover)]'
          )}
        >
          <Icon />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Content>
        {shortcut ? <Tooltip.Shortcut keys={shortcut}>{label}</Tooltip.Shortcut> : label}
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

function ToolbarDivider() {
  return <div className='mx-0.5 h-[18px] w-px bg-[var(--border-1)]' />
}

interface EditorBubbleMenuProps {
  editor: Editor
}

/**
 * Floating formatting toolbar shown on text selection (Linear-style). Marks and the common
 * block types; the link button swaps the bar into an inline URL editor. Richer block inserts
 * live in the `/` slash menu. Active states are read through {@link useEditorState} so the bar
 * stays correct without re-rendering the editor on every transaction.
 */
export function EditorBubbleMenu({ editor }: EditorBubbleMenuProps) {
  const [linkValue, setLinkValue] = useState<string | null>(null)
  const linkInputRef = useRef<HTMLInputElement>(null)
  const linkRangeRef = useRef<{ from: number; to: number } | null>(null)
  const isEditingLink = linkValue !== null

  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      link: e.isActive('link'),
      heading1: e.isActive('heading', { level: 1 }),
      heading2: e.isActive('heading', { level: 2 }),
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      taskList: e.isActive('taskList'),
      blockquote: e.isActive('blockquote'),
    }),
  })

  useEffect(() => {
    if (isEditingLink) linkInputRef.current?.focus()
  }, [isEditingLink])

  useEffect(() => {
    const exitOnCollapse = () => {
      const { from, to } = editor.state.selection
      if (from === to) setLinkValue(null)
    }
    editor.on('selectionUpdate', exitOnCollapse)
    return () => {
      editor.off('selectionUpdate', exitOnCollapse)
    }
  }, [editor])

  const openLinkEditor = () => {
    if (editor.isActive('codeBlock') || editor.isActive('code')) return
    const { from, to } = editor.state.selection
    linkRangeRef.current = { from, to }
    setLinkValue(editor.getAttributes('link').href ?? '')
  }

  useEffect(() => {
    const dom = editor.view.dom
    const openLinkOnShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.isComposing) return
      if (event.key?.toLowerCase() !== 'k') return
      const { from, to } = editor.state.selection
      if (from === to || editor.isActive('codeBlock') || editor.isActive('code')) return
      event.preventDefault()
      linkRangeRef.current = { from, to }
      setLinkValue(editor.getAttributes('link').href ?? '')
    }
    dom.addEventListener('keydown', openLinkOnShortcut)
    return () => {
      dom.removeEventListener('keydown', openLinkOnShortcut)
    }
  }, [editor])

  // The captured range can outlive a programmatic doc change (image insert, content sync), so
  // clamp it to the current document before re-selecting to avoid a "position out of range" throw.
  const selectCapturedRange = (chain: ReturnType<Editor['chain']>) => {
    const range = linkRangeRef.current
    if (!range) return chain
    const max = editor.state.doc.content.size
    return chain.setTextSelection({ from: Math.min(range.from, max), to: Math.min(range.to, max) })
  }

  const commitLink = () => {
    const href = normalizeLinkHref((linkValue ?? '').trim())
    const chain = selectCapturedRange(editor.chain().focus())
    chain.extendMarkRange('link')
    if (href) chain.setLink({ href })
    else chain.unsetLink()
    chain.run()
    setLinkValue(null)
  }

  const removeLink = () => {
    selectCapturedRange(editor.chain().focus()).extendMarkRange('link').unsetLink().run()
    setLinkValue(null)
  }

  return (
    <BubbleMenu
      editor={editor}
      role='toolbar'
      aria-label='Text formatting'
      updateDelay={0}
      shouldShow={({ editor: e, from, to }) => {
        if (isEditingLink) return true
        if (!e.isEditable || e.isActive('codeBlock')) return false
        return e.state.doc.textBetween(from, to, ' ').trim().length > 0
      }}
      className='fade-in-0 z-[var(--z-popover)] flex animate-in items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-1 shadow-sm duration-100 motion-reduce:animate-none'
    >
      {isEditingLink ? (
        <>
          <input
            ref={linkInputRef}
            aria-label='Link URL'
            type='text'
            inputMode='url'
            value={linkValue}
            onChange={(event) => setLinkValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitLink()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setLinkValue(null)
              }
            }}
            placeholder='Paste or type a link…'
            className='h-[28px] w-[220px] bg-transparent px-2 text-[var(--text-body)] text-small outline-none placeholder:text-[var(--text-subtle)]'
          />
          {active.link && (
            <ToolbarButton
              icon={Unlink}
              label='Remove link'
              isActive={false}
              onClick={removeLink}
            />
          )}
          <ToolbarButton icon={Check} label='Apply link' isActive={false} onClick={commitLink} />
        </>
      ) : (
        <>
          <ToolbarButton
            icon={Bold}
            label='Bold'
            shortcut='⌘B'
            isActive={active.bold}
            onClick={() => editor.chain().focus().toggleBold().run()}
          />
          <ToolbarButton
            icon={Italic}
            label='Italic'
            shortcut='⌘I'
            isActive={active.italic}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          />
          <ToolbarButton
            icon={Strikethrough}
            label='Strikethrough'
            shortcut='⌘⇧S'
            isActive={active.strike}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          />
          <ToolbarButton
            icon={Code}
            label='Code'
            shortcut='⌘E'
            isActive={active.code}
            onClick={() => editor.chain().focus().toggleCode().run()}
          />
          <ToolbarButton
            icon={LinkIcon}
            label='Link'
            shortcut='⌘K'
            isActive={active.link}
            onClick={openLinkEditor}
          />
          <ToolbarDivider />
          <ToolbarButton
            icon={Heading1}
            label='Heading 1'
            shortcut='⌘⌥1'
            isActive={active.heading1}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          />
          <ToolbarButton
            icon={Heading2}
            label='Heading 2'
            shortcut='⌘⌥2'
            isActive={active.heading2}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          />
          <ToolbarDivider />
          <ToolbarButton
            icon={List}
            label='Bulleted list'
            shortcut='⌘⇧8'
            isActive={active.bulletList}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          />
          <ToolbarButton
            icon={ListOrdered}
            label='Numbered list'
            shortcut='⌘⇧7'
            isActive={active.orderedList}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          />
          <ToolbarButton
            icon={ListChecks}
            label='Checklist'
            shortcut='⌘⇧9'
            isActive={active.taskList}
            onClick={() => editor.chain().focus().toggleTaskList().run()}
          />
          <ToolbarButton
            icon={TextQuote}
            label='Quote'
            shortcut='⌘⇧B'
            isActive={active.blockquote}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          />
        </>
      )}
    </BubbleMenu>
  )
}
