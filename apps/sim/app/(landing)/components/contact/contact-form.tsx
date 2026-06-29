'use client'

import { useRef, useState } from 'react'
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'
import { toError } from '@sim/utils/errors'
import { useMutation } from '@tanstack/react-query'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Combobox, Input, Textarea } from '@/components/emcn'
import { Check } from '@/components/emcn/icons'
import { requestJson } from '@/lib/api/client/request'
import {
  CONTACT_TOPIC_OPTIONS,
  type ContactRequestPayload,
  contactRequestSchema,
  type SubmitContactBody,
  submitContactContract,
} from '@/lib/api/contracts/contact'
import { flattenFieldErrors } from '@/lib/api/contracts/primitives'
import { getEnv } from '@/lib/core/config/env'
import { captureClientEvent } from '@/lib/posthog/client'
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

const LANDING_INPUT =
  'h-[40px] rounded-[5px] border border-[var(--landing-bg-elevated)] bg-[var(--landing-bg-surface)] px-3 font-[430] font-season text-[14px] text-[var(--landing-text)] outline-none transition-colors placeholder:text-[var(--landing-text-muted)] focus:border-[var(--landing-border-strong)]'

const LANDING_TEXTAREA =
  'min-h-[140px] rounded-[5px] border border-[var(--landing-bg-elevated)] bg-[var(--landing-bg-surface)] px-3 py-2.5 font-[430] font-season text-[14px] text-[var(--landing-text)] outline-none transition-colors placeholder:text-[var(--landing-text-muted)] focus:border-[var(--landing-border-strong)]'

const LANDING_COMBOBOX =
  'h-[40px] rounded-[5px] border border-[var(--landing-bg-elevated)] bg-[var(--landing-bg-surface)] px-3 font-[430] font-season text-[14px] text-[var(--landing-text)] hover:bg-[var(--landing-bg-surface)] focus-within:border-[var(--landing-border-strong)]'

const LANDING_SUBMIT =
  'flex h-[40px] w-full items-center justify-center rounded-[5px] border border-[var(--landing-text-subtle)] bg-[var(--landing-text-subtle)] font-[430] font-season text-[14px] text-[var(--landing-text-dark)] transition-colors hover:border-[var(--landing-bg-hover)] hover:bg-[var(--landing-bg-hover)] disabled:cursor-not-allowed disabled:opacity-60'

const LANDING_LABEL =
  'font-[500] font-season text-[13px] text-[var(--landing-text)] tracking-[0.02em]'

async function submitContactRequest(payload: SubmitContactBody) {
  return requestJson(submitContactContract, { body: payload })
}

