import { z } from 'zod'

/** SES `MessageTag` name or value: 1-256 letters, digits, underscores, or hyphens. */
const sesMessageTagPartSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,256}$/, 'Tag names and values may contain only letters, digits, _ and -')

/** Message tags on an SES send, for filtering its sending events. */
export const sesEmailTagsSchema = z
  .array(z.object({ name: sesMessageTagPartSchema, value: sesMessageTagPartSchema }))
  .nullish()
