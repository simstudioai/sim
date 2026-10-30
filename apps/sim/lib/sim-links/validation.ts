import { z } from 'zod'

const NAME_PATTERN = /^[A-Za-z0-9.:@&~_-]+$/
const NAME_PUNCTUATION = /[.:@&~_-]/g
export const SIM_LINK_NAME_MAX_LENGTH = 64
export const SIM_LINK_DESCRIPTION_MAX_LENGTH = 500
const URL_MAX_LENGTH = 2048

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

/** Values may fill a destination's path, query, or fragment, never its origin. */
function hasFixedHttpOrigin(url: string): boolean {
  const first = parseHttpUrl(url.replaceAll(SIM_LINK_VARIABLE, 'a'))
  const second = parseHttpUrl(url.replaceAll(SIM_LINK_VARIABLE, 'b'))
  return Boolean(first && second && first.origin === second.origin)
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

export const simLinkUrlSchema = destinationSchema.refine(
  hasFixedHttpOrigin,
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
