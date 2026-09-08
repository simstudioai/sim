import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Link, RefreshCw, TypeText, X } from '@sim/emcn/icons'
import type { Node } from '@tiptap/pm/model'
import { NodeSelection, PluginKey } from '@tiptap/pm/state'
import { type Editor, useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { type ProsemirrorBinding, ySyncPluginKey } from '@tiptap/y-tiptap'
import type { XmlElement } from 'yjs'
import {
  createImageTargetGuard,
  getImageYTarget,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-target'
import { normalizeLinkHref } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-fidelity'
import { BUBBLE_MENU_CLASS } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/bubble-menu-chrome'
import {
  ToolbarButton,
  ToolbarDivider,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/toolbar-button'
import { ToolbarInput } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/toolbar-input'
import { useBubbleMenuFloating } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/use-bubble-menu-floating'
import { useEditorToolbar } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/use-editor-toolbar'

interface ImageBubbleMenuProps {
  editor: Editor
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

interface ImageDraft {
  target: Node | XmlElement
  matchesTarget: (node: Node) => boolean
  field: 'alt' | 'href'
  initial: string
  value: string
}

function selectedImage(editor: Editor) {
  if (editor.isDestroyed || !editor.isEditable) return null
  const { selection } = editor.state
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'image') return null
  const binding: ProsemirrorBinding | undefined = ySyncPluginKey.getState(editor.state)?.binding
  const target = binding ? getImageYTarget(binding, selection.node) : selection.node
  return target ? { node: selection.node, target, binding } : null
}

const shouldShowImageMenu = ({ editor }: { editor: Editor }) => selectedImage(editor) !== null

/** Image actions use the same floating bar, inline fields, and keyboard navigation as text/table actions. */
export function ImageBubbleMenu({ editor, scrollContainerRef }: ImageBubbleMenuProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [menuKey] = useState(() => new PluginKey('markdownImageMenu'))
  const [draft, setDraft] = useState<ImageDraft | null>(null)
  const selected = useEditorState({
    editor,
    selector: ({ editor: current }) => selectedImage(current),
    equalityFn: (a, b) => a?.node === b?.node && a?.target === b?.target,
  })
  if (draft && draft.target !== selected?.target) setDraft(null)
  const currentDraft = draft?.target === selected?.target ? draft : null
  const editingField = currentDraft?.field
  const hasCustomSize = Boolean(selected?.node.attrs.width || selected?.node.attrs.height)
  const normalizedHref =
    currentDraft?.field === 'href' ? normalizeLinkHref(currentDraft.value.trim()) : null
  const invalidLink =
    currentDraft?.field === 'href' && Boolean(currentDraft.value.trim()) && !normalizedHref

  const { appendTo } = useBubbleMenuFloating(editor, scrollContainerRef)
  const canFocus = useCallback(() => selectedImage(editor) !== null, [editor])
  const toolbar = useEditorToolbar({
    editor,
    pluginKey: menuKey,
    canFocus,
    roving: !currentDraft,
    onEscape: () => setDraft(null),
  })

  const matchesDraftTarget = draft?.matchesTarget
  useEffect(() => {
    if (!matchesDraftTarget) return
    const invalidateDraft = () => {
      const image = selectedImage(editor)
      if (!image || !matchesDraftTarget(image.node)) setDraft(null)
    }
    editor.on('transaction', invalidateDraft)
    invalidateDraft()
    return () => {
      editor.off('transaction', invalidateDraft)
    }
  }, [editor, matchesDraftTarget])

  useEffect(() => {
    if (editingField) inputRef.current?.focus()
  }, [editingField])

  useEffect(() => {
    if (!editor.isDestroyed) editor.commands.setMeta(menuKey, 'updatePosition')
  }, [editor, menuKey, editingField, hasCustomSize, selected?.target])

  const close = () => {
    setDraft(null)
    if (!editor.isDestroyed) editor.commands.focus()
  }
  const edit = (field: ImageDraft['field']) => {
    const image = selectedImage(editor)
    if (!image || image.target !== selected?.target) return
    const value = typeof image.node.attrs[field] === 'string' ? image.node.attrs[field] : ''
    const matchesTarget = image.binding
      ? createImageTargetGuard(image.binding, image.node)
      : (node: Node) => node === image.node
    setDraft({ target: image.target, matchesTarget, field, initial: value, value })
  }
  const apply = () => {
    if (!currentDraft || invalidLink) return
    const image = selectedImage(editor)
    if (!image || image.target !== currentDraft.target || !currentDraft.matchesTarget(image.node))
      return
    if (currentDraft.value !== currentDraft.initial) {
      editor.commands.updateAttributes('image', {
        [currentDraft.field]:
          currentDraft.field === 'href' ? normalizedHref || null : currentDraft.value,
      })
    }
    close()
  }

  return (
    <BubbleMenu
      editor={editor}
      pluginKey={menuKey}
      appendTo={appendTo}
      updateDelay={0}
      shouldShow={shouldShowImageMenu}
      hidden={!editor.isEditable}
      className={BUBBLE_MENU_CLASS}
    >
      <div
        {...toolbar}
        role='toolbar'
        aria-label='Image editing'
        className='flex items-center gap-0.5'
      >
        {currentDraft ? (
          <>
            <ToolbarInput
              label={currentDraft.field === 'alt' ? 'Image alt text' : 'Image link URL'}
              placeholder={
                currentDraft.field === 'alt' ? 'Describe the image…' : 'Paste or type a link…'
              }
              inputMode={currentDraft.field === 'href' ? 'url' : 'text'}
              value={currentDraft.value}
              onChange={(value) => setDraft({ ...currentDraft, value })}
              onCommit={apply}
              onCancel={close}
              inputRef={inputRef}
              invalid={invalidLink}
            />
            <ToolbarButton
              icon={Check}
              label='Apply image change'
              disabled={invalidLink}
              onClick={apply}
            />
            <ToolbarButton icon={X} label='Cancel image change' onClick={close} />
          </>
        ) : (
          <>
            <ToolbarButton
              icon={TypeText}
              label='Edit image alt text'
              onClick={() => edit('alt')}
            />
            <ToolbarButton
              icon={Link}
              label='Edit image link'
              isActive={Boolean(selected?.node.attrs.href)}
              onClick={() => edit('href')}
            />
            {hasCustomSize && (
              <>
                <ToolbarDivider />
                <ToolbarButton
                  icon={RefreshCw}
                  label='Reset image size'
                  onClick={() => {
                    const image = selectedImage(editor)
                    if (!image || image.target !== selected?.target) return
                    editor
                      .chain()
                      .focus()
                      .updateAttributes('image', { width: null, height: null })
                      .run()
                  }}
                />
              </>
            )}
          </>
        )}
      </div>
    </BubbleMenu>
  )
}