export function ContactForm() {
  const tI18n = useTranslations('auto')
  const t = useTranslations('auto')
  const turnstileRef = useRef<TurnstileInstance>(null)

  const contactMutation = useMutation({
    mutationFn: submitContactRequest,
    onSuccess: (_data, variables) => {
      captureClientEvent('landing_contact_submitted', { topic: variables.topic })
      setForm(INITIAL_FORM_STATE)
      setErrors({})
    },
    onError: () => {
      turnstileRef.current?.reset()
    },
  })

  const [form, setForm] = useState<ContactFormState>(INITIAL_FORM_STATE)
  const [errors, setErrors] = useState<ContactErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [website, setWebsite] = useState('')
  const [widgetReady, setWidgetReady] = useState(false)
  const [turnstileSiteKey] = useState(() => getEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY'))

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
    let captchaUnavailable: boolean | undefined
    const widget = turnstileRef.current

    if (turnstileSiteKey) {
      if (widgetReady && widget) {
        try {
          widget.reset()
          widget.execute()
          captchaToken = await widget.getResponsePromise(30_000)
        } catch {
          captchaUnavailable = true
        }
      } else {
        captchaUnavailable = true
      }
    }

    contactMutation.mutate({ ...parsed.data, website, captchaToken, captchaUnavailable })
    setIsSubmitting(false)
  }

  const isBusy = contactMutation.isPending || isSubmitting
  const submitSuccess = contactMutation.isSuccess

  const submitError = contactMutation.isError
    ? toError(contactMutation.error).message || 'Failed to send message. Please try again.'
    : null

  if (submitSuccess) {
    return (
      <div className='flex flex-col items-center px-8 py-16 text-center'>
        <div className='flex size-16 items-center justify-center rounded-full border border-[var(--landing-bg-elevated)] bg-[var(--landing-bg-surface)] text-[var(--landing-text)]'>
          <Check className='size-8' />
        </div>
        <h2 className='mt-6 font-[430] font-season text-[24px] text-[var(--landing-text)] leading-[1.2] tracking-[-0.02em]'>
          {t('message_received')}
        </h2>
        <p className='mt-3 max-w-sm font-season text-[14px] text-[var(--landing-text-body)] leading-[1.6]'>
          {t('thanks_for_reaching_out_we_ve')}
        </p>
        <button
          type='button'
          onClick={() => contactMutation.reset()}
          className='mt-6 font-season text-[13px] text-[var(--landing-text)] underline underline-offset-2 transition-opacity hover:opacity-80'
        >
          {t('send_another_message')}
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className='relative flex flex-col gap-5'>
      {/* Honeypot */}
      <div
        aria-hidden='true'
        className='pointer-events-none absolute left-[-9999px] h-px w-px overflow-hidden opacity-0'
      >
        <label htmlFor='contact-website'>{t('website')}</label>
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

      <div className='grid gap-5 sm:grid-cols-2'>
        <LandingField
          htmlFor='contact-name'
          label={t('name')}
          error={errors.name}
          labelClassName={LANDING_LABEL}
        >
          <Input
            id='contact-name'
            value={form.name}
            onChange={(event) => updateField('name', event.target.value)}
            placeholder={t('your_name')}
            className={LANDING_INPUT}
          />
        </LandingField>
        <LandingField
          htmlFor='contact-email'
          label={t('email')}
          error={errors.email}
          labelClassName={LANDING_LABEL}
        >
          <Input
            id='contact-email'
            type='email'
            value={form.email}
            onChange={(event) => updateField('email', event.target.value)}
            placeholder={t('you_company_com')}
            className={LANDING_INPUT}
          />
        </LandingField>
      </div>

      <div className='grid gap-5 sm:grid-cols-2'>
        <LandingField
          htmlFor='contact-company'
          label={t('company')}
          optional
          error={errors.company}
          labelClassName={LANDING_LABEL}
        >
          <Input
            id='contact-company'
            value={form.company}
            onChange={(event) => updateField('company', event.target.value)}
            placeholder={t('company_name')}
            className={LANDING_INPUT}
          />
        </LandingField>
        <LandingField
          htmlFor='contact-topic'
          label={t('topic')}
          error={errors.topic}
          labelClassName={LANDING_LABEL}
        >
          <Combobox
            options={[...CONTACT_TOPIC_OPTIONS]}
            value={form.topic}
            selectedValue={form.topic}
            onChange={(value) => updateField('topic', value as ContactRequestPayload['topic'])}
            placeholder={t('select_a_topic')}
            editable={false}
            filterOptions={false}
            className={LANDING_COMBOBOX}
          />
        </LandingField>
      </div>

      <LandingField
        htmlFor='contact-subject'
        label={t('subject')}
        error={errors.subject}
        labelClassName={LANDING_LABEL}
      >
        <Input
          id='contact-subject'
          value={form.subject}
          onChange={(event) => updateField('subject', event.target.value)}
          placeholder={t('how_can_we_help')}
          className={LANDING_INPUT}
        />
      </LandingField>

      <LandingField
        htmlFor='contact-message'
        label={t('message')}
        error={errors.message}
        labelClassName={LANDING_LABEL}
      >
        <Textarea
          id='contact-message'
          value={form.message}
          onChange={(event) => updateField('message', event.target.value)}
          placeholder={t('share_details_so_we_can_help')}
          className={LANDING_TEXTAREA}
        />
      </LandingField>

      {turnstileSiteKey ? (
        <Turnstile
          ref={turnstileRef}
          siteKey={turnstileSiteKey}
          options={{ execution: 'execute', appearance: 'execute', size: 'invisible' }}
          onWidgetLoad={() => setWidgetReady(true)}
          onExpire={() => setWidgetReady(false)}
          onError={() => setWidgetReady(false)}
          onUnsupported={() => setWidgetReady(false)}
        />
      ) : null}

      {submitError ? (
        <p role='alert' className='font-season text-[13px] text-[var(--text-error)]'>
          {submitError}
        </p>
      ) : null}

      <button type='submit' disabled={isBusy} className={LANDING_SUBMIT}>
        {isBusy ? 'Sending...' : tI18n('send_message')}
      </button>

      <p className='text-center font-season text-[12px] text-[var(--landing-text-muted)] leading-[1.6]'>
        {t('by_submitting_you_agree_to_our')}{' '}
        <Link
          href='/privacy'
          className='text-[var(--landing-text)] underline underline-offset-2 transition-opacity hover:opacity-80'
        >
          {t('privacy_policy')}
        </Link>
        .
      </p>
    </form>
  )
}
