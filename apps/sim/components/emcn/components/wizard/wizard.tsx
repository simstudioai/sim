'use client'

import * as React from 'react'
import { cn } from '@/lib/core/utils/cn'
import { Button } from '../button/button'
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  type ModalSize,
} from '../modal/modal'

/**
 * A multi-step modal wizard primitive.
 *
 * @remarks
 * Wraps the emcn Modal with a step progress bar, a shared Back / Next / Done
 * footer, and declarative `Wizard.Step` children. Step state is controlled
 * from the outside so the consumer can hydrate from persisted state, reset
 * on close, or jump around imperatively.
 *
 * @example
 * ```tsx
 * const [open, setOpen] = useState(false)
 * const [step, setStep] = useState(0)
 *
 * <Wizard
 *   open={open}
 *   onOpenChange={(next) => { if (!next) setStep(0); setOpen(next) }}
 *   currentStep={step}
 *   onStepChange={setStep}
 *   size='lg'
 *   height='h-[580px]'
 * >
 *   <Wizard.Step title='Configure'>
 *     <ConfigureForm />
 *   </Wizard.Step>
 *   <Wizard.Step title='Review' canAdvance={isValid}>
 *     <Review />
 *   </Wizard.Step>
 *   <Wizard.Step title='Done'>
 *     <DoneSummary />
 *   </Wizard.Step>
 * </Wizard>
 * ```
 */

export interface WizardStepProps {
  /** Title shown in the modal header when this step is active. */
  title: string
  /** Step body. Rendered inside the modal body when this step is active. */
  children: React.ReactNode
  /**
   * When false, the Next button on this step is disabled. Lets the consumer
   * gate progression on validation or async state.
   * @default true
   */
  canAdvance?: boolean
}

/**
 * Declares one step in the wizard. Carries metadata via props; the actual
 * children are extracted and rendered by the `Wizard` root.
 */
const Step: React.FC<WizardStepProps> = ({ children }) => <>{children}</>
Step.displayName = 'Wizard.Step'

const STEP_DISPLAY_NAME = 'Wizard.Step'

function isStepElement(node: React.ReactNode): node is React.ReactElement<WizardStepProps> {
  if (!React.isValidElement(node)) return false
  const type = node.type as { displayName?: string } | string
  return typeof type !== 'string' && type?.displayName === STEP_DISPLAY_NAME
}

export interface WizardProps {
  /** Whether the wizard modal is open. */
  open: boolean
  /** Called when the modal's open state changes. */
  onOpenChange: (next: boolean) => void
  /** Zero-indexed current step. */
  currentStep: number
  /** Called with the new step index when the user clicks Back / Next. */
  onStepChange: (next: number) => void
  /**
   * Modal size variant. Matches `ModalContent` sizes.
   * @default 'lg'
   */
  size?: ModalSize
  /**
   * Optional fixed height for the modal content. Pass a Tailwind class
   * (e.g. `h-[580px]`) to keep the modal a stable size across steps.
   */
  height?: string
  /**
   * Called when the user clicks Done on the final step. Fires before the
   * modal closes; the wizard will close the modal itself after.
   */
  onComplete?: () => void
  /** One or more `<Wizard.Step>` elements. Non-step children are ignored. */
  children: React.ReactNode
  /** Label for the Back button. @default 'Back' */
  backLabel?: string
  /** Label for the Next button. @default 'Next' */
  nextLabel?: string
  /** Label for the Done button on the final step. @default 'Done' */
  doneLabel?: string
}

const WizardRoot: React.FC<WizardProps> = ({
  open,
  onOpenChange,
  currentStep,
  onStepChange,
  size = 'lg',
  height,
  onComplete,
  children,
  backLabel = 'Back',
  nextLabel = 'Next',
  doneLabel = 'Done',
}) => {
  const steps = React.Children.toArray(children).filter(isStepElement)
  const total = steps.length
  const clamped = Math.min(Math.max(0, currentStep), Math.max(0, total - 1))
  const activeStep = steps[clamped]
  const canAdvance = activeStep?.props.canAdvance ?? true
  const isLast = total > 0 && clamped === total - 1

  const handleBack = React.useCallback(() => {
    onStepChange(Math.max(0, clamped - 1))
  }, [clamped, onStepChange])

  const handleNext = React.useCallback(() => {
    onStepChange(Math.min(total - 1, clamped + 1))
  }, [clamped, total, onStepChange])

  const handleDone = React.useCallback(() => {
    onComplete?.()
    onOpenChange(false)
  }, [onComplete, onOpenChange])

  if (total === 0) return null

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size={size} className={height}>
        <ModalHeader>{activeStep?.props.title}</ModalHeader>

        <div className='flex items-center justify-between px-4 pb-4'>
          <div className='flex flex-1 gap-1.5'>
            {steps.map((_step, i) => (
              <div
                key={i}
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors',
                  i <= clamped ? 'bg-[var(--brand-secondary)]' : 'bg-[var(--surface-5)]'
                )}
              />
            ))}
          </div>
          <span className='ml-3 shrink-0 font-normal text-[var(--text-muted)] text-xs'>
            {clamped + 1}/{total}
          </span>
        </div>

        <ModalBody>{activeStep}</ModalBody>

        <ModalFooter>
          <Button variant='default' onClick={handleBack} disabled={clamped === 0}>
            {backLabel}
          </Button>
          {isLast ? (
            <Button variant='primary' onClick={handleDone}>
              {doneLabel}
            </Button>
          ) : (
            <Button variant='primary' onClick={handleNext} disabled={!canAdvance}>
              {nextLabel}
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export const Wizard = Object.assign(WizardRoot, {
  Step,
})
