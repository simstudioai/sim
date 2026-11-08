'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'
import { CopyButton } from '@sim/emcn/button/copy-button'
import { getMarkRange } from '@tiptap/core'
import { type Editor, useEditorState } from '@tiptap/react'
import { createPortal } from 'react-dom'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/_components/rich-markdown-editor/link-hover-card.module.css'
import {
  applyLink,
  LinkUrlInput,
  ToolbarButton,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/rich-markdown-editor/toolbar'
import { normalizeLinkHref, scrollToHeading } from '@/platform/lib/data/files/markdown'

interface LinkRange {
  from: number
  to: number
}

/** The pointer's grace to travel from the link into the card before it closes. */
const HIDE_DELAY_MS = 120
const CARD_OFFSET = 8
const CARD_PADDING = 8

/** A still-mounted link's current range in the document. */
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
  return range ? { from: range.from, to: range.to } : null
}

/**
 * The card a hovered link opens, so its destination shows even when the text differs: open it
 * (a heading link scrolls in place), copy it, and while editable edit or remove it.
 */
export function LinkHoverCard({ editor }: { editor: Editor }) {
  const canEdit = useEditorState({ editor, selector: ({ editor: e }) => e.isEditable })
  const [activeLink, setActiveLink] = useState<HTMLElement | null>(null)
  const [draftHref, setDraftHref] = useState<string | null>(null)
  const [placed, setPlaced] = useState<HTMLElement | null>(null)
  const isEditing = draftHref !== null
  const editInputRef = useRef<HTMLInputElement>(null)
  const floatingRef = useRef<HTMLDivElement>(null)
  const hideTimerRef = useRef<number | undefined>(undefined)

  useLayoutEffect(() => {
    const floating = floatingRef.current
    if (!activeLink || !floating) return
    let active = true
    const cleanup = autoUpdate(activeLink, floating, () => {
      computePosition(activeLink, floating, {
        strategy: 'fixed',
        placement: 'top',
        middleware: [
          offset(CARD_OFFSET),
          flip({ padding: CARD_PADDING }),
          shift({ padding: CARD_PADDING }),
        ],
      }).then(({ x, y }) => {
        if (!active) return
        floating.style.transform = `translate(${x}px, ${y}px)`
        setPlaced(activeLink)
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
    }, HIDE_DELAY_MS)
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
      if (!link || link.contains(event.relatedTarget as Node | null)) return
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

  const host = editor.view.dom.closest<HTMLElement>('dialog, [data-emcn]')
  if (!activeLink || !host) return null

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
      role='dialog'
      aria-label='Link'
      className={styles.card}
      data-placed={placed === activeLink || undefined}
      data-material='floating'
      data-elevation='menu'
      onMouseEnter={cancelHide}
      onMouseLeave={scheduleHide}
      onFocus={cancelHide}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) dismiss()
      }}
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
          <ToolbarButton label='Apply link' icon='I072' disabled={!canEdit} onClick={commitEdit} />
        </>
      ) : (
        <>
          {safeHref ? (
            <a
              href={safeHref}
              target={safeHref.startsWith('#') ? undefined : '_blank'}
              rel='noopener noreferrer'
              title={rawHref}
              className={styles.href}
              data-type='T060'
              onClick={(event) => {
                if (!safeHref.startsWith('#')) return
                event.preventDefault()
                if (!editor.isDestroyed) scrollToHeading(editor.view, safeHref)
                dismiss()
              }}
            >
              {rawHref}
            </a>
          ) : (
            <span className={styles.href} data-type='T060' data-unsafe=''>
              {rawHref}
            </span>
          )}
          <CopyButton label='Copy link' text={rawHref} size='compact' />
          {canEdit && <ToolbarButton label='Edit link' icon='I036' onClick={startEdit} />}
          {canEdit && <ToolbarButton label='Remove link' onClick={removeLink} />}
        </>
      )}
    </div>,
    host
  )
}
