'use client'

import { type ReactNode, useId, useRef, useState } from 'react'
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'
import { Chip, ChipDropdown, ChipInput, ChipTextarea, Label } from '@sim/emcn'
import { Check } from '@sim/emcn/icons'
import { toError } from '@sim/utils/errors'
import {
  CONTACT_TOPIC_OPTIONS,
  type ContactRequestPayload,
  contactRequestSchema,
} from '@/lib/api/contracts/contact'
import { flattenFieldErrors } from '@/lib/api/contracts/primitives'
import { getEnv } from '@/lib/core/config/env'
import { captureClientEvent } from '@/lib/posthog/client'
import { useSubmitContact } from '@/hooks/queries/contact'

/**
 * Field control height — slightly taller than the 30px in-app chip default and
 * just under the 36px auth field, so the form reads as a roomy landing surface.
 * Applied to each control's `className`, the sanctioned way to own only a chip
 * field's height (mirrors the demo form).
 */
const FIELD_HEIGHT = 'h-[34px]'

/** Build-time-inlined Turnstile site key; absent when captcha isn't configured. */
const TURNSTILE_SITE_KEY = getEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY')

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

const INITIAL_STATE: ContactFormState = {
  name: '',
  email: '',
  company: '',
  topic: '',
  subject: '',
  message: '',
}

interface ContactFieldProps {
  label: string
  /** Set for native controls (inputs/textarea) to associate the label by `id`. */
  htmlFor?: string
  required?: boolean
  error?: string
  /** The control. Dropdowns (no `htmlFor`) are wrapped in a labeled group. */
  children: ReactNode
}

/**
 * A labeled field row matching the chip field rhythm (`gap-[9px]`, muted label,
 * caption-sized error). Native controls associate via `htmlFor`/`id`; controls
 * that can't take a label `id` (the dropdown) become a `role='group'` named by
 * the label instead, so every field has an accessible name.
 */
function ContactField({ label, htmlFor, required, error, children }: ContactFieldProps) {
  const labelId = useId()
  const isGroup = htmlFor === undefined
  return (
    <div
      className='flex flex-col gap-[9px]'
      role={isGroup ? 'group' : undefined}
      aria-labelledby={isGroup ? labelId : undefined}
    >
      <Label id={labelId} htmlFor={htmlFor} className='pl-0.5 font-normal text-[var(--text-muted)]'>
        {label}
        {required ? (
          <span aria-hidden className='ml-0.5 text-[var(--text-error)]'>
            *
          </span>
        ) : null}
      </Label>
      {children}
      {error ? <p className='pl-0.5 text-[var(--text-error)] text-caption'>{error}</p> : null}
    </div>
  )
}

/**
 * The `/contact` form — rendered inside the card chrome owned by the page, so it
 * returns just its heading and fields. Fields are hand-composed at the slightly
 * taller {@link FIELD_HEIGHT}, stacked at the platform `gap-4` rhythm with no
 * divider lines, mirroring the demo booking form.
 *
 * On submit it validates against the shared {@link contactRequestSchema}, runs an
 * invisible Turnstile challenge (falling back gracefully when the widget is
 * unavailable), and posts through {@link useSubmitContact}, which emails the help
 * inbox and sends the visitor a confirmation. A honeypot `website` field and the
 * captcha token ride along on the payload. A successful submit swaps the card to a
 * confirmation state.
 */
