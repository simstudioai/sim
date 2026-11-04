'use client'

import { type ReactNode, useId, useRef, useState } from 'react'
import styles from '@/platform/design-system/components/components.module.css'
import { Button } from '@/platform/design-system/components/controls'
import {
  ModalBody,
  ModalFooter,
  ModalHeader,
} from '@/platform/design-system/components/modal-parts'

interface ModalStep {
  description?: string
  content: ReactNode
}

interface ModalActions {
  triggerLabel: string
  title: string
  confirmLabel: string
  onConfirm?: () => void
}

interface MultiStepModalProps extends ModalActions {
  steps: readonly [ModalStep, ...ModalStep[]]
}

interface ModalSurfaceProps extends MultiStepModalProps {
  destructive?: boolean
  presentation?: ModalProps['variant']
}

function ModalSurface({
  triggerLabel,
  title,
  confirmLabel,
  steps,
  destructive,
  presentation = 'form',
  onConfirm,
}: ModalSurfaceProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [index, setIndex] = useState(0)
  const [session, setSession] = useState(0)
  const step = steps[index]
  const multiStep = steps.length > 1
  const last = index === steps.length - 1

  function advance() {
    if (!last) {
      setIndex(index + 1)
      return
    }
    dialog.current?.close()
    onConfirm?.()
  }

  return (
    <>
      <Button variant='secondary' onClick={() => dialog.current?.showModal()}>
        {triggerLabel}
      </Button>
      <dialog
        ref={dialog}
        className={styles.modal}
        data-material='floating'
        data-presentation={presentation}
        data-elevation='modal'
        aria-labelledby={`${id}-title`}
        aria-describedby={step.description ? `${id}-description` : undefined}
        onClose={() => {
          setIndex(0)
          setSession((value) => value + 1)
        }}
      >
        <form
          key={session}
          className={styles.modalLayout}
          onSubmit={(event) => {
            event.preventDefault()
            advance()
          }}
        >
          <ModalHeader
            title={title}
            description={step.description}
            titleId={`${id}-title`}
            descriptionId={`${id}-description`}
            onClose={() => dialog.current?.close()}
          />
          {steps.map((entry, i) => (
            <ModalBody key={i} inactive={i !== index} label={entry.description || title}>
              {entry.content}
            </ModalBody>
          ))}
          <ModalFooter progress={multiStep ? `Step ${index + 1} of ${steps.length}` : undefined}>
            <Button
              variant='quiet'
              onClick={() => (index === 0 ? dialog.current?.close() : setIndex(index - 1))}
            >
              {index === 0 ? 'Cancel' : 'Back'}
            </Button>
            <Button variant={destructive ? 'destructive' : 'primary'} submit>
              {last ? confirmLabel : 'Continue'}
            </Button>
          </ModalFooter>
        </form>
      </dialog>
    </>
  )
}

interface ModalProps extends ModalActions {
  variant?: 'form' | 'confirm' | 'feedback'
  children?: ReactNode
  description?: string
  destructive?: boolean
}

export function Modal({
  triggerLabel,
  title,
  confirmLabel,
  onConfirm,
  children,
  variant = 'form',
  description,
  destructive,
}: ModalProps) {
  return (
    <ModalSurface
      triggerLabel={triggerLabel}
      title={title}
      confirmLabel={confirmLabel}
      onConfirm={onConfirm}
      steps={[{ description, content: children }]}
      destructive={destructive}
      presentation={variant}
    />
  )
}

export function MultiStepModal({
  triggerLabel,
  title,
  confirmLabel,
  steps,
  onConfirm,
}: MultiStepModalProps) {
  return (
    <ModalSurface
      triggerLabel={triggerLabel}
      title={title}
      confirmLabel={confirmLabel}
      steps={steps}
      onConfirm={onConfirm}
    />
  )
}
