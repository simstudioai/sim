'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Combobox, Input, Textarea } from '@/components/emcn'
import { Check } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import { captureClientEvent } from '@/lib/posthog/client'
import {
  CONTACT_TOPIC_OPTIONS,
  type ContactRequestPayload,
  contactRequestSchema,
} from '@/app/(landing)/components/contact/consts'
import { LandingField } from '@/app/(landing)/components/forms/landing-field'

type ContactField = keyof ContactRequestPayload
type ContactErrors = Partial<Record<ContactField, string>>

interface ContactFormState {
  name: string
  email: string
  company: string
  topic: ContactRequestPayload['topic'] | ''
  subject: string
  message: string
}

const INITIAL_FORM_STATE: ContactFormState = {
  name: '',
  email: '',
  company: '',
  topic: '',
  subject: '',
  message: '',
}

const COMBOBOX_TOPICS = [...CONTACT_TOPIC_OPTIONS]

const LANDING_INPUT =
  'h-[36px] rounded-[5px] border border-[var(--border-1)] bg-[var(--surface-5)] px-3 font-[430] font-season text-[14px] text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)]'

async function submitContactRequest(payload: ContactRequestPayload) {
  const response = await fetch('/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const result = (await response.json().catch(() => null)) as {
    error?: string
    message?: string
  } | null

  if (!response.ok) {
    throw new Error(result?.error || 'Failed to send message')
  }

  return result
}

export function ContactForm() {
  const [form, setForm] = useState<ContactFormState>(INITIAL_FORM_STATE)
  const [errors, setErrors] = useState<ContactErrors>({})
  const [submitSuccess, setSubmitSuccess] = useState(false)

  const contactMutation = useMutation({
    mutationFn: submitContactRequest,
    onSuccess: (_data, variables) => {
      captureClientEvent('landing_contact_submitted', { topic: variables.topic })
      setForm(INITIAL_FORM_STATE)
      setErrors({})
      setSubmitSuccess(true)
    },
  })

  function updateField<TField extends keyof ContactFormState>(
    field: TField,
    value: ContactFormState[TField]
  ) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => {
      if (!prev[field as ContactField]) {
        return prev
      }
      const nextErrors = { ...prev }
      delete nextErrors[field as ContactField]
      return nextErrors
    })
    if (contactMutation.isError) {
      contactMutation.reset()
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (contactMutation.isPending) return

    const parsed = contactRequestSchema.safeParse({
      ...form,
      company: form.company || undefined,
    })

    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors
      setErrors({
        name: fieldErrors.name?.[0],
        email: fieldErrors.email?.[0],
        company: fieldErrors.company?.[0],
        topic: fieldErrors.topic?.[0],
        subject: fieldErrors.subject?.[0],
        message: fieldErrors.message?.[0],
      })
      return
    }

    contactMutation.mutate(parsed.data)
  }

  const submitError = contactMutation.isError
    ? contactMutation.error instanceof Error
      ? contactMutation.error.message
      : 'Failed to send message. Please try again.'
    : null

  if (submitSuccess) {
    return (
      <div className='flex min-h-[460px] flex-col items-center justify-center rounded-[8px] border border-[var(--border-1)] bg-[var(--surface-5)] px-8 py-16 text-center'>
        <div className='flex h-16 w-16 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text-primary)]'>
          <Check className='h-8 w-8' />
        </div>
        <h2 className='mt-6 font-[430] font-season text-[24px] text-[var(--text-primary)] leading-[1.2] tracking-[-0.02em]'>
          Message received
        </h2>
        <p className='mt-3 max-w-sm font-season text-[14px] text-[var(--text-secondary)] leading-[1.6]'>
          Thanks for reaching out. We've sent a confirmation to your inbox and will get back to you
          shortly.
        </p>
        <button
          type='button'
          onClick={() => setSubmitSuccess(false)}
          className='mt-6 font-season text-[13px] text-[var(--text-primary)] underline underline-offset-2 transition-opacity hover:opacity-80'
        >
          Send another message
        </button>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className='flex flex-col gap-4 rounded-[8px] border border-[var(--border-1)] bg-[var(--surface-5)] p-6 sm:p-8'
    >
      <div className='grid gap-4 sm:grid-cols-2'>
        <LandingField htmlFor='contact-name' label='Name' error={errors.name}>
          <Input
            id='contact-name'
            value={form.name}
            onChange={(event) => updateField('name', event.target.value)}
            placeholder='Your name'
            className={LANDING_INPUT}
          />
        </LandingField>
        <LandingField htmlFor='contact-email' label='Email' error={errors.email}>
          <Input
            id='contact-email'
            type='email'
            value={form.email}
            onChange={(event) => updateField('email', event.target.value)}
            placeholder='you@company.com'
            className={LANDING_INPUT}
          />
        </LandingField>
      </div>

      <div className='grid gap-4 sm:grid-cols-2'>
        <LandingField htmlFor='contact-company' label='Company' optional error={errors.company}>
          <Input
            id='contact-company'
            value={form.company}
            onChange={(event) => updateField('company', event.target.value)}
            placeholder='Company name'
            className={LANDING_INPUT}
          />
        </LandingField>
        <LandingField htmlFor='contact-topic' label='Topic' error={errors.topic}>
          <Combobox
            options={COMBOBOX_TOPICS}
            value={form.topic}
            selectedValue={form.topic}
            onChange={(value) => updateField('topic', value as ContactRequestPayload['topic'])}
            placeholder='Select a topic'
            editable={false}
            filterOptions={false}
            className='h-[36px] rounded-[5px] px-3 font-[430] font-season text-[14px]'
          />
        </LandingField>
      </div>

      <LandingField htmlFor='contact-subject' label='Subject' error={errors.subject}>
        <Input
          id='contact-subject'
          value={form.subject}
          onChange={(event) => updateField('subject', event.target.value)}
          placeholder='How can we help?'
          className={LANDING_INPUT}
        />
      </LandingField>

      <LandingField htmlFor='contact-message' label='Message' error={errors.message}>
        <Textarea
          id='contact-message'
          value={form.message}
          onChange={(event) => updateField('message', event.target.value)}
          placeholder='Share details so we can help as quickly as possible'
          className='min-h-[140px] rounded-[5px] border border-[var(--border-1)] bg-[var(--surface-5)] px-3 py-2.5 font-[430] font-season text-[14px] text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)]'
        />
      </LandingField>

      {submitError ? (
        <p role='alert' className='font-season text-[13px] text-[var(--text-error)]'>
          {submitError}
        </p>
      ) : null}

      <button
        type='submit'
        disabled={contactMutation.isPending}
        className={cn(
          'flex h-[40px] w-full items-center justify-center rounded-[5px] bg-[var(--text-primary)]',
          'font-[430] font-season text-[14px] text-[var(--bg)] transition-opacity',
          'hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60'
        )}
      >
        {contactMutation.isPending ? 'Sending...' : 'Send message'}
      </button>
    </form>
  )
}
