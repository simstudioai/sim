'use client'

import { useCallback, useState } from 'react'
import {
  Button,
  Combobox,
  FormField,
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
import {
  DEMO_REQUEST_REGION_OPTIONS,
  DEMO_REQUEST_USER_COUNT_OPTIONS,
  type DemoRequestPayload,
  demoRequestSchema,
} from '@/app/(home)/components/demo-request/consts'

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
  region: DemoRequestPayload['region'] | ''
  userCount: DemoRequestPayload['userCount'] | ''
  details: string
}

const SUBMIT_SUCCESS_MESSAGE = "We'll be in touch soon!"
const COMBOBOX_REGIONS = [...DEMO_REQUEST_REGION_OPTIONS]
const COMBOBOX_USER_COUNTS = [...DEMO_REQUEST_USER_COUNT_OPTIONS]

const INITIAL_FORM_STATE: DemoRequestFormState = {
  firstName: '',
  lastName: '',
  companyEmail: '',
  phoneNumber: '',
  region: '',
  userCount: '',
  details: '',
}

export function DemoRequestModal({ children, theme = 'dark' }: DemoRequestModalProps) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<DemoRequestFormState>(INITIAL_FORM_STATE)
  const [errors, setErrors] = useState<DemoRequestErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitSuccess, setSubmitSuccess] = useState(false)

  const resetForm = useCallback(() => {
    setForm(INITIAL_FORM_STATE)
    setErrors({})
    setIsSubmitting(false)
    setSubmitError(null)
    setSubmitSuccess(false)
  }, [])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen)
      resetForm()
    },
    [resetForm]
  )

  const updateField = useCallback(
    <TField extends keyof DemoRequestFormState>(
      field: TField,
      value: DemoRequestFormState[TField]
    ) => {
      setForm((prev) => ({ ...prev, [field]: value }))
      setErrors((prev) => {
        if (!prev[field]) {
          return prev
        }

        const nextErrors = { ...prev }
        delete nextErrors[field]
        return nextErrors
      })
      setSubmitError(null)
      setSubmitSuccess(false)
    },
    []
  )

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      setSubmitError(null)
      setSubmitSuccess(false)

      const parsed = demoRequestSchema.safeParse({
        ...form,
        phoneNumber: form.phoneNumber || undefined,
      })

      if (!parsed.success) {
        const fieldErrors = parsed.error.flatten().fieldErrors
        setErrors({
          firstName: fieldErrors.firstName?.[0],
          lastName: fieldErrors.lastName?.[0],
          companyEmail: fieldErrors.companyEmail?.[0],
          phoneNumber: fieldErrors.phoneNumber?.[0],
          region: fieldErrors.region?.[0],
          userCount: fieldErrors.userCount?.[0],
          details: fieldErrors.details?.[0],
        })
        return
      }

      setIsSubmitting(true)

      try {
        const response = await fetch('/api/demo-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed.data),
        })

        const result = (await response.json().catch(() => null)) as {
          error?: string
          message?: string
        } | null

        if (!response.ok) {
          throw new Error(result?.error || 'Failed to submit demo request')
        }

        setSubmitSuccess(true)
      } catch (error) {
        setSubmitError(
          error instanceof Error
            ? error.message
            : 'Failed to submit demo request. Please try again.'
        )
      } finally {
        setIsSubmitting(false)
      }
    },
    [form, resetForm]
  )

  return (
    <Modal open={open} onOpenChange={handleOpenChange}>
      <ModalTrigger asChild>{children}</ModalTrigger>
      <ModalContent size='lg' className={theme === 'dark' ? 'dark' : undefined}>
        <ModalHeader>
          <span className={submitSuccess ? 'sr-only' : undefined}>
            {submitSuccess ? 'Demo request submitted' : 'Nearly there!'}
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
              <div className='space-y-4'>
                <div className='grid gap-4 sm:grid-cols-2'>
                  <FormField htmlFor='firstName' label='First name' error={errors.firstName}>
                    <Input
                      id='firstName'
                      value={form.firstName}
                      onChange={(event) => updateField('firstName', event.target.value)}
                      placeholder='First'
                    />
                  </FormField>
                  <FormField htmlFor='lastName' label='Last name' error={errors.lastName}>
                    <Input
                      id='lastName'
                      value={form.lastName}
                      onChange={(event) => updateField('lastName', event.target.value)}
                      placeholder='Last'
                    />
                  </FormField>
                </div>

                <FormField htmlFor='companyEmail' label='Company email' error={errors.companyEmail}>
                  <Input
                    id='companyEmail'
                    type='email'
                    value={form.companyEmail}
                    onChange={(event) => updateField('companyEmail', event.target.value)}
                    placeholder='Your work email'
                  />
                </FormField>

                <FormField
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
                  />
                </FormField>

                <div className='grid gap-4 sm:grid-cols-2'>
                  <FormField htmlFor='region' label='Region' error={errors.region}>
                    <Combobox
                      options={COMBOBOX_REGIONS}
                      value={form.region}
                      selectedValue={form.region}
                      onChange={(value) =>
                        updateField('region', value as DemoRequestPayload['region'])
                      }
                      placeholder='Select'
                      editable={false}
                      filterOptions={false}
                    />
                  </FormField>
                  <FormField htmlFor='userCount' label='Number of users' error={errors.userCount}>
                    <Combobox
                      options={COMBOBOX_USER_COUNTS}
                      value={form.userCount}
                      selectedValue={form.userCount}
                      onChange={(value) =>
                        updateField('userCount', value as DemoRequestPayload['userCount'])
                      }
                      placeholder='Select'
                      editable={false}
                      filterOptions={false}
                    />
                  </FormField>
                </div>

                <FormField htmlFor='details' label='Details' error={errors.details}>
                  <Textarea
                    id='details'
                    value={form.details}
                    onChange={(event) => updateField('details', event.target.value)}
                    placeholder='Tell us about your needs and questions'
                  />
                </FormField>
              </div>
            </ModalBody>

            <ModalFooter className='flex-col items-stretch gap-3'>
              {submitError && <p className='text-[13px] text-[var(--text-error)]'>{submitError}</p>}
              <Button type='submit' variant='primary' disabled={isSubmitting}>
                {isSubmitting ? 'Submitting...' : 'Submit'}
              </Button>
            </ModalFooter>
          </form>

          {submitSuccess ? (
            <div className='absolute inset-0 flex items-center justify-center px-8 pb-10 sm:px-12 sm:pb-14'>
              <div className='flex max-w-md flex-col items-center justify-center text-center'>
                <div className='flex h-20 w-20 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text-primary)]'>
                  <Check className='h-10 w-10' />
                </div>
                <h2 className='mt-8 font-medium text-[34px] text-[var(--text-primary)] leading-[1.1] tracking-[-0.03em]'>
                  {SUBMIT_SUCCESS_MESSAGE}
                </h2>
                <p className='mt-4 text-[17px] text-[var(--text-secondary)] leading-7'>
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
