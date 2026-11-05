import type { ReactNode } from 'react'
import { IconButton } from '@/platform/design-system/components/button/button'
import styles from '@/platform/design-system/components/modal/modal.module.css'

interface ModalHeaderProps {
  title: string
  description?: string
  titleId?: string
  descriptionId?: string
  onClose?: () => void
}

export function ModalHeader({
  title,
  description,
  titleId,
  descriptionId,
  onClose,
}: ModalHeaderProps) {
  return (
    <header className={styles.modalHeader}>
      <div className={styles.heading}>
        <h2 id={titleId} data-type='T083'>
          {title}
        </h2>
        {description && (
          <p id={descriptionId} data-type='T048' aria-live='polite'>
            {description}
          </p>
        )}
      </div>
      <IconButton label='Close' icon='I105' onClick={onClose} />
    </header>
  )
}

interface ModalBodyProps {
  label?: string
  inactive?: boolean
  children: ReactNode
}

export function ModalBody({ children, label, inactive }: ModalBodyProps) {
  return (
    <fieldset className={styles.modalBody} hidden={inactive} disabled={inactive} aria-label={label}>
      {children}
    </fieldset>
  )
}

interface ModalFooterProps {
  progress?: string
  children: ReactNode
}

export function ModalFooter({ progress, children }: ModalFooterProps) {
  return (
    <footer className={styles.modalFooter}>
      {progress && (
        <span className={styles.progress} data-type='T052' aria-live='polite'>
          {progress}
        </span>
      )}
      {children}
    </footer>
  )
}
