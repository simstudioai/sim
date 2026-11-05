'use client'

import { type ReactNode, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import { Button } from '@/platform/design-system/components/button/button'
import styles from '@/platform/design-system/components/modal/modal.module.css'
import { ModalBody, ModalFooter } from '@/platform/design-system/components/modal/modal-parts'
import { OverlayDialog } from '@/platform/design-system/components/modal/overlay-dialog'

interface ModalStep {
  description?: string
  content: ReactNode
}

/**
 * A synchronous confirm closes the dialog in the same update. A returned promise holds it open as
 * pending, closes it on success, and on rejection keeps the draft and shows the error's message.
 * Returning or resolving `false` keeps it open: the confirm reached the dialog's next stage, not its end.
 */
type ConfirmHandler<Args extends unknown[]> = (...args: Args) => unknown

interface ModalActions {
  title: string
  confirmLabel: string
  confirmDisabled?: boolean
  onConfirm?: ConfirmHandler<[values: FormData]>
}
type ModalTrigger =
  | { triggerLabel: string; triggerIcon?: IconName; open?: never; onOpenChange?: never }
  | {
      open: boolean
      onOpenChange: (open: boolean) => void
      triggerLabel?: never
      triggerIcon?: never
    }

interface MultiStepModalProps extends Omit<ModalActions, 'onConfirm'> {
  onConfirm?: ConfirmHandler<[]>
  triggerLabel: string
  steps: readonly [ModalStep, ...ModalStep[]]
}

type ModalSurfaceProps = ModalActions & {
  triggerLabel?: string
  triggerIcon?: IconName
  open?: boolean
  onOpenChange?: (open: boolean) => void
  steps: MultiStepModalProps['steps']
  destructive?: boolean
  presentation?: ModalProps['variant']
  cancelLabel?: string
  onBack?: () => void
}

function ModalSurface({
  triggerLabel,
  triggerIcon,
  title,
  confirmLabel,
  confirmDisabled,
  steps,
  destructive,
  presentation = 'form',
  cancelLabel,
  onBack,
  onConfirm,
  open: controlled,
  onOpenChange,
}: ModalSurfaceProps) {
  const [internal, setInternal] = useState(false)
  const [index, setIndex] = useState(0)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** A step back within one step still moves focus, so a repeated Enter cannot reach Cancel. */
  const [backs, setBacks] = useState(0)
  const open = controlled ?? internal
  const step = steps[index]
  const last = index === steps.length - 1

  if (!open && error) setError(null)

  function close() {
    setIndex(0)
    if (onOpenChange) onOpenChange(false)
    else setInternal(false)
  }

  async function confirm(values: FormData) {
    setError(null)
    try {
      const result = onConfirm?.(values)
      if (result instanceof Promise) {
        setPending(true)
        if ((await result) === false) return
      } else if (result === false) return
      close()
    } catch (failure) {
      setError(getErrorMessage(failure, 'Something went wrong. Please try again.'))
    } finally {
      setPending(false)
    }
  }

  // The work is already underway and its outcome belongs here, so nothing dismisses it mid-flight.
  function dismiss() {
    if (!pending) close()
  }
  return (
    <>
      {triggerLabel && (
        <Button variant='secondary' trailingIcon={triggerIcon} onClick={() => setInternal(true)}>
          {triggerLabel}
        </Button>
      )}
      <OverlayDialog
        open={open}
        title={title}
        description={step.description}
        step={index + backs}
        presentation={presentation}
        busy={pending}
        onClose={dismiss}
        onSubmit={(event) => {
          event.preventDefault()
          if (pending || (last && confirmDisabled)) return
          if (!last) {
            setIndex(index + 1)
            return
          }
          void confirm(new FormData(event.currentTarget))
        }}
      >
        {steps.map((entry, i) => (
          <ModalBody key={i} inactive={i !== index} label={entry.description || title}>
            {entry.content}
          </ModalBody>
        ))}
        {error && (
          <p className={styles.error} data-type='T052' role='alert'>
            {error}
          </p>
        )}
        <ModalFooter
          confirmLabel={last ? confirmLabel : 'Continue'}
          onPrevious={() => {
            setError(null)
            if (index > 0) setIndex(index - 1)
            else if (onBack) {
              onBack()
              setBacks(backs + 1)
            } else dismiss()
          }}
          cancelLabel={index > 0 || onBack ? 'Back' : cancelLabel}
          disabled={pending || (last && confirmDisabled)}
          cancelDisabled={pending}
          destructive={destructive}
          progress={steps.length > 1 ? `Step ${index + 1} of ${steps.length}` : undefined}
        />
      </OverlayDialog>
    </>
  )
}

type ModalProps = ModalActions &
  ModalTrigger & {
    variant?: 'form' | 'confirm' | 'feedback'
    children?: ReactNode
    description?: string
    destructive?: boolean
    /** Names the quiet footer action, "Cancel" by default. */
    cancelLabel?: string
    /** Turns the quiet footer action into Back, within the dialog. Close still closes. */
    onBack?: () => void
  }

export function Modal({
  triggerLabel,
  triggerIcon,
  open,
  onOpenChange,
  title,
  confirmLabel,
  confirmDisabled,
  onConfirm,
  children,
  variant = 'form',
  description,
  destructive,
  cancelLabel,
  onBack,
}: ModalProps) {
  return (
    <ModalSurface
      triggerLabel={triggerLabel}
      triggerIcon={triggerIcon}
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      confirmLabel={confirmLabel}
      confirmDisabled={confirmDisabled}
      onConfirm={onConfirm}
      steps={[{ description, content: children }]}
      destructive={destructive}
      presentation={variant}
      cancelLabel={cancelLabel}
      onBack={onBack}
    />
  )
}

export function MultiStepModal({
  triggerLabel,
  title,
  confirmLabel,
  confirmDisabled,
  steps,
  onConfirm,
}: MultiStepModalProps) {
  return (
    <ModalSurface
      triggerLabel={triggerLabel}
      title={title}
      confirmLabel={confirmLabel}
      confirmDisabled={confirmDisabled}
      steps={steps}
      onConfirm={onConfirm}
    />
  )
}
