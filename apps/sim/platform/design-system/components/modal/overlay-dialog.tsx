'use client'

import { type FormEventHandler, type ReactNode, useId, useLayoutEffect, useRef } from 'react'
import styles from '@/platform/design-system/components/modal/modal.module.css'
import { ModalHeader } from '@/platform/design-system/components/modal/modal-parts'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'

interface DialogSurfaceProps {
  open: boolean
  onClose: () => void
  description?: string
  step?: number
  busy?: boolean
  onSubmit?: FormEventHandler<HTMLFormElement>
  children: ReactNode
}

type OverlayDialogProps = DialogSurfaceProps &
  (
    | { title: string; label?: never; presentation?: 'form' | 'confirm' | 'feedback' }
    | { title?: never; label: string; presentation: 'command' }
  )

export function OverlayDialog({
  label,
  open,
  onClose,
  title,
  description,
  presentation,
  step,
  busy,
  onSubmit,
  children,
}: OverlayDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  const layout = useScrollEdges<HTMLElement>()
  useLayoutEffect(() => {
    const dialog = ref.current
    if (!dialog || !open) return
    dialog.showModal()
    return () => dialog.close()
  }, [open])
  useLayoutEffect(() => {
    const dialog = ref.current
    if (!dialog || !open || busy) return
    const body = step === undefined ? dialog : dialog.querySelector('fieldset:not([hidden])')
    const field = Array.from(
      body?.querySelectorAll<HTMLElement>(
        'input:enabled:not([type="hidden"], [readonly]), textarea:enabled:not([readonly]), select:enabled, [role="combobox"]:not(:disabled, [aria-disabled="true"])'
      ) ?? []
    ).find((element) => element.tabIndex >= 0 && element.checkVisibility())
    const target = field ?? dialog.querySelector<HTMLElement>('footer button:enabled')
    target?.focus({ preventScroll: true })
  }, [open, step, busy])
  const content = (
    <>
      {title && (
        <ModalHeader
          title={title}
          description={description}
          titleId={`${id}-title`}
          descriptionId={`${id}-description`}
          onClose={onClose}
        />
      )}
      {children}
    </>
  )
  return (
    <dialog
      ref={ref}
      className={styles.modal}
      data-material='floating'
      data-elevation='modal'
      data-presentation={presentation}
      aria-label={label}
      aria-labelledby={title ? `${id}-title` : undefined}
      aria-describedby={description ? `${id}-description` : undefined}
      onKeyDown={(event) => {
        if (
          event.key === 'Escape' &&
          !event.defaultPrevented &&
          !event.nativeEvent.isComposing &&
          event.target instanceof HTMLInputElement &&
          event.target.type === 'search' &&
          event.target.closest('dialog') === event.currentTarget
        ) {
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }
      }}
      onCancel={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {open &&
        (onSubmit ? (
          <form
            ref={layout}
            className={styles.modalLayout}
            aria-busy={busy || undefined}
            onSubmit={onSubmit}
          >
            {content}
          </form>
        ) : (
          <div ref={layout} className={styles.modalLayout}>
            {content}
          </div>
        ))}
    </dialog>
  )
}
