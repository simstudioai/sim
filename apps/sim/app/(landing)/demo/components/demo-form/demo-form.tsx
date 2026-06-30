'use client'

import { type ReactNode, useEffect, useId, useState } from 'react'
import { Chip, ChipDropdown, ChipInput, ChipTextarea, Label } from '@/components/emcn'
import {
  DEMO_REQUEST_COMPANY_SIZE_OPTIONS,
  type DemoRequestBody,
} from '@/lib/api/contracts/demo-requests'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { useSubmitDemoRequest } from '@/hooks/queries/demo-requests'

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
 * On a valid submit it fires the inbound-demo notification to sales (via
 * {@link useSubmitDemoRequest}, best-effort - never blocking) and composes a
 * {@link DemoLead} (name, email, and a notes summary) handed to `onComplete`,
 * which advances the card to the scheduler.
 */
export function DemoForm({ onComplete }: DemoFormProps) {
  const submitDemoRequest = useSubmitDemoRequest()
  const [form, setForm] = useState<DemoFormState>(INITIAL_STATE)

  const setField = (key: keyof DemoFormState) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }))

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
  const emailIsValid = trimmedEmail.length > 0 && quickValidateEmail(trimmedEmail).isValid
  const canSubmit =
    emailIsValid &&
    form.firstName.trim().length > 0 &&
    form.lastName.trim().length > 0 &&
    form.company.trim().length > 0 &&
    form.companySize.length > 0

  /**
   * Only surface a format error once the value looks like an address attempt
   * (contains `@`) so the field doesn't flash an error on the first keystroke.
   */
  const emailError =
    form.email.includes('@') && !emailIsValid ? 'Enter a valid work email address.' : undefined

  const handleSubmit = () => {
    if (!canSubmit) return

    // Notify sales of the inbound demo (route emails the sales inbox, replying to
    // the visitor - no email is sent to the visitor). Fire-and-forget so a failed
    // or rate-limited notification never blocks the visitor from scheduling; the
    // company-size value originates from the contract's own options, so it is a
    // valid payload value.
    submitDemoRequest.mutate({
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      companyEmail: trimmedEmail,
      phoneNumber: form.phone.trim() || undefined,
      companySize: form.companySize as DemoRequestBody['companySize'],
      details: buildDetails(form),
    })

    onComplete({
      name: `${form.firstName} ${form.lastName}`.trim(),
      email: trimmedEmail,
      notes: buildNotes(form),
    })
  }

  return (
    <>
      <h2 id='demo-form-heading' className='text-[var(--text-primary)] text-xl leading-[1.2]'>
        Book a demo now
      </h2>
      <p className='mt-1.5 text-[var(--text-muted)] text-sm'>
        Tell us about your team and we'll tailor your demo to what you're building.
      </p>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          handleSubmit()
        }}
        aria-labelledby='demo-form-heading'
        className='mt-5 flex flex-col gap-4'
        noValidate
      >
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
            flush
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
            flush
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
        <Chip
          type='submit'
          variant='primary'
          flush
          fullWidth
          disabled={!canSubmit}
          className='mt-1 justify-center [&>span]:flex-none'
        >
          Continue
        </Chip>
      </form>
    </>
  )
}
