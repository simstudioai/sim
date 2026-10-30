import { z } from 'zod'

const NAME_PATTERN = /^[A-Za-z0-9.:@&~_-]+$/
const NAME_PUNCTUATION = /[.:@&~_-]/g
export const SIM_LINK_NAME_MAX_LENGTH = 64
export const SIM_LINK_DESCRIPTION_MAX_LENGTH = 500
const URL_MAX_LENGTH = 2048

/** List orders: alphabetical by name, or most visited first. */
export const SIM_LINK_SORTS = ['name', 'popular'] as const
export type SimLinkSort = (typeof SIM_LINK_SORTS)[number]

/** Marks where a variable link places each value typed after its name. */
export const SIM_LINK_VARIABLE = '{*}'

/** The lookup key: case and punctuation never tell two links apart, so sim/Q4-goals is sim/q4goals. */
export function normalizeSimLinkName(name: string): string {
  return name.toLowerCase().replace(NAME_PUNCTUATION, '')
}

export function isVariableSimLinkUrl(url: string): boolean {
  return url.includes(SIM_LINK_VARIABLE)
}

export function parseHttpUrl(value: string): URL | null {
  if (!URL.canParse(value)) return null
  const url = new URL(value)
  return url.protocol === 'https:' || url.protocol === 'http:' ? url : null
}

/** A scheme and authority closed by `/`, `?`, or `#`: nothing typed later can extend the host. */
const CLOSED_AUTHORITY = /^https?:\/\/[^/?#]+[/?#]/i

/**
 * The origin every visit to `url` must land on, or null when values could change it. Values fill
 * only what follows the authority, so the text before the first `{*}` must already close it.
 */
export function simLinkOrigin(url: string): string | null {
  const [prefix] = url.split(SIM_LINK_VARIABLE)
  if (isVariableSimLinkUrl(url) && !CLOSED_AUTHORITY.test(prefix)) return null
  return parseHttpUrl(url.replaceAll(SIM_LINK_VARIABLE, 'value'))?.origin ?? null
}

export const simLinkNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name')
  .max(SIM_LINK_NAME_MAX_LENGTH, `Use at most ${SIM_LINK_NAME_MAX_LENGTH} characters`)
  .regex(NAME_PATTERN, 'Use letters, numbers, and . : @ & ~ - _')
  .refine((name) => normalizeSimLinkName(name).length > 0, 'Include a letter or number')

const destinationSchema = z
  .string()
  .trim()
  .min(1, 'Enter a destination URL')
  .max(URL_MAX_LENGTH, `Use at most ${URL_MAX_LENGTH} characters`)

const simLinkUrlSchema = destinationSchema.refine(
  (url) => simLinkOrigin(url) !== null,
  `Enter a full http:// or https:// URL. ${SIM_LINK_VARIABLE} can't replace the domain.`
)

const defaultUrlSchema = destinationSchema.refine(
  (url) => !isVariableSimLinkUrl(url) && parseHttpUrl(url) !== null,
  'Enter a full http:// or https:// URL'
)

/** The editable fields of a Sim link, shared by the API contract and the editor. */
export const simLinkFieldsSchema = z
  .object({
    name: simLinkNameSchema,
    url: simLinkUrlSchema,
    defaultUrl: defaultUrlSchema.nullable(),
    description: z
      .string()
      .trim()
      .max(
        SIM_LINK_DESCRIPTION_MAX_LENGTH,
        `Use at most ${SIM_LINK_DESCRIPTION_MAX_LENGTH} characters`
      )
      .transform((value) => value || null)
      .nullable(),
    unlisted: z.boolean(),
    restrictEdit: z.boolean(),
  })
  .strict()
  .refine((fields) => !fields.defaultUrl || isVariableSimLinkUrl(fields.url), {
    path: ['defaultUrl'],
    message: `Only a link with ${SIM_LINK_VARIABLE} has a default destination`,
  })

export type SimLinkFields = z.output<typeof simLinkFieldsSchema>
