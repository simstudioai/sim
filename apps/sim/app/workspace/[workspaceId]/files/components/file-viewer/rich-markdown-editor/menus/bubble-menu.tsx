import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Blimp,
  Bold,
  Check,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Pilcrow,
  Strikethrough,
  TextQuote,
  Unlink,
} from '@sim/emcn/icons'
import type { MappablePosition } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import {
  PluginKey,
  type Selection,
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
import { ToolbarMenu } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/toolbar-menu'
import { useBubbleMenuFloating } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/use-bubble-menu-floating'
import { useEditorToolbar } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/use-editor-toolbar'
import { selectionTouchesTable } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/table'

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

type CapturedSelection =
  | { anchor: MappablePosition; head: MappablePosition; bookmark?: never }
  | { bookmark: SelectionBookmark; anchor?: never; head?: never }

interface LinkSelection {
  target: CapturedSelection
  original: CapturedSelection
}

/** Collaborative positions survive the full-document replacements used to apply Yjs updates. */
function captureSelection(editor: Editor): CapturedSelection {
  const { selection } = editor.state
  return selection instanceof TextSelection
    ? {
        anchor: editor.utils.createMappablePosition(selection.anchor),
        head: editor.utils.createMappablePosition(selection.head),
      }
    : { bookmark: selection.getBookmark() }
}

function mapSelection(
  editor: Editor,
  selection: CapturedSelection,
  transaction: Transaction
): CapturedSelection {
  return selection.bookmark
    ? { bookmark: selection.bookmark.map(transaction.mapping) }
    : {
        anchor: editor.utils.getUpdatedPosition(selection.anchor, transaction).position,
        head: editor.utils.getUpdatedPosition(selection.head, transaction).position,
      }
}

function resolveSelection(selection: CapturedSelection, doc: Node): Selection {
  return selection.bookmark
    ? selection.bookmark.resolve(doc)
    : TextSelection.between(
        doc.resolve(selection.anchor.position),
        doc.resolve(selection.head.position)
      )
}

/** Keep the editing target separate from the selection restored when the user cancels. */
function captureLinkSelection(editor: Editor): LinkSelection | null {
  const original = captureSelection(editor)
  if (editor.state.selection.empty) editor.commands.extendMarkRange('link')
  const { selection } = editor.state
  return selection.empty ? null : { target: captureSelection(editor), original }
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
  const linkSelectionRef = useRef<LinkSelection | null>(null)
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
      text:
        e.isActive('paragraph') &&
        !e.isActive('bulletList') &&
        !e.isActive('orderedList') &&
        !e.isActive('taskList') &&
        !e.isActive('blockquote'),
      heading1: e.isActive('heading', { level: 1 }),
      heading2: e.isActive('heading', { level: 2 }),
      heading3: e.isActive('heading', { level: 3 }),
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      taskList: e.isActive('taskList'),
      blockquote: e.isActive('blockquote'),
      canText: !selectionTouchesTable(e.state),
      canHeading1: e.can().toggleHeading({ level: 1 }),
      canHeading2: e.can().toggleHeading({ level: 2 }),
      canHeading3: e.can().toggleHeading({ level: 3 }),
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
      let captured = linkSelectionRef.current
      if (!captured) return
      for (const change of [transaction, ...appendedTransactions]) {
        captured = {
          target: mapSelection(editor, captured.target, change),
          original: mapSelection(editor, captured.original, change),
        }
      }
      const selection = resolveSelection(captured.target, editor.state.doc)
      linkSelectionRef.current =
        selection instanceof TextSelection && !selection.empty ? captured : null
      if (!linkSelectionRef.current) setLinkValue(null)
    }
    const exitOnCollapse = () => {
      const { from, to } = editor.state.selection
      if (from === to) {
        linkSelectionRef.current = null
        setLinkValue(null)
      }
    }
    editor.on('selectionUpdate', exitOnCollapse)
    editor.on('transaction', mapLinkRange)
    return () => {
      editor.off('selectionUpdate', exitOnCollapse)
      editor.off('transaction', mapLinkRange)
    }
  }, [editor])

  /**
   * Window-level release/cancel/blur handlers clear the drag gate even outside the editor,
   * preventing a lost pointer release from suppressing later keyboard selections.
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
    dom.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onWindowBlur)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      dom.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onWindowBlur)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [editor, bubbleMenuKey])

  const openLinkEditor = () => {
    if (!editor.isEditable || editor.isActive('codeBlock') || editor.isActive('code')) return
    const captured = captureLinkSelection(editor)
    if (!captured) return
    linkSelectionRef.current = captured
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
      if (editor.isActive('codeBlock') || editor.isActive('code')) return
      const captured = captureLinkSelection(editor)
      if (!captured) return
      event.preventDefault()
      linkSelectionRef.current = captured
      setLinkValue(editor.getAttributes('link').href ?? '')
    }
    dom.addEventListener('keydown', openLinkOnShortcut)
    return () => {
      dom.removeEventListener('keydown', openLinkOnShortcut)
    }
  }, [editor])

  const commitCapturedLink = (href: string) => {
    if (editor.isDestroyed || !editor.isEditable) return
    const captured = linkSelectionRef.current
    const selection = captured && resolveSelection(captured.target, editor.state.doc)
    if (selection instanceof TextSelection && !selection.empty) {
      applyLink(
        editor.chain().focus().setTextSelection({ from: selection.from, to: selection.to }),
        href
      )
    }
    linkSelectionRef.current = null
    setLinkValue(null)
  }
  const commitLink = () => commitCapturedLink(linkValue ?? '')
  const removeLink = () => commitCapturedLink('')

  const cancelLink = () => {
    const captured = linkSelectionRef.current
    linkSelectionRef.current = null
    setLinkValue(null)
    if (!captured || editor.isDestroyed) return
    editor.view.dispatch(
      editor.state.tr.setSelection(resolveSelection(captured.original, editor.state.doc))
    )
    editor.commands.focus()
  }

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
    onEscape: isEditingLink ? cancelLink : undefined,
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
              onCancel={cancelLink}
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
                <ToolbarButton
                  icon={Blimp}
                  iconSize='compact'
                  label='Add to Chat'
                  onClick={onAddToChat}
                />
                <ToolbarDivider />
              </>
            )}
            <ToolbarMenu
              editor={editor}
              label='Text style'
              value='Style'
              items={[
                {
                  icon: Pilcrow,
                  label: 'Text',
                  active: active.text,
                  disabled: !active.canText,
                  onSelect: () => {
                    if (!selectionTouchesTable(editor.state)) {
                      editor.chain().focus().clearNodes().run()
                    }
                  },
                },
                {
                  icon: Heading1,
                  label: 'Heading 1',
                  shortcut: '⌘⌥1',
                  active: active.heading1,
                  disabled: !active.canHeading1,
                  onSelect: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
                },
                {
                  icon: Heading2,
                  label: 'Heading 2',
                  shortcut: '⌘⌥2',
                  active: active.heading2,
                  disabled: !active.canHeading2,
                  onSelect: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
                },
                {
                  icon: Heading3,
                  label: 'Heading 3',
                  shortcut: '⌘⌥3',
                  active: active.heading3,
                  disabled: !active.canHeading3,
                  onSelect: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
                },
                {
                  icon: List,
                  label: 'Bulleted list',
                  shortcut: '⌘⇧8',
                  active: active.bulletList,
                  disabled: !active.canBulletList,
                  onSelect: () => editor.chain().focus().toggleBulletList().run(),
                },
                {
                  icon: ListOrdered,
                  label: 'Numbered list',
                  shortcut: '⌘⇧7',
                  active: active.orderedList,
                  disabled: !active.canOrderedList,
                  onSelect: () => editor.chain().focus().toggleOrderedList().run(),
                },
                {
                  icon: ListChecks,
                  label: 'Checklist',
                  shortcut: '⌘⇧9',
                  active: active.taskList,
                  disabled: !active.canTaskList,
                  onSelect: () => editor.chain().focus().toggleTaskList().run(),
                },
                {
                  icon: TextQuote,
                  label: 'Quote',
                  shortcut: '⌘⇧B',
                  active: active.blockquote,
                  disabled: !active.canBlockquote,
                  onSelect: () => editor.chain().focus().toggleBlockquote().run(),
                },
              ]}
            />
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
              icon={LinkIcon}
              label='Link'
              shortcut='⌘K'
              isActive={active.link}
              onClick={openLinkEditor}
            />
            <ToolbarMenu
              editor={editor}
              label='More formatting'
              active={active.strike || active.highlight || active.code}
              items={[
                {
                  icon: Strikethrough,
                  label: 'Strikethrough',
                  shortcut: '⌘⇧S',
                  active: active.strike,
                  onSelect: () => editor.chain().focus().toggleStrike().run(),
                },
                {
                  icon: Highlighter,
                  label: 'Highlight',
                  shortcut: '⌘⇧H',
                  active: active.highlight,
                  onSelect: () => editor.chain().focus().toggleMark('highlight').run(),
                },
                {
                  icon: Code,
                  label: 'Code',
                  shortcut: '⌘E',
                  active: active.code,
                  onSelect: () => editor.chain().focus().toggleCode().run(),
                },
              ]}
            />
          </>
        )}
      </div>
    </BubbleMenu>
  )
}