export function ContactForm() {
  const turnstileRef = useRef<TurnstileInstance>(null)

  const contactMutation = useSubmitContact()

  const [form, setForm] = useState<ContactFormState>(INITIAL_STATE)
  const [errors, setErrors] = useState<ContactErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [website, setWebsite] = useState('')
  const [widgetLoaded, setWidgetLoaded] = useState(false)

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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (contactMutation.isPending || isSubmitting) return
    setIsSubmitting(true)

    const parsed = contactRequestSchema.safeParse({
      ...form,
      company: form.company || undefined,
    })

    if (!parsed.success) {
      setErrors(flattenFieldErrors<ContactField>(parsed.error))
      setIsSubmitting(false)
      return
    }

    let captchaToken: string | undefined
    const widget = turnstileRef.current

    if (TURNSTILE_SITE_KEY && widgetLoaded && widget) {
      try {
        widget.reset()
        widget.execute()
        captchaToken = await widget.getResponsePromise(30_000)
      } catch {
        captchaToken = undefined
      }
    }

    contactMutation.mutate(
      { ...parsed.data, website, captchaToken },
      {
        onSuccess: () => {
          captureClientEvent('landing_contact_submitted', { topic: parsed.data.topic })
          setForm(INITIAL_STATE)
          setErrors({})
        },
        onError: () => {
          turnstileRef.current?.reset()
        },
        onSettled: () => {
          setIsSubmitting(false)
        },
      }
    )
  }

  const isBusy = contactMutation.isPending || isSubmitting

  const submitError = contactMutation.isError
    ? toError(contactMutation.error).message || 'Failed to send message. Please try again.'
    : null

  if (contactMutation.isSuccess) {
    return (
      <div className='flex flex-col items-center px-4 py-12 text-center'>
        <div className='flex size-14 items-center justify-center rounded-full border border-[var(--border-1)] bg-[var(--surface-1)] text-[var(--text-primary)]'>
          <Check className='size-7' />
        </div>
        <h2 className='mt-5 text-[var(--text-primary)] text-xl leading-[1.2]'>Message received</h2>
        <p className='mt-2 max-w-sm text-[var(--text-muted)] text-sm leading-[1.6]'>
          Thanks for reaching out. Our team will get back to you shortly.
        </p>
        <button
          type='button'
          onClick={() => contactMutation.reset()}
          className='mt-5 text-[var(--text-primary)] text-small underline underline-offset-2 transition-opacity hover:opacity-80'
        >
          Send another message
        </button>
      </div>
    )
  }

  return (
    <>
      <h2 id='contact-form-heading' className='text-[var(--text-primary)] text-xl leading-[1.2]'>
        Send us a message
      </h2>
      <p className='mt-1.5 text-[var(--text-muted)] text-sm'>
        Ask a question, request an integration, or get help — we'll get back to you shortly.
      </p>

      <form
        onSubmit={handleSubmit}
        aria-labelledby='contact-form-heading'
        className='relative mt-5 flex flex-col gap-4'
        noValidate
      >
        <div
          aria-hidden='true'
          className='pointer-events-none absolute left-[-9999px] h-px w-px overflow-hidden opacity-0'
        >
          <label htmlFor='contact-website'>Website</label>
          <input
            id='contact-website'
            name='website'
            type='text'
            tabIndex={-1}
            autoComplete='off'
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            data-lpignore='true'
            data-1p-ignore='true'
          />
        </div>

        <div className='grid grid-cols-2 gap-3 max-sm:grid-cols-1'>
          <ContactField label='Name' htmlFor='contact-name' required error={errors.name}>
            <ChipInput
              id='contact-name'
              className={FIELD_HEIGHT}
              value={form.name}
              onChange={(event) => updateField('name', event.target.value)}
              error={Boolean(errors.name)}
              placeholder='Jane Doe'
              autoComplete='name'
            />
          </ContactField>
          <ContactField label='Email' htmlFor='contact-email' required error={errors.email}>
            <ChipInput
              id='contact-email'
              type='email'
              className={FIELD_HEIGHT}
              value={form.email}
              onChange={(event) => updateField('email', event.target.value)}
              error={Boolean(errors.email)}
              placeholder='jane@acme.co'
              autoComplete='email'
            />
          </ContactField>
        </div>

        <div className='grid grid-cols-2 gap-3 max-sm:grid-cols-1'>
          <ContactField label='Company (optional)' htmlFor='contact-company' error={errors.company}>
            <ChipInput
              id='contact-company'
              className={FIELD_HEIGHT}
              value={form.company}
              onChange={(event) => updateField('company', event.target.value)}
              error={Boolean(errors.company)}
              placeholder='Acme Inc.'
              autoComplete='organization'
            />
          </ContactField>
          <ContactField label='Topic' required error={errors.topic}>
            <ChipDropdown
              fullWidth
              flush
              className={FIELD_HEIGHT}
              value={form.topic || undefined}
              onChange={(value) => updateField('topic', value as ContactRequestPayload['topic'])}
              options={CONTACT_TOPIC_OPTIONS}
              placeholder='Select a topic'
            />
          </ContactField>
        </div>

        <ContactField label='Subject' htmlFor='contact-subject' required error={errors.subject}>
          <ChipInput
            id='contact-subject'
            className={FIELD_HEIGHT}
            value={form.subject}
            onChange={(event) => updateField('subject', event.target.value)}
            error={Boolean(errors.subject)}
            placeholder='How can we help?'
          />
        </ContactField>

        <ContactField label='Message' htmlFor='contact-message' required error={errors.message}>
          <ChipTextarea
            id='contact-message'
            value={form.message}
            onChange={(event) => updateField('message', event.target.value)}
            error={Boolean(errors.message)}
            placeholder='Share details so we can help as quickly as possible.'
            rows={4}
          />
        </ContactField>

        {TURNSTILE_SITE_KEY ? (
          <Turnstile
            ref={turnstileRef}
            siteKey={TURNSTILE_SITE_KEY}
            options={{ execution: 'execute', appearance: 'execute', size: 'invisible' }}
            onWidgetLoad={() => setWidgetLoaded(true)}
            onError={() => setWidgetLoaded(false)}
            onUnsupported={() => setWidgetLoaded(false)}
          />
        ) : null}

        {submitError ? (
          <p role='alert' className='text-[var(--text-error)] text-caption'>
            {submitError}
          </p>
        ) : null}

        <Chip
          type='submit'
          variant='primary'
          flush
          fullWidth
          disabled={isBusy}
          className='mt-1 justify-center [&>span]:flex-none'
        >
          {isBusy ? 'Sending…' : 'Send message'}
        </Chip>
      </form>
    </>
  )
}
