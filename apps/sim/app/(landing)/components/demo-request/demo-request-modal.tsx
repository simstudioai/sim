'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  Combobox,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTrigger,
  Textarea,
} from '@/components/emcn'
import { Check } from '@/components/emcn/icons'
import { requestJson } from '@/lib/api/client/request'
import {
  DEMO_REQUEST_COMPANY_SIZE_OPTIONS,
  type DemoRequestPayload,
  demoRequestSchema,
  submitDemoRequestContract,
} from '@/lib/api/contracts/demo-requests'
import { flattenFieldErrors } from '@/lib/api/contracts/primitives'
import { captureClientEvent } from '@/lib/posthog/client'
import { LandingField } from '@/app/(landing)/components/forms/landing-field'

interface DemoRequestModalProps {
  children: React.ReactNode
  theme?: 'dark' | 'light'
}

type DemoRequestField = keyof DemoRequestPayload
type DemoRequestErrors = Partial<Record<DemoRequestField, string>>

interface DemoRequestFormState {
  firstName: string
  lastName: string
  companyEmail: string
  phoneNumber: string
  companySize: DemoRequestPayload['companySize'] | ''
  details: string
}

const SUBMIT_SUCCESS_MESSAGE = "We'll be in touch soon!"
const COMBOBOX_COMPANY_SIZES = [...DEMO_REQUEST_COMPANY_SIZE_OPTIONS]

const INITIAL_FORM_STATE: DemoRequestFormState = {
  firstName: '',
  lastName: '',
  companyEmail: '',
  phoneNumber: '',
  companySize: '',
  details: '',
}

const LANDING_INPUT =
  'h-[32px] rounded-[5px] border border-[var(--border-1)] bg-[var(--surface-5)] px-2.5 font-[430] font-season text-[13.5px] text-[var(--text-primary)] transition-colors placeholder:text-[var(--text-muted)] outline-none'

async function submitDemoRequest(payload: DemoRequestPayload) {
  return requestJson(submitDemoRequestContract, { body: payload })
}

