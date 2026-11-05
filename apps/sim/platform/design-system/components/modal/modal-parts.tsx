import type { ReactNode } from 'react'
import { Button, IconButton } from '@/platform/design-system/components/button/button'
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
  confirmLabel: string
  onPrevious?: () => void
  previousStep?: boolean
  destructive?: boolean
  disabled?: boolean
  progress?: string
}

export function ModalFooter({
  confirmLabel,
  onPrevious,
  previousStep,
  destructive,
  disabled,
  progress,
}: ModalFooterProps) {
  return (
    <footer className={styles.modalFooter}>
      {progress && (
        <span className={styles.progress} data-type='T052' aria-live='polite'>
          {progress}
        </span>
      )}
      <Button variant='quiet' onClick={onPrevious}>
        {previousStep ? 'Back' : 'Cancel'}
      </Button>
      <Button variant={destructive ? 'destructive' : 'primary'} submit disabled={disabled}>
        {confirmLabel}
      </Button>
    </footer>
  )
}
