import freeEmailDomains from 'free-email-domains'
import { z } from 'zod'
import { NO_EMAIL_HEADER_CONTROL_CHARS_REGEX } from '@/lib/messaging/email/utils'
import { quickValidateEmail } from '@/lib/messaging/email/validation'

const FREE_EMAIL_DOMAINS = new Set(freeEmailDomains)

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
    .refine((value) => {
      const domain = value.split('@')[1]
      return domain ? !FREE_EMAIL_DOMAINS.has(domain) : true
    }, 'Please use your work email address'),
  phoneNumber: z
    .string()
    .trim()
    .max(50, 'Phone number must be 50 characters or less')
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  companySize: z.enum(DEMO_REQUEST_COMPANY_SIZE_VALUES, {
    errorMap: () => ({ message: 'Please select company size' }),
  }),
  details: z.string().trim().min(1, 'Details are required').max(2000),
})

export type DemoRequestPayload = z.infer<typeof demoRequestSchema>

export function getDemoRequestCompanySizeLabel(value: DemoRequestPayload['companySize']): string {
  return DEMO_REQUEST_COMPANY_SIZE_OPTIONS.find((option) => option.value === value)?.label ?? value
}
