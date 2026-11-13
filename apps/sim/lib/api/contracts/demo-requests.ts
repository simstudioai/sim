import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { isFreeEmailDomain } from '@/lib/messaging/email/free-email'
import { NO_EMAIL_HEADER_CONTROL_CHARS_REGEX } from '@/lib/messaging/email/utils'
import { quickValidateEmail } from '@/lib/messaging/email/validation'

export const DEMO_REQUEST_COMPANY_SIZE_VALUES = [
  '1_10',
  '11_50',
  '51_200',
  '201_500',
  '501_1000',
  '1001_10000',
  '10000_plus',
] as const

export const DEMO_REQUEST_COMPANY_SIZE_OPTIONS = [
  { value: '1_10', label: '1–10' },
  { value: '11_50', label: '11–50' },
  { value: '51_200', label: '51–200' },
  { value: '201_500', label: '201–500' },
  { value: '501_1000', label: '501–1,000' },
  { value: '1001_10000', label: '1,001–10,000' },
  { value: '10000_plus', label: '10,000+' },
] as const

export const demoRequestSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, 'First name is required')
    .max(100)
    .regex(NO_EMAIL_HEADER_CONTROL_CHARS_REGEX, 'Invalid characters'),
  lastName: z
    .string()
    .trim()
    .min(1, 'Last name is required')
    .max(100)
    .regex(NO_EMAIL_HEADER_CONTROL_CHARS_REGEX, 'Invalid characters'),
  companyEmail: z
    .string()
    .trim()
    .min(1, 'Company email is required')
    .max(320)
    .transform((value) => value.toLowerCase())
    .refine((value) => quickValidateEmail(value).isValid, 'Enter a valid work email')
    .refine((value) => !isFreeEmailDomain(value), 'Please use your work email address'),
  phoneNumber: z
    .string()
    .trim()
    .max(50, 'Phone number must be 50 characters or less')
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  companySize: z.enum(DEMO_REQUEST_COMPANY_SIZE_VALUES, {
    error: 'Please select company size',
  }),
  details: z.string().trim().min(1, 'Details are required').max(2000),
  /** Honeypot: hidden from people, so any value marks the submission as automated. */
  website: z.string().optional(),
  captchaToken: z.string().optional(),
})

export type DemoRequestPayload = z.infer<typeof demoRequestSchema>
export type DemoRequestBody = z.input<typeof demoRequestSchema>

export function getDemoRequestCompanySizeLabel(value: DemoRequestPayload['companySize']): string {
  return DEMO_REQUEST_COMPANY_SIZE_OPTIONS.find((option) => option.value === value)?.label ?? value
}

export const demoRequestResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
})

export type DemoRequestResult = z.output<typeof demoRequestResponseSchema>

export const submitDemoRequestContract = defineRouteContract({
  method: 'POST',
  path: '/api/demo-requests',
  body: demoRequestSchema,
  response: {
    mode: 'json',
    schema: demoRequestResponseSchema,
  },
})

/**
 * The envelope of a Cal.com webhook delivery. Only `BOOKING_REQUESTED` carries a
 * booking to review; every other trigger, including the dashboard's test ping,
 * is acknowledged and ignored.
 */
export const calWebhookEnvelopeSchema = z.object({
  triggerEvent: z.string(),
  payload: z.unknown().optional(),
})

/** The fields of a requested booking that the demo booking review reads. */
export const calBookingRequestSchema = z.object({
  uid: z.string().min(1),
  attendees: z.array(z.object({ email: z.string().min(1) })).min(1),
})

/**
 * The Cal.com webhook for the demo event. Cal.com is the only caller, so no
 * client reads this contract; it declares the shapes the route accepts and
 * answers. The route reads the raw body itself, because the signature covers
 * the exact bytes Cal.com sent.
 */
export const calBookingWebhookContract = defineRouteContract({
  method: 'POST',
  path: '/api/demo-requests/bookings',
  body: calWebhookEnvelopeSchema,
  response: {
    mode: 'json',
    schema: z.object({
      ok: z.literal(true),
      decision: z.enum(['confirmed', 'declined', 'pending']).optional(),
    }),
  },
})
