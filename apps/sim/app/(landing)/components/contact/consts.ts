import { z } from 'zod'
import { NO_EMAIL_HEADER_CONTROL_CHARS_REGEX } from '@/lib/messaging/email/utils'
import { quickValidateEmail } from '@/lib/messaging/email/validation'

export const CONTACT_TOPIC_VALUES = [
  'general',
  'support',
  'integration',
  'feature_request',
  'sales',
  'partnership',
  'billing',
  'other',
] as const

export const CONTACT_TOPIC_OPTIONS = [
  { value: 'general', label: 'General question' },
  { value: 'support', label: 'Technical support' },
  { value: 'integration', label: 'Integration request' },
  { value: 'feature_request', label: 'Feature request' },
  { value: 'sales', label: 'Sales & pricing' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'billing', label: 'Billing' },
  { value: 'other', label: 'Other' },
] as const

export const contactRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(120, 'Name must be 120 characters or less')
    .regex(NO_EMAIL_HEADER_CONTROL_CHARS_REGEX, 'Invalid characters'),
  email: z
    .string()
    .trim()
    .min(1, 'Email is required')
    .max(320)
    .transform((value) => value.toLowerCase())
    .refine((value) => quickValidateEmail(value).isValid, 'Enter a valid email'),
  company: z
    .string()
    .trim()
    .max(120, 'Company must be 120 characters or less')
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  topic: z.enum(CONTACT_TOPIC_VALUES, {
    errorMap: () => ({ message: 'Please select a topic' }),
  }),
  subject: z
    .string()
    .trim()
    .min(1, 'Subject is required')
    .max(200, 'Subject must be 200 characters or less')
    .regex(NO_EMAIL_HEADER_CONTROL_CHARS_REGEX, 'Invalid characters'),
  message: z
    .string()
    .trim()
    .min(1, 'Message is required')
    .max(5000, 'Message must be 5,000 characters or less'),
})

export type ContactRequestPayload = z.infer<typeof contactRequestSchema>

export function getContactTopicLabel(value: ContactRequestPayload['topic']): string {
  return CONTACT_TOPIC_OPTIONS.find((option) => option.value === value)?.label ?? value
}

export type HelpEmailType = 'bug' | 'feedback' | 'feature_request' | 'other'

export function mapContactTopicToHelpType(topic: ContactRequestPayload['topic']): HelpEmailType {
  switch (topic) {
    case 'feature_request':
      return 'feature_request'
    case 'support':
      return 'bug'
    case 'integration':
      return 'feedback'
    default:
      return 'other'
  }
}
