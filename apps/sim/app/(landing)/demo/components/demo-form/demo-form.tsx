'use client'

import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'
import { Chip, ChipDropdown, ChipInput, ChipTextarea, Label } from '@sim/emcn'
import { toError } from '@sim/utils/errors'
import {
  DEMO_REQUEST_COMPANY_SIZE_OPTIONS,
  type DemoRequestBody,
} from '@/lib/api/contracts/demo-requests'
import { getEnv } from '@/lib/core/config/env'
import { isFreeEmailDomain } from '@/lib/messaging/email/free-email'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { useSubmitDemoRequest } from '@/hooks/queries/demo-requests'

/** Build-time-inlined Turnstile site key; absent when captcha isn't configured. */
const TURNSTILE_SITE_KEY = getEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY')

/**
 * How long Continue waits on the invisible challenge before sending the request
 * without a token. An interactive challenge cannot be shown in the hidden
 * widget, so waiting longer only delays the calendar; the server then marks the
 * request unverified and the booking goes to manual review.
 */
const CAPTCHA_WAIT_MS = 5_000

/** Options for the "What can we help you with?" select; the first is the default. */
const TOPIC_OPTIONS = [
  { value: 'demo', label: 'Book a demo' },
  { value: 'other', label: 'Other' },
] as const

/**
 * Field control height - slightly taller than the 30px in-app chip default and
 * just under the 36px auth field, so the booking form reads as a roomy landing
 * surface. Applied to each control's `className`, the sanctioned way to own only
 * a chip field's height (mirrors `AuthInput`).
 */
const FIELD_HEIGHT = 'h-[34px]'

/**
 * The form's working state. On submit it maps onto the `demo-requests` contract
 * payload (the sales notification) and the {@link DemoLead} handed to the
 * scheduler - kept as one object so both mappings read from a single source.
 */
interface DemoFormState {
  firstName: string
  lastName: string
  email: string
  phone: string
  company: string
  companySize: string
  topic: string
  message: string
}

const INITIAL_STATE: DemoFormState = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  company: '',
  companySize: '',
  topic: TOPIC_OPTIONS[0].value,
  message: '',
}

/** The captured lead handed to the Cal.com scheduler to prefill the booking. */
export interface DemoLead {
  /** Full name - `${firstName} ${lastName}`. */
  name: string
  /** Work email. */
  email: string
  /** A readable summary of the company/role/topic, shown on the booking. */
  notes: string
}

interface DemoFormProps {
  /** Called with the captured {@link DemoLead} when a valid form is submitted. */
  onComplete: (lead: DemoLead) => void
}

/** Resolve an option's display label from its value, falling back to the value. */
const labelFor = (options: ReadonlyArray<{ value: string; label: string }>, value: string) =>
  options.find((option) => option.value === value)?.label ?? value

