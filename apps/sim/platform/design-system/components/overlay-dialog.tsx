'use client'

import { type FormEventHandler, type ReactNode, useEffect, useId, useRef } from 'react'
import styles from '@/platform/design-system/components/components.module.css'
import { ModalHeader } from '@/platform/design-system/components/modal-parts'

interface OverlayDialogProps {
  label: string
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  presentation?: 'form' | 'confirm' | 'feedback' | 'command'
  onSubmit?: FormEventHandler<HTMLFormElement>
  children: ReactNode
}

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
      data-elevation={presentation === 'command' ? 'menu' : 'modal'}
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
          <form className={styles.modalLayout} onSubmit={onSubmit}>
            {content}
          </form>
        ) : (
          <div className={styles.modalLayout}>{content}</div>
        ))}
    </dialog>
  )
}