export function DemoRequestModal({ children, theme = 'dark' }: DemoRequestModalProps) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<DemoRequestFormState>(INITIAL_FORM_STATE)
  const [errors, setErrors] = useState<DemoRequestErrors>({})
  const [submitSuccess, setSubmitSuccess] = useState(false)

  const demoMutation = useMutation({
    mutationFn: submitDemoRequest,
    onSuccess: (_data, variables) => {
      captureClientEvent('landing_demo_request_submitted', {
        company_size: variables.companySize,
      })
      setSubmitSuccess(true)
    },
  })

  function resetForm() {
    setForm(INITIAL_FORM_STATE)
    setErrors({})
    setSubmitSuccess(false)
    demoMutation.reset()
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    resetForm()
  }

  function updateField<TField extends keyof DemoRequestFormState>(
    field: TField,
    value: DemoRequestFormState[TField]
  ) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => {
      if (!prev[field]) {
        return prev
      }
      const nextErrors = { ...prev }
      delete nextErrors[field]
      return nextErrors
    })
    if (demoMutation.isError) {
      demoMutation.reset()
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (demoMutation.isPending) return

    const parsed = demoRequestSchema.safeParse({
      ...form,
      phoneNumber: form.phoneNumber || undefined,
    })

    if (!parsed.success) {
      setErrors(flattenFieldErrors<DemoRequestField>(parsed.error))
      return
    }

    demoMutation.mutate(parsed.data)
  }

  const submitError = demoMutation.isError
    ? demoMutation.error instanceof Error
      ? demoMutation.error.message
      : 'Failed to submit demo request. Please try again.'
    : null

  return (
    <Modal open={open} onOpenChange={handleOpenChange}>
      <ModalTrigger asChild>{children}</ModalTrigger>
      <ModalContent size='lg' className={theme === 'dark' ? 'dark' : undefined}>
        <ModalHeader>
          <span className={submitSuccess ? 'sr-only' : undefined}>
            <span className='font-[430] font-season text-[15px] tracking-[-0.02em]'>
              {submitSuccess ? 'Demo request submitted' : 'Talk to sales'}
            </span>
          </span>
        </ModalHeader>
        <div className='relative flex-1'>
          <form
            onSubmit={handleSubmit}
            aria-hidden={submitSuccess}
            className={
              submitSuccess
                ? 'pointer-events-none invisible flex h-full flex-col'
                : 'flex h-full flex-col'
            }
          >
            <ModalBody>
              <div className='space-y-3'>
                <div className='grid gap-3 sm:grid-cols-2'>
                  <LandingField htmlFor='firstName' label='First name' error={errors.firstName}>
                    <Input
                      id='firstName'
                      value={form.firstName}
                      onChange={(event) => updateField('firstName', event.target.value)}
                      placeholder='First'
                      className={LANDING_INPUT}
                    />
                  </LandingField>
                  <LandingField htmlFor='lastName' label='Last name' error={errors.lastName}>
                    <Input
                      id='lastName'
                      value={form.lastName}
                      onChange={(event) => updateField('lastName', event.target.value)}
                      placeholder='Last'
                      className={LANDING_INPUT}
                    />
                  </LandingField>
                </div>

                <LandingField
                  htmlFor='companyEmail'
                  label='Company email'
                  error={errors.companyEmail}
                >
                  <Input
                    id='companyEmail'
                    type='email'
                    value={form.companyEmail}
                    onChange={(event) => updateField('companyEmail', event.target.value)}
                    placeholder='Your work email'
                    className={LANDING_INPUT}
                  />
                </LandingField>

                <LandingField
                  htmlFor='phoneNumber'
                  label='Phone number'
                  optional
                  error={errors.phoneNumber}
                >
                  <Input
                    id='phoneNumber'
                    type='tel'
                    value={form.phoneNumber}
                    onChange={(event) => updateField('phoneNumber', event.target.value)}
                    placeholder='Your phone number'
                    className={LANDING_INPUT}
                  />
                </LandingField>

                <LandingField htmlFor='companySize' label='Company size' error={errors.companySize}>
                  <Combobox
                    options={COMBOBOX_COMPANY_SIZES}
                    value={form.companySize}
                    selectedValue={form.companySize}
                    onChange={(value) =>
                      updateField('companySize', value as DemoRequestPayload['companySize'])
                    }
                    placeholder='Select'
                    editable={false}
                    filterOptions={false}
                    className='h-[32px] rounded-[5px] px-2.5 font-[430] font-season text-[13.5px]'
                  />
                </LandingField>

                <LandingField htmlFor='details' label='Details' error={errors.details}>
                  <Textarea
                    id='details'
                    value={form.details}
                    onChange={(event) => updateField('details', event.target.value)}
                    placeholder='Tell us about your needs and questions'
                    className='min-h-[80px] rounded-[5px] border border-[var(--border-1)] bg-[var(--surface-5)] px-2.5 py-2 font-[430] font-season text-[13.5px] text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)]'
                  />
                </LandingField>
              </div>
            </ModalBody>

            <ModalFooter className='flex-col items-stretch gap-3 border-t-0 bg-transparent pt-0'>
              {submitError && (
                <p role='alert' className='font-season text-[13px] text-[var(--text-error)]'>
                  {submitError}
                </p>
              )}
              <button
                type='submit'
                disabled={demoMutation.isPending}
                className='flex h-[32px] w-full items-center justify-center rounded-[5px] bg-[var(--text-primary)] font-[430] font-season text-[13.5px] text-[var(--bg)] transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'
              >
                {demoMutation.isPending ? 'Submitting...' : 'Submit'}
              </button>
            </ModalFooter>
          </form>

          {submitSuccess ? (
            <div className='absolute inset-0 flex items-center justify-center px-8 pb-10 sm:px-12 sm:pb-14'>
              <div className='flex max-w-md flex-col items-center justify-center text-center'>
                <div className='flex h-20 w-20 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text-primary)]'>
                  <Check className='h-10 w-10' />
                </div>
                <h2 className='mt-8 font-[430] font-season text-[34px] text-[var(--text-primary)] leading-[1.1] tracking-[-0.03em]'>
                  {SUBMIT_SUCCESS_MESSAGE}
                </h2>
                <p className='mt-4 font-season text-[15px] text-[var(--text-secondary)] leading-7'>
                  Our team will be in touch soon. If you have any questions, please email us at{' '}
                  <a
                    href='mailto:enterprise@sim.ai'
                    className='text-[var(--text-primary)] underline underline-offset-2'
                  >
                    enterprise@sim.ai
                  </a>
                  .
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </ModalContent>
    </Modal>
  )
}