/** Compose the booking notes from the structured fields, skipping empty optionals. */
function buildNotes(form: DemoFormState): string {
  return [
    `Company: ${form.company}`,
    `Company size: ${labelFor(DEMO_REQUEST_COMPANY_SIZE_OPTIONS, form.companySize)}`,
    form.phone && `Phone: ${form.phone}`,
    `Topic: ${labelFor(TOPIC_OPTIONS, form.topic)}`,
    form.message && `Notes: ${form.message}`,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Compose the sales-notification `details` from the free-form fields the typed
 * payload doesn't carry on its own - the company name, the topic, and any
 * message. Always non-empty (company and topic are required), satisfying the
 * contract's `details` minimum.
 */
function buildDetails(form: DemoFormState): string {
  return [
    `Company: ${form.company}`,
    `Topic: ${labelFor(TOPIC_OPTIONS, form.topic)}`,
    form.message && `\nNotes:\n${form.message}`,
  ]
    .filter(Boolean)
    .join('\n')
}

interface DemoFieldProps {
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
 * that can't take a label `id` (the dropdowns) become a `role='group'` named by
 * the label instead, so every field has an accessible name.
 */
function DemoField({ label, htmlFor, required, error, children }: DemoFieldProps) {
  const labelId = useId()
  const isGroup = htmlFor === undefined
  return (
    <div
      className='flex flex-col gap-[9px]'
      role={isGroup ? 'group' : undefined}
      aria-labelledby={isGroup ? labelId : undefined}
    >
      <Label
        id={labelId}
        htmlFor={htmlFor}
        className='pl-0.5 font-normal text-[var(--text-secondary)]'
      >
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
 * Step 1 of the booking card - the demo-request form. Rendered inside the card
 * chrome owned by {@link DemoBooking}, so it returns just its heading and fields.
 *
 * Fields are hand-composed at the slightly-taller {@link FIELD_HEIGHT} (the
 * sanctioned standalone-field pattern - `Label` + a height-raised chip control),
 * stacked at the platform `gap-4` rhythm with no divider lines. Optional fields
 * carry an `(optional)` suffix; the "What can we help you with?" select defaults
 * to its first option ("Book a demo"); every other field is required. The email
 * runs through {@link quickValidateEmail}, its error surfaces only once the value
 * looks like an address attempt, and the primary {@link Chip} stays disabled until
 * every required field is valid.
 *
 * On a valid submit it sends the demo request (via {@link useSubmitDemoRequest})
 * with an invisible Turnstile token and a honeypot `website` field, and only
 * once the server has recorded it hands a {@link DemoLead} (name, email, and a
 * notes summary) to `onComplete`, which advances the card to the scheduler. The
 * record decides whether the booking is confirmed automatically or reviewed by
 * hand, so the calendar never opens before it exists. A failed request keeps the
 * form open with an inline error.
 */
export function DemoForm({ onComplete }: DemoFormProps) {
  const submitDemoRequest = useSubmitDemoRequest()
  const [form, setForm] = useState<DemoFormState>(INITIAL_STATE)
  const [website, setWebsite] = useState('')
  /** Turnstile mounts on first focus, like the scheduler preload, so its script never competes with page load. */
  const [captchaArmed, setCaptchaArmed] = useState(false)
  const turnstileRef = useRef<TurnstileInstance>(null)
  const widgetLoadedRef = useRef(false)

  const setField = (key: keyof DemoFormState) => (value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (submitDemoRequest.isError) submitDemoRequest.reset()
  }

  /**
   * Prefill the email from the `?email=` param the landing hero's CTA forwards
   * (its "Book a demo" GET form). Read once on mount from `window.location` -
   * not `useSearchParams` - so the page stays statically rendered with no
   * Suspense bailout; server and first client render are both empty, so there is
   * no hydration mismatch. Only seeds when the field is still untouched.
   */
  useEffect(() => {
    const prefill = new URLSearchParams(window.location.search).get('email')?.trim()
    if (prefill) setForm((prev) => (prev.email ? prev : { ...prev, email: prefill }))
  }, [])

  const trimmedEmail = form.email.trim()
  const emailFormatValid = trimmedEmail.length > 0 && quickValidateEmail(trimmedEmail).isValid
  const emailIsFreeDomain = isFreeEmailDomain(trimmedEmail)
  const emailIsValid = emailFormatValid && !emailIsFreeDomain
  const canSubmit =
    emailIsValid &&
    form.firstName.trim().length > 0 &&
    form.lastName.trim().length > 0 &&
    form.company.trim().length > 0 &&
    form.companySize.length > 0

  /**
   * Surface an error only once the value looks like an address attempt (contains
   * `@`) so the field doesn't flash on the first keystroke, and distinguish a
   * malformed address from a personal one so the visitor knows to switch to a
   * work email — matching the server's work-email requirement.
   */
  const emailError = !form.email.includes('@')
    ? undefined
    : !emailFormatValid
      ? 'Enter a valid work email address.'
      : emailIsFreeDomain
        ? 'Please use your work email address.'
        : undefined

  /**
   * Runs the invisible challenge, falling back to no token when the widget never
   * loaded or does not answer; the server then treats the request as unverified
   * rather than rejecting it.
   */
  const solveCaptcha = async (): Promise<string | undefined> => {
    const widget = turnstileRef.current
    if (!TURNSTILE_SITE_KEY || !widgetLoadedRef.current || !widget) return undefined
    try {
      widget.reset()
      widget.execute()
      return await widget.getResponsePromise(CAPTCHA_WAIT_MS)
    } catch {
      return undefined
    }
  }

  const [isSolvingCaptcha, setIsSolvingCaptcha] = useState(false)
  const isSubmitting = isSolvingCaptcha || submitDemoRequest.isPending
  const submitError = submitDemoRequest.isError
    ? toError(submitDemoRequest.error).message || 'Something went wrong. Please try again.'
    : null

  const handleSubmit = async () => {
    if (!canSubmit || isSubmitting) return

    const request: DemoRequestBody = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      companyEmail: trimmedEmail,
      phoneNumber: form.phone.trim() || undefined,
      companySize: form.companySize as DemoRequestBody['companySize'],
      details: buildDetails(form),
      website,
    }

    const lead: DemoLead = {
      name: `${form.firstName} ${form.lastName}`.trim(),
      email: trimmedEmail,
      notes: buildNotes(form),
    }

    setIsSolvingCaptcha(true)
    const captchaToken = await solveCaptcha()
    setIsSolvingCaptcha(false)

    submitDemoRequest.mutate({ ...request, captchaToken }, { onSuccess: () => onComplete(lead) })
  }

  return (
    <>
      <h2 id='demo-form-heading' className='text-[var(--text-primary)] text-xl leading-[1.2]'>
        Book a demo now
      </h2>
      <p className='mt-1.5 text-[var(--text-secondary)] text-sm'>
        Tell us about your team and we'll tailor your demo to what you're building.
      </p>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void handleSubmit()
        }}
        aria-labelledby='demo-form-heading'
        className='relative mt-5 flex flex-col gap-4'
        noValidate
        onFocusCapture={() => setCaptchaArmed(true)}
      >
        {/* Out of flow, so neither control adds a row or a gap to the pinned card height. */}
        <div
          aria-hidden='true'
          className='pointer-events-none absolute left-[-9999px] size-px overflow-hidden opacity-0'
        >
          <label htmlFor='demo-website'>Website</label>
          <input
            id='demo-website'
            name='website'
            type='text'
            tabIndex={-1}
            autoComplete='off'
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            data-lpignore='true'
            data-1p-ignore='true'
          />
          {TURNSTILE_SITE_KEY && captchaArmed ? (
            <Turnstile
              ref={turnstileRef}
              siteKey={TURNSTILE_SITE_KEY}
              options={{ execution: 'execute', appearance: 'execute', size: 'invisible' }}
              onWidgetLoad={() => {
                widgetLoadedRef.current = true
              }}
              onError={() => {
                widgetLoadedRef.current = false
              }}
              onUnsupported={() => {
                widgetLoadedRef.current = false
              }}
            />
          ) : null}
        </div>
        <div className='grid grid-cols-2 gap-3 max-sm:grid-cols-1'>
          <DemoField label='First name' htmlFor='demo-first-name' required>
            <ChipInput
              id='demo-first-name'
              className={FIELD_HEIGHT}
              value={form.firstName}
              onChange={(event) => setField('firstName')(event.target.value)}
              placeholder='Jane'
              autoComplete='given-name'
            />
          </DemoField>
          <DemoField label='Last name' htmlFor='demo-last-name' required>
            <ChipInput
              id='demo-last-name'
              className={FIELD_HEIGHT}
              value={form.lastName}
              onChange={(event) => setField('lastName')(event.target.value)}
              placeholder='Doe'
              autoComplete='family-name'
            />
          </DemoField>
        </div>

        <DemoField label='Work email' htmlFor='demo-email' required error={emailError}>
          <ChipInput
            id='demo-email'
            type='email'
            className={FIELD_HEIGHT}
            value={form.email}
            onChange={(event) => setField('email')(event.target.value)}
            error={Boolean(emailError)}
            placeholder='jane@acme.co'
            autoComplete='email'
          />
        </DemoField>

        <DemoField label='Phone number (optional)' htmlFor='demo-phone'>
          <ChipInput
            id='demo-phone'
            type='tel'
            className={FIELD_HEIGHT}
            value={form.phone}
            onChange={(event) => setField('phone')(event.target.value)}
            placeholder='+1 (555) 000-0000'
            autoComplete='tel'
          />
        </DemoField>

        <DemoField label='Company' htmlFor='demo-company' required>
          <ChipInput
            id='demo-company'
            className={FIELD_HEIGHT}
            value={form.company}
            onChange={(event) => setField('company')(event.target.value)}
            placeholder='Acme Inc.'
            autoComplete='organization'
          />
        </DemoField>

        <DemoField label='Company size' required>
          <ChipDropdown
            fullWidth
            className={FIELD_HEIGHT}
            value={form.companySize || undefined}
            onChange={setField('companySize')}
            options={DEMO_REQUEST_COMPANY_SIZE_OPTIONS}
            placeholder='Select one'
          />
        </DemoField>

        <DemoField label='What can we help you with?'>
          <ChipDropdown
            fullWidth
            className={FIELD_HEIGHT}
            value={form.topic}
            onChange={setField('topic')}
            options={TOPIC_OPTIONS}
          />
        </DemoField>

        <DemoField label='Anything else we should know? (optional)' htmlFor='demo-message'>
          <ChipTextarea
            id='demo-message'
            value={form.message}
            onChange={(event) => setField('message')(event.target.value)}
            placeholder='What are you hoping to build with Sim?'
            rows={3}
          />
        </DemoField>

        {/*
          `Chip` gives its label span `flex-1`; under `fullWidth` that left-aligns the
          label, so center it with `justify-center` + a `flex-none` span override.
        */}
        {submitError ? (
          <p role='alert' className='text-[var(--text-error)] text-caption'>
            {submitError}
          </p>
        ) : null}

        <Chip
          type='submit'
          variant='primary'
          fullWidth
          disabled={!canSubmit || isSubmitting}
          className='mt-1 justify-center [&>span]:flex-none'
        >
          {isSubmitting ? 'Continuing…' : 'Continue'}
        </Chip>
      </form>
    </>
  )
}
