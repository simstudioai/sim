'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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
import {
  applyLink,
  FloatingToolbar,
  LinkUrlInput,
  ToolbarButton,
  ToolbarDivider,
  ToolbarMenu,
} from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/rich-markdown-editor/toolbar'
import {
  selectionTouchesTable,
  useBubbleMenuFloating,
  useEditorToolbar,
} from '@/platform/lib/data/files/markdown'

/** The toolbar shows for an editable, non-code range that covers some text. */
function hasFormattableSelection(editor: Editor, from: number, to: number): boolean {
  if (!editor.isEditable || editor.isActive('codeBlock')) return false
  return editor.state.doc.textBetween(from, to, ' ').trim().length > 0
}

/** `show` alone leaves the bar unpositioned; the follow-up anchors it. Neither dirties the doc. */
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

/** Collaborative positions survive the full-document replacements Yjs updates apply. */
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

/** Keeps the link's target apart from the selection a cancel restores. */
function captureLinkSelection(editor: Editor): LinkSelection | null {
  const original = captureSelection(editor)
  if (editor.state.selection.empty) editor.commands.extendMarkRange('link')
  const { selection } = editor.state
  return selection.empty ? null : { target: captureSelection(editor), original }
}

interface EditorBubbleMenuProps {
  editor: Editor
  /** The editor's scroller, which the bar is placed in so it follows the selection as it scrolls. */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  /** Adds the selection to a new chat as a reference. */
  onAddToChat?: () => void
}

/**
 * The formatting bar shown on a text selection: Add to Chat, the block style, the common marks and a
 * link editor that swaps into the bar. Active states come through `useEditorState`, so the bar stays
 * current without re-rendering the editor on every transaction.
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

  /** A drag selection reveals the bar on release; window-level handlers keep the gate honest. */
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
    return () => dom.removeEventListener('keydown', openLinkOnShortcut)
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
      if (!e.isEditable) return false
      if (isEditingLink) return true
      if (isPointerDownRef.current) return false
      return hasFormattableSelection(e, from, to)
    },
    [isEditingLink]
  )

  const run = (command: () => void) => () => {
    if (!editor.isDestroyed && editor.isEditable) command()
  }

  return (
    <BubbleMenu
      editor={editor}
      pluginKey={bubbleMenuKey}
      getReferencedVirtualElement={resolveAnchor}
      appendTo={appendTo}
      updateDelay={0}
      shouldShow={shouldShow}
      hidden={!active.editable}
    >
      <FloatingToolbar
        label={isEditingLink ? 'Link editing' : 'Text formatting'}
        role={isEditingLink ? 'group' : 'toolbar'}
        toolbarRef={toolbar.ref}
        onFocusCapture={toolbar.onFocusCapture}
        onClickCapture={toolbar.onClickCapture}
        onKeyDown={toolbar.onKeyDown}
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
            {active.link && <ToolbarButton label='Remove link' onClick={removeLink} />}
            <ToolbarButton label='Apply link' icon='I072' onClick={commitLink} />
          </>
        ) : (
          <>
            {onAddToChat && (
              <>
                <ToolbarButton label='Add to Chat' icon='I073' onClick={onAddToChat} />
                <ToolbarDivider />
              </>
            )}
            {active.editable && (
              <ToolbarMenu
                label='Text style'
                triggerText='Style'
                actions={[
                  {
                    id: 'text',
                    label: 'Text',
                    checked: active.text,
                    disabled: !active.canText,
                    onSelect: run(() => {
                      if (!selectionTouchesTable(editor.state))
                        editor.chain().focus().clearNodes().run()
                    }),
                  },
                  {
                    id: 'heading-1',
                    label: 'Heading 1',
                    shortcut: '⌘⌥1',
                    checked: active.heading1,
                    disabled: !active.canHeading1,
                    onSelect: run(() => editor.chain().focus().toggleHeading({ level: 1 }).run()),
                  },
                  {
                    id: 'heading-2',
                    label: 'Heading 2',
                    shortcut: '⌘⌥2',
                    checked: active.heading2,
                    disabled: !active.canHeading2,
                    onSelect: run(() => editor.chain().focus().toggleHeading({ level: 2 }).run()),
                  },
                  {
                    id: 'heading-3',
                    label: 'Heading 3',
                    shortcut: '⌘⌥3',
                    checked: active.heading3,
                    disabled: !active.canHeading3,
                    onSelect: run(() => editor.chain().focus().toggleHeading({ level: 3 }).run()),
                  },
                  {
                    id: 'bulleted-list',
                    label: 'Bulleted list',
                    shortcut: '⌘⇧8',
                    checked: active.bulletList,
                    disabled: !active.canBulletList,
                    onSelect: run(() => editor.chain().focus().toggleBulletList().run()),
                  },
                  {
                    id: 'numbered-list',
                    label: 'Numbered list',
                    shortcut: '⌘⇧7',
                    checked: active.orderedList,
                    disabled: !active.canOrderedList,
                    onSelect: run(() => editor.chain().focus().toggleOrderedList().run()),
                  },
                  {
                    id: 'checklist',
                    label: 'Checklist',
                    shortcut: '⌘⇧9',
                    checked: active.taskList,
                    disabled: !active.canTaskList,
                    onSelect: run(() => editor.chain().focus().toggleTaskList().run()),
                  },
                  {
                    id: 'quote',
                    label: 'Quote',
                    shortcut: '⌘⇧B',
                    checked: active.blockquote,
                    disabled: !active.canBlockquote,
                    onSelect: run(() => editor.chain().focus().toggleBlockquote().run()),
                  },
                ]}
              />
            )}
            <ToolbarButton
              label='Bold'
              shortcut='⌘B'
              pressed={active.bold}
              onClick={() => editor.chain().focus().toggleBold().run()}
            />
            <ToolbarButton
              label='Italic'
              shortcut='⌘I'
              pressed={active.italic}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            />
            <ToolbarButton
              label='Link'
              shortcut='⌘K'
              pressed={active.link}
              onClick={openLinkEditor}
            />
            {active.editable && (
              <ToolbarMenu
                label='More formatting'
                actions={[
                  {
                    id: 'strike',
                    label: 'Strikethrough',
                    shortcut: '⌘⇧S',
                    checked: active.strike,
                    onSelect: run(() => editor.chain().focus().toggleStrike().run()),
                  },
                  {
                    id: 'highlight',
                    label: 'Highlight',
                    shortcut: '⌘⇧H',
                    checked: active.highlight,
                    onSelect: run(() => editor.chain().focus().toggleMark('highlight').run()),
                  },
                  {
                    id: 'code',
                    label: 'Code',
                    shortcut: '⌘E',
                    checked: active.code,
                    onSelect: run(() => editor.chain().focus().toggleCode().run()),
                  },
                ]}
              />
            )}
          </>
        )}
      </FloatingToolbar>
    </BubbleMenu>
  )
}
