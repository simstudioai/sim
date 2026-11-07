import type { ComponentProps, ReactNode } from 'react'
import { Button, IconButton } from '#emcn/components/button/button'
import styles from '#emcn/components/modal/modal.module.css'

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
  onInput?: () => void
  children: ReactNode
}

export function ModalBody({ children, label, inactive, onInput }: ModalBodyProps) {
  return (
    <fieldset
      className={styles.modalBody}
      hidden={inactive}
      disabled={inactive}
      aria-label={label}
      onInput={onInput}
    >
      {children}
    </fieldset>
  )
}

interface ModalFooterProps {
  /** Absent for a dialog whose rows act on their own, which only closes. */
  confirmLabel?: string
  onPrevious?: () => void
  cancelLabel?: string
  destructive?: boolean
  disabled?: boolean
  cancelDisabled?: boolean
  progress?: string
  footerStartAction?: Pick<
    ComponentProps<typeof Button>,
    'variant' | 'destructive' | 'icon' | 'disabled' | 'onClick'
  > & {
    label: string
  }
}

export function ModalFooter({
  confirmLabel,
  onPrevious,
  cancelLabel = 'Cancel',
  destructive,
  disabled,
  cancelDisabled,
  progress,
  footerStartAction,
}: ModalFooterProps) {
  return (
    <footer className={styles.modalFooter}>
      {footerStartAction && (
        <div className={styles.footerStart}>
          <Button
            variant={footerStartAction.variant}
            destructive={footerStartAction.destructive}
            icon={footerStartAction.icon}
            disabled={cancelDisabled || footerStartAction.disabled}
            onClick={footerStartAction.onClick}
          >
            {footerStartAction.label}
          </Button>
        </div>
      )}
      {progress && (
        <span className={styles.progress} data-type='T052' aria-live='polite'>
          {progress}
        </span>
      )}
      <div className={styles.footerEnd} data-modal-actions=''>
        <Button variant='quiet' disabled={cancelDisabled} onClick={onPrevious}>
          {cancelLabel}
        </Button>
        {confirmLabel && (
          <Button variant={destructive ? 'destructive' : 'primary'} submit disabled={disabled}>
            {confirmLabel}
          </Button>
        )}
      </div>
    </footer>
  )
}
