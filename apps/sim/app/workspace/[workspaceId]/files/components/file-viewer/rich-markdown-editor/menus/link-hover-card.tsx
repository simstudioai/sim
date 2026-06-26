import { useCallback, useEffect, useRef, useState } from 'react'
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'
import { getMarkRange } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import { Check, Copy, Pencil, Unlink } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { normalizeLinkHref } from '../markdown-fidelity'
import { applyLink, LinkUrlInput } from './link-editing'
import { ToolbarButton } from './toolbar-button'

interface LinkHoverCardProps {
  editor: Editor
}

interface LinkRange {
  from: number
  to: number
  href: string
}

/** Resolves the document range and href of the link rendered by `el`, or null if it isn't a link. */
function resolveLinkRange(editor: Editor, el: HTMLElement): LinkRange | null {
  const { state } = editor.view
  const linkType = state.schema.marks.link
  if (!linkType) return null
  const pos = editor.view.posAtDOM(el, 0)
  if (pos < 0) return null
  const range =
    getMarkRange(state.doc.resolve(pos), linkType) ??
    getMarkRange(state.doc.resolve(pos + 1), linkType)
  if (!range) return null
  const href = el.getAttribute('href') ?? ''
  return { from: range.from, to: range.to, href }
}

/**
 * Floating card shown when hovering a link, so the destination is visible even when the link text
 * differs from the URL. The URL opens in a new tab; Copy is always available, while Edit (inline) and
 * Remove require an editable document. Positioned with Floating UI against the hovered anchor; a short
 * close delay plus the card's own hover bridge let the pointer travel from the link into the card.
 */
export function LinkHoverCard({ editor }: LinkHoverCardProps) {
  const [activeLink, setActiveLink] = useState<HTMLElement | null>(null)
  const [draftHref, setDraftHref] = useState<string | null>(null)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const isEditing = draftHref !== null
  const editInputRef = useRef<HTMLInputElement>(null)
  const floatingRef = useRef<HTMLDivElement>(null)
  const { copied, copy } = useCopyToClipboard()
  const hideTimerRef = useRef<number | undefined>(undefined)

  // Keep the card anchored to the hovered link with Floating UI's DOM core (the same primitive the
  // bubble menu positions through) — no React wrapper, so the harness/app share one React instance.
  useEffect(() => {
    const floating = floatingRef.current
    if (!activeLink || !floating) {
      setPosition(null)
      return
    }
    return autoUpdate(activeLink, floating, () => {
      computePosition(activeLink, floating, {
        strategy: 'fixed',
        placement: 'top',
        middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
      }).then(({ x, y }) => setPosition({ x, y }))
    })
  }, [activeLink])

  const cancelHide = useCallback(() => window.clearTimeout(hideTimerRef.current), [])
  const dismiss = useCallback(() => {
    cancelHide()
    setActiveLink(null)
    setDraftHref(null)
  }, [cancelHide])
  const scheduleHide = useCallback(() => {
    cancelHide()
    hideTimerRef.current = window.setTimeout(() => {
      setActiveLink(null)
      setDraftHref(null)
    }, 120)
  }, [cancelHide])

  useEffect(() => {
    const dom = editor.view.dom
    const onOver = (event: Event) => {
      // Don't compete with the selection toolbar while text is selected.
      if (!editor.state.selection.empty) return
      const link = (event.target as HTMLElement | null)?.closest('a')
      if (link && dom.contains(link)) {
        cancelHide()
        setActiveLink(link)
      }
    }
    const onOut = (event: MouseEvent) => {
      const link = (event.target as HTMLElement | null)?.closest('a')
      if (!link) return
      // Ignore moves that stay within the same link.
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
  }, [editor, cancelHide, scheduleHide])

  useEffect(() => {
    if (isEditing) editInputRef.current?.focus()
  }, [isEditing])

  if (!activeLink) return null

  const rawHref = activeLink.getAttribute('href') ?? ''
  const safeHref = normalizeLinkHref(rawHref)
  const canEdit = editor.isEditable

  const startEdit = () => setDraftHref(rawHref)

  const commitEdit = () => {
    const range = resolveLinkRange(editor, activeLink)
    if (range) applyLink(editor.chain().focus().setTextSelection(range), draftHref ?? '')
    dismiss()
  }

  const removeLink = () => {
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
      className='z-[var(--z-popover)] flex items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-1 shadow-sm transition-opacity duration-150 ease-out'
    >
      {isEditing ? (
        <>
          <LinkUrlInput
            inputRef={editInputRef}
            value={draftHref ?? ''}
            onChange={setDraftHref}
            onCommit={commitEdit}
            onCancel={() => setDraftHref(null)}
          />
          <ToolbarButton icon={Check} label='Apply link' onClick={commitEdit} />
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
            icon={copied ? Check : Copy}
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
