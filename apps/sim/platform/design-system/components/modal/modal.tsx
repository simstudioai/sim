'use client'

import { type ReactNode, useState } from 'react'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import { Button } from '@/platform/design-system/components/button/button'
import { ModalBody, ModalFooter } from '@/platform/design-system/components/modal/modal-parts'
import { OverlayDialog } from '@/platform/design-system/components/modal/overlay-dialog'

interface ModalStep {
  description?: string
  content: ReactNode
}

interface ModalActions {
  title: string
  confirmLabel: string
  onConfirm?: (values: FormData) => void
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
  onConfirm?: () => void
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
}

function ModalSurface({
  triggerLabel,
  triggerIcon,
  title,
  confirmLabel,
  steps,
  destructive,
  presentation = 'form',
  onConfirm,
  open: controlled,
  onOpenChange,
}: ModalSurfaceProps) {
  const [internal, setInternal] = useState(false)
  const [index, setIndex] = useState(0)
  const open = controlled ?? internal
  const step = steps[index]
  const last = index === steps.length - 1

  function close() {
    setIndex(0)
    if (onOpenChange) onOpenChange(false)
    else setInternal(false)
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
        label={title}
        title={title}
        description={step.description}
        presentation={presentation}
        onClose={close}
        onSubmit={(event) => {
          event.preventDefault()
          if (!last) {
            setIndex(index + 1)
            return
          }
          const values = new FormData(event.currentTarget)
          close()
          onConfirm?.(values)
        }}
      >
        {steps.map((entry, i) => (
          <ModalBody key={i} inactive={i !== index} label={entry.description || title}>
            {entry.content}
          </ModalBody>
        ))}
        <ModalFooter
          progress={steps.length > 1 ? `Step ${index + 1} of ${steps.length}` : undefined}
        >
          <Button variant='quiet' onClick={() => (index === 0 ? close() : setIndex(index - 1))}>
            {index === 0 ? 'Cancel' : 'Back'}
          </Button>
          <Button variant={destructive ? 'destructive' : 'primary'} submit>
            {last ? confirmLabel : 'Continue'}
          </Button>
        </ModalFooter>
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
  }

export function Modal({
  triggerLabel,
  triggerIcon,
  open,
  onOpenChange,
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
      triggerIcon={triggerIcon}
      open={open}
      onOpenChange={onOpenChange}
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
