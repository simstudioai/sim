import { z } from 'zod'
import { NO_EMAIL_HEADER_CONTROL_CHARS_REGEX } from '@/lib/messaging/email/utils'
import { quickValidateEmail } from '@/lib/messaging/email/validation'

export const DEMO_REQUEST_REGION_VALUES = [
  'north_america',
  'europe',
  'asia_pacific',
  'latin_america',
  'middle_east_africa',
  'other',
] as const

export const DEMO_REQUEST_USER_COUNT_VALUES = [
  '1_10',
  '11_50',
  '51_200',
  '201_500',
  '501_1000',
  '1000_plus',
] as const

export const DEMO_REQUEST_REGION_OPTIONS = [
  { value: 'north_america', label: 'North America' },
  { value: 'europe', label: 'Europe' },
  { value: 'asia_pacific', label: 'Asia Pacific' },
  { value: 'latin_america', label: 'Latin America' },
  { value: 'middle_east_africa', label: 'Middle East & Africa' },
  { value: 'other', label: 'Other' },
] as const

export const DEMO_REQUEST_USER_COUNT_OPTIONS = [
  { value: '1_10', label: '1-10' },
  { value: '11_50', label: '11-50' },
  { value: '51_200', label: '51-200' },
  { value: '201_500', label: '201-500' },
  { value: '501_1000', label: '501-1,000' },
  { value: '1000_plus', label: '1,000+' },
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
    .refine((value) => quickValidateEmail(value).isValid, 'Enter a valid work email'),
  phoneNumber: z
    .string()
    .trim()
    .max(50, 'Phone number must be 50 characters or less')
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  region: z.enum(DEMO_REQUEST_REGION_VALUES, {
    errorMap: () => ({ message: 'Please select a region' }),
  }),
  userCount: z.enum(DEMO_REQUEST_USER_COUNT_VALUES, {
    errorMap: () => ({ message: 'Please select the number of users' }),
  }),
  details: z.string().trim().min(1, 'Details are required').max(2000),
})

export type DemoRequestPayload = z.infer<typeof demoRequestSchema>

export function getDemoRequestRegionLabel(value: DemoRequestPayload['region']): string {
  return DEMO_REQUEST_REGION_OPTIONS.find((option) => option.value === value)?.label ?? value
}

export function getDemoRequestUserCountLabel(value: DemoRequestPayload['userCount']): string {
  return DEMO_REQUEST_USER_COUNT_OPTIONS.find((option) => option.value === value)?.label ?? value
}
