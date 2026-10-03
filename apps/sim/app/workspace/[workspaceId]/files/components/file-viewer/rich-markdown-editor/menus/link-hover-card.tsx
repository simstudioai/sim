import { useCallback, useEffect, useRef, useState } from 'react'
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'
import { useCopyToClipboard } from '@sim/emcn'
import { Check, Duplicate, Pencil, Unlink } from '@sim/emcn/icons'
import { getMarkRange } from '@tiptap/core'
import { type Editor, useEditorState } from '@tiptap/react'
import { createPortal } from 'react-dom'
import { normalizeLinkHref } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-fidelity'
import {
  applyLink,
  LinkUrlInput,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/link-editing'
import { ToolbarButton } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/toolbar-button'

interface LinkHoverCardProps {
  editor: Editor
}

interface LinkRange {
  from: number
  to: number
}

/** Resolves a still-mounted link's current document range, including changes since it was hovered. */
function resolveLinkRange(editor: Editor, el: HTMLElement): LinkRange | null {
  if (!editor.view.dom.contains(el)) return null
  const { state } = editor.view
  const linkType = state.schema.marks.link
  if (!linkType) return null
  const pos = editor.view.posAtDOM(el, 0)
  if (pos < 0) return null
  const range =
    getMarkRange(state.doc.resolve(pos), linkType) ??
    getMarkRange(state.doc.resolve(pos + 1), linkType)
  if (!range) return null
  return { from: range.from, to: range.to }
}

/**
 * Floating card shown when hovering a link, so the destination is visible even when the link text
 * differs from the URL. The URL opens in a new tab; Copy is always available, while Edit (inline) and
 * Remove require an editable document. Positioned with Floating UI against the hovered anchor; a short
 * close delay plus the card's own hover bridge let the pointer travel from the link into the card.
 */
export function LinkHoverCard({ editor }: LinkHoverCardProps) {
  const canEdit = useEditorState({ editor, selector: ({ editor: e }) => e.isEditable })
  const [activeLink, setActiveLink] = useState<HTMLElement | null>(null)
  const [draftHref, setDraftHref] = useState<string | null>(null)
  const [measurement, setMeasurement] = useState<{
    anchor: HTMLElement
    x: number
    y: number
  } | null>(null)
  const position = measurement?.anchor === activeLink ? measurement : null
  const isEditing = draftHref !== null
  const editInputRef = useRef<HTMLInputElement>(null)
  const floatingRef = useRef<HTMLDivElement>(null)
  const { copied, copy } = useCopyToClipboard()
  const hideTimerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    const floating = floatingRef.current
    if (!activeLink || !floating) return
    let active = true
    const cleanup = autoUpdate(activeLink, floating, () => {
      computePosition(activeLink, floating, {
        strategy: 'fixed',
        placement: 'top',
        middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        if (active) setMeasurement({ anchor: activeLink, x, y })
      })
    })
    return () => {
      active = false
      cleanup()
    }
  }, [activeLink])

  const cancelHide = useCallback(() => window.clearTimeout(hideTimerRef.current), [])
  const dismiss = useCallback(() => {
    cancelHide()
    setActiveLink(null)
    setDraftHref(null)
  }, [cancelHide])
  const scheduleHide = useCallback(() => {
    cancelHide()
    if (isEditing) return
    hideTimerRef.current = window.setTimeout(() => {
      if (floatingRef.current?.contains(document.activeElement)) return
      setActiveLink(null)
      setDraftHref(null)
    }, 120)
  }, [cancelHide, isEditing])

  useEffect(() => {
    const dom = editor.view.dom
    const onOver = (event: Event) => {
      if (
        isEditing ||
        floatingRef.current?.contains(document.activeElement) ||
        !editor.state.selection.empty
      )
        return
      const link = (event.target as HTMLElement | null)?.closest('a')
      if (link && dom.contains(link)) {
        cancelHide()
        setActiveLink(link)
      }
    }
    const onOut = (event: MouseEvent) => {
      const link = (event.target as HTMLElement | null)?.closest('a')
      if (!link) return
      if (link.contains(event.relatedTarget as Node | null)) return
      scheduleHide()
    }
    dom.addEventListener('mouseover', onOver)
    dom.addEventListener('mouseout', onOut)
    return () => {
      dom.removeEventListener('mouseover', onOver)
      dom.removeEventListener('mouseout', onOut)
      window.clearTimeout(hideTimerRef.current)
    }
  }, [editor, cancelHide, scheduleHide, isEditing])

  useEffect(() => {
    if (!activeLink) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (
        !(target instanceof Node) ||
        activeLink.contains(target) ||
        floatingRef.current?.contains(target)
      )
        return
      dismiss()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [activeLink, dismiss])

  useEffect(() => {
    if (isEditing) editInputRef.current?.focus()
  }, [isEditing])

  if (!activeLink) return null

  const rawHref = activeLink.getAttribute('href') ?? ''
  const safeHref = normalizeLinkHref(rawHref)
  const startEdit = () => {
    if (editor.isDestroyed || !editor.isEditable) return
    cancelHide()
    setDraftHref(rawHref)
  }

  const commitEdit = () => {
    if (editor.isDestroyed || !editor.isEditable) return
    const range = resolveLinkRange(editor, activeLink)
    if (range) applyLink(editor.chain().focus().setTextSelection(range), draftHref ?? '')
    dismiss()
  }

  const removeLink = () => {
    if (editor.isDestroyed || !editor.isEditable) return
    const range = resolveLinkRange(editor, activeLink)
    if (range) applyLink(editor.chain().focus().setTextSelection(range), '')
    dismiss()
  }

  return createPortal(
    <div
      ref={floatingRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        transform: position ? `translate(${position.x}px, ${position.y}px)` : undefined,
        opacity: position ? 1 : 0,
        pointerEvents: position ? undefined : 'none',
      }}
      role='dialog'
      aria-label='Link'
      onMouseEnter={cancelHide}
      onMouseLeave={scheduleHide}
      onFocus={cancelHide}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) dismiss()
      }}
      className='z-[var(--z-popover)] flex items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-1 shadow-xs transition-opacity duration-150 ease-out'
    >
      {isEditing ? (
        <>
          <LinkUrlInput
            inputRef={editInputRef}
            value={draftHref ?? ''}
            readOnly={!canEdit}
            onChange={setDraftHref}
            onCommit={commitEdit}
            onCancel={() => {
              dismiss()
              editor.commands.focus()
            }}
          />
          <ToolbarButton icon={Check} label='Apply link' disabled={!canEdit} onClick={commitEdit} />
        </>
      ) : (
        <>
          {safeHref ? (
            <a
              href={safeHref}
              target='_blank'
              rel='noopener noreferrer'
              title={rawHref}
              className='max-w-[260px] truncate px-2 text-[var(--text-body)] text-small hover:underline'
            >
              {rawHref}
            </a>
          ) : (
            <span className='max-w-[260px] truncate px-2 text-[var(--text-muted)] text-small'>
              {rawHref}
            </span>
          )}
          <ToolbarButton
            icon={copied ? Check : Duplicate}
            label={copied ? 'Copied' : 'Copy link'}
            onClick={() => {
              void copy(rawHref)
            }}
          />
          {canEdit && <ToolbarButton icon={Pencil} label='Edit link' onClick={startEdit} />}
          {canEdit && <ToolbarButton icon={Unlink} label='Remove link' onClick={removeLink} />}
        </>
      )}
    </div>,
    document.body
  )
}
