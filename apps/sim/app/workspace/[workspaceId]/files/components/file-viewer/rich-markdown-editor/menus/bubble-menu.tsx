import { useCallback, useEffect, useRef, useState } from 'react'
import { posToDOMRect } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import { useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import {
  Bold,
  Check,
  Code,
  Heading1,
  Heading2,
  Highlighter,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Strikethrough,
  TextQuote,
  Unlink,
} from 'lucide-react'
import { applyLink, LinkUrlInput } from './link-editing'
import { ToolbarButton, ToolbarDivider } from './toolbar-button'

/**
 * Whether the formatting toolbar may show for the given range: the editor is editable, the range
 * isn't inside a code block, and it covers some non-whitespace text. Single source of truth shared by
 * `shouldShow` and the pointer-release reveal so the two can't drift apart.
 */
function hasFormattableSelection(editor: Editor, from: number, to: number): boolean {
  if (!editor.isEditable || editor.isActive('codeBlock')) return false
  return editor.state.doc.textBetween(from, to, ' ').trim().length > 0
}

/**
 * Reveals the bubble menu for the current selection. Both calls are required and must stay in order:
 * `show` alone leaves the bar visible but unpositioned (its internal `updatePosition` no-ops until the
 * menu is shown), so the follow-up `updatePosition` anchors it. Both are step-free transactions, so
 * neither marks the document dirty.
 */
function revealBubbleMenu(editor: Editor, key: PluginKey): void {
  editor.commands.setMeta(key, 'show')
  editor.commands.setMeta(key, 'updatePosition')
}

/** Pins the toolbar to the viewport so it stays put while the document scrolls instead of tracking the text. */
const FLOATING_OPTIONS = { strategy: 'fixed' } as const

/** Renders into the body so a transformed/clipping ancestor can't reparent the fixed toolbar and shift it. */
const APPEND_TO_BODY = () => document.body

interface EditorBubbleMenuProps {
  editor: Editor
  /** The editor's scrollable viewport, used to keep the toolbar on-screen for selections taller than it. */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

/**
 * Floating formatting toolbar shown on text selection. Marks and the common
 * block types; the link button swaps the bar into an inline URL editor. Richer block inserts
 * live in the `/` slash menu. Active states are read through {@link useEditorState} so the bar
 * stays correct without re-rendering the editor on every transaction.
 */
export function EditorBubbleMenu({ editor, scrollContainerRef }: EditorBubbleMenuProps) {
  const [linkValue, setLinkValue] = useState<string | null>(null)
  const linkInputRef = useRef<HTMLInputElement>(null)
  const linkRangeRef = useRef<{ from: number; to: number } | null>(null)
  const isEditingLink = linkValue !== null

  const [bubbleMenuKey] = useState(() => new PluginKey('markdownBubbleMenu'))
  const isPointerDownRef = useRef(false)

  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      highlight: e.isActive('highlight'),
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

  /**
   * Linear-style reveal: the toolbar stays hidden while the pointer is down (the drag gate in
   * `shouldShow`) and surfaces on release. `mouseup`/`blur` listen on `window` so a release outside
   * the editor — or off-screen, where no `mouseup` fires — still clears the drag flag; otherwise it
   * could wedge `true` and suppress the toolbar for later keyboard selections.
   */
  useEffect(() => {
    const dom = editor.view.dom
    const onPointerDown = () => {
      isPointerDownRef.current = true
    }
    const onPointerUp = () => {
      if (!isPointerDownRef.current || editor.isDestroyed) return
      isPointerDownRef.current = false
      const { from, to } = editor.state.selection
      if (hasFormattableSelection(editor, from, to)) revealBubbleMenu(editor, bubbleMenuKey)
    }
    const onWindowBlur = () => {
      isPointerDownRef.current = false
    }
    dom.addEventListener('mousedown', onPointerDown)
    window.addEventListener('mouseup', onPointerUp)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      dom.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('mouseup', onPointerUp)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [editor, bubbleMenuKey])

  const openLinkEditor = () => {
    if (editor.isActive('codeBlock') || editor.isActive('code')) return
    const { from, to } = editor.state.selection
    linkRangeRef.current = { from, to }
    setLinkValue(editor.getAttributes('link').href ?? '')
  }

  useEffect(() => {
    const dom = editor.view.dom
    const openLinkOnShortcut = (event: KeyboardEvent) => {
      if (!editor.isEditable) return
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
    applyLink(selectCapturedRange(editor.chain().focus()), linkValue ?? '')
    setLinkValue(null)
  }

  const removeLink = () => {
    applyLink(selectCapturedRange(editor.chain().focus()), '')
    setLinkValue(null)
  }

  const anchorCacheRef = useRef<{ key: string; rect: DOMRect } | null>(null)
  const resolveAnchor = useCallback(() => {
    const { view, state } = editor
    if (!view.dom.isConnected) return null
    const { from, to } = state.selection
    const key = `${from}:${to}`
    if (anchorCacheRef.current?.key !== key) {
      const selection = posToDOMRect(view, from, to)
      const viewport = scrollContainerRef.current?.getBoundingClientRect()
      const rect =
        viewport && selection.height > viewport.height
          ? new DOMRect(
              selection.left,
              Math.min(Math.max(selection.top, viewport.top), viewport.bottom),
              selection.width,
              0
            )
          : selection
      anchorCacheRef.current = { key, rect }
    }
    const { rect } = anchorCacheRef.current
    return { getBoundingClientRect: () => rect, getClientRects: () => [rect] }
  }, [editor, scrollContainerRef])

  return (
    <BubbleMenu
      editor={editor}
      pluginKey={bubbleMenuKey}
      getReferencedVirtualElement={resolveAnchor}
      options={FLOATING_OPTIONS}
      appendTo={APPEND_TO_BODY}
      role='toolbar'
      aria-label='Text formatting'
      updateDelay={0}
      shouldShow={({ editor: e, from, to }) => {
        // Read-only never shows the menu — even mid-link-edit (e.g. a stream starting) — so a link
        // can't be applied to a doc that must not mutate.
        if (!e.isEditable) return false
        if (isEditingLink) return true
        if (isPointerDownRef.current) return false
        return hasFormattableSelection(e, from, to)
      }}
      className='fade-in-0 z-[var(--z-popover)] flex animate-in items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-1 shadow-sm duration-150 ease-out motion-reduce:animate-none'
    >
      {isEditingLink ? (
        <>
          <LinkUrlInput
            inputRef={linkInputRef}
            value={linkValue ?? ''}
            onChange={setLinkValue}
            onCommit={commitLink}
            onCancel={() => setLinkValue(null)}
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
            icon={Highlighter}
            label='Highlight'
            shortcut='⌘⇧H'
            isActive={active.highlight}
            onClick={() => editor.chain().focus().toggleMark('highlight').run()}
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
