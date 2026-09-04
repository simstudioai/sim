import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Blimp,
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
} from '@sim/emcn/icons'
import {
  PluginKey,
  type SelectionBookmark,
  TextSelection,
  type Transaction,
} from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import { useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { BUBBLE_MENU_CLASS } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/bubble-menu-chrome'
import {
  applyLink,
  LinkUrlInput,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/link-editing'
import {
  ToolbarButton,
  ToolbarDivider,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/toolbar-button'
import { useBubbleMenuFloating } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/use-bubble-menu-floating'
import { useEditorToolbar } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/use-editor-toolbar'

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

interface EditorBubbleMenuProps {
  editor: Editor
  /** The editor's scrollable viewport, so the toolbar repositions with the selection as the pane scrolls. */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  /** Adds the current selection to Chat as a reference. Omit to hide the action. */
  onAddToChat?: () => void
}

/**
 * Floating formatting toolbar shown on text selection. Marks and the common
 * block types; the link button swaps the bar into an inline URL editor. Richer block inserts
 * live in the `/` slash menu. Active states are read through {@link useEditorState} so the bar
 * stays correct without re-rendering the editor on every transaction.
 */
export function EditorBubbleMenu({
  editor,
  scrollContainerRef,
  onAddToChat,
}: EditorBubbleMenuProps) {
  const [linkValue, setLinkValue] = useState<string | null>(null)
  const linkInputRef = useRef<HTMLInputElement>(null)
  const linkRangeRef = useRef<SelectionBookmark | null>(null)
  const isEditingLink = linkValue !== null

  const [bubbleMenuKey] = useState(() => new PluginKey('markdownBubbleMenu'))
  const isPointerDownRef = useRef(false)

  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      editable: e.isEditable,
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
      canHeading1: e.can().toggleHeading({ level: 1 }),
      canHeading2: e.can().toggleHeading({ level: 2 }),
      canBulletList: e.can().toggleBulletList(),
      canOrderedList: e.can().toggleOrderedList(),
      canTaskList: e.can().toggleTaskList(),
      canBlockquote: e.can().toggleBlockquote(),
    }),
  })

  useEffect(() => {
    if (isEditingLink) linkInputRef.current?.focus()
  }, [isEditingLink])

  useEffect(() => {
    const mapLinkRange = ({
      transaction,
      appendedTransactions = [],
    }: {
      transaction: Transaction
      appendedTransactions?: Transaction[]
    }) => {
      let bookmark = linkRangeRef.current
      if (!bookmark) return
      for (const change of [transaction, ...appendedTransactions])
        bookmark = bookmark.map(change.mapping)
      const selection = bookmark.resolve(editor.state.doc)
      linkRangeRef.current =
        selection instanceof TextSelection && !selection.empty ? bookmark : null
      if (!linkRangeRef.current) setLinkValue(null)
    }
    const exitOnCollapse = () => {
      const { from, to } = editor.state.selection
      if (from === to) setLinkValue(null)
    }
    editor.on('selectionUpdate', exitOnCollapse)
    editor.on('transaction', mapLinkRange)
    return () => {
      editor.off('selectionUpdate', exitOnCollapse)
      editor.off('transaction', mapLinkRange)
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
    if (!editor.isEditable || editor.isActive('codeBlock') || editor.isActive('code')) return
    linkRangeRef.current = editor.state.selection.getBookmark()
    setLinkValue(editor.getAttributes('link').href ?? '')
  }

  useEffect(() => {
    const dom = editor.view.dom
    const openLinkOnShortcut = (event: KeyboardEvent) => {
      if (!editor.isEditable) return
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.altKey ||
        event.shiftKey
      )
        return
      if (event.key?.toLowerCase() !== 'k') return
      const { from, to } = editor.state.selection
      if (from === to || editor.isActive('codeBlock') || editor.isActive('code')) return
      event.preventDefault()
      linkRangeRef.current = editor.state.selection.getBookmark()
      setLinkValue(editor.getAttributes('link').href ?? '')
    }
    dom.addEventListener('keydown', openLinkOnShortcut)
    return () => {
      dom.removeEventListener('keydown', openLinkOnShortcut)
    }
  }, [editor])

  const commitCapturedLink = (href: string) => {
    if (editor.isDestroyed || !editor.isEditable) return
    const selection = linkRangeRef.current?.resolve(editor.state.doc)
    if (selection instanceof TextSelection && !selection.empty) {
      applyLink(
        editor.chain().focus().setTextSelection({ from: selection.from, to: selection.to }),
        href
      )
    }
    linkRangeRef.current = null
    setLinkValue(null)
  }
  const commitLink = () => commitCapturedLink(linkValue ?? '')
  const removeLink = () => commitCapturedLink('')

  const { resolveAnchor, appendTo } = useBubbleMenuFloating(editor, scrollContainerRef)
  const canFocus = useCallback(
    () => hasFormattableSelection(editor, editor.state.selection.from, editor.state.selection.to),
    [editor]
  )
  const toolbar = useEditorToolbar({
    editor,
    pluginKey: bubbleMenuKey,
    roving: !isEditingLink,
    canFocus,
  })

  const shouldShow = useCallback(
    ({ editor: e, from, to }: { editor: Editor; from: number; to: number }) => {
      // Read-only never shows the menu — even mid-link-edit (e.g. a stream starting) — so a link
      // can't be applied to a doc that must not mutate.
      if (!e.isEditable) return false
      if (isEditingLink) return true
      if (isPointerDownRef.current) return false
      return hasFormattableSelection(e, from, to)
    },
    [isEditingLink]
  )

  return (
    <BubbleMenu
      editor={editor}
      pluginKey={bubbleMenuKey}
      getReferencedVirtualElement={resolveAnchor}
      appendTo={appendTo}
      updateDelay={0}
      shouldShow={shouldShow}
      hidden={!active.editable}
      className={BUBBLE_MENU_CLASS}
    >
      <div
        {...toolbar}
        role={isEditingLink ? 'group' : 'toolbar'}
        aria-label={isEditingLink ? 'Link editing' : 'Text formatting'}
        className='flex items-center gap-0.5'
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
              <ToolbarButton icon={Unlink} label='Remove link' onClick={removeLink} />
            )}
            <ToolbarButton icon={Check} label='Apply link' onClick={commitLink} />
          </>
        ) : (
          <>
            {onAddToChat && (
              <>
                <ToolbarButton icon={Blimp} label='Add to Chat' onClick={onAddToChat} />
                <ToolbarDivider />
              </>
            )}
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
              disabled={!active.canHeading1}
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            />
            <ToolbarButton
              icon={Heading2}
              label='Heading 2'
              shortcut='⌘⌥2'
              isActive={active.heading2}
              disabled={!active.canHeading2}
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            />
            <ToolbarDivider />
            <ToolbarButton
              icon={List}
              label='Bulleted list'
              shortcut='⌘⇧8'
              isActive={active.bulletList}
              disabled={!active.canBulletList}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            />
            <ToolbarButton
              icon={ListOrdered}
              label='Numbered list'
              shortcut='⌘⇧7'
              isActive={active.orderedList}
              disabled={!active.canOrderedList}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
            />
            <ToolbarButton
              icon={ListChecks}
              label='Checklist'
              shortcut='⌘⇧9'
              isActive={active.taskList}
              disabled={!active.canTaskList}
              onClick={() => editor.chain().focus().toggleTaskList().run()}
            />
            <ToolbarButton
              icon={TextQuote}
              label='Quote'
              shortcut='⌘⇧B'
              isActive={active.blockquote}
              disabled={!active.canBlockquote}
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
            />
          </>
        )}
      </div>
    </BubbleMenu>
  )
}
