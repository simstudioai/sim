'use client'

import { type FormEventHandler, type ReactNode, useEffect, useId, useRef } from 'react'
import styles from '@/platform/design-system/components/modal/modal.module.css'
import { ModalHeader } from '@/platform/design-system/components/modal/modal-parts'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'

interface DialogSurfaceProps {
  open: boolean
  onClose: () => void
  description?: string
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
  onSubmit,
  children,
}: OverlayDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  const layout = useScrollEdges<HTMLElement>()
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
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
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {open &&
        (onSubmit ? (
          <form ref={layout} className={styles.modalLayout} onSubmit={onSubmit}>
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
