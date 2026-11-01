import {
  SIM_LINK_SUGGESTIONS_PATH,
  simLinkSuggestionsSchema,
} from '@sim/browser-extension-protocol'
import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'
import { SIM_LINK_SORTS, simLinkFieldsSchema } from '@/lib/sim-links/validation'
import { SORT_DIRECTIONS } from '@/lib/url-state'

const params = z.object({ id: organizationIdSchema })
const linkParams = params.extend({ linkId: z.string().min(1).max(255) })

const simLinkSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  defaultUrl: z.string().nullable(),
  description: z.string().nullable(),
  unlisted: z.boolean(),
  restrictEdit: z.boolean(),
  /** Redirects through this link, for the most-used order. */
  visitCount: z.number().int().nonnegative(),
  createdBy: z
    .object({ id: z.string(), name: z.string(), image: z.string().nullable() })
    .nullable(),
  updatedAt: z.iso.datetime(),
  /** The viewer may change the name, destination, and description, or delete the link. */
  canEdit: z.boolean(),
  /** The viewer may also unlist the link or restrict who edits it. */
  canManage: z.boolean(),
})
export type SimLink = z.output<typeof simLinkSchema>
export type SimLinkBody = z.input<typeof simLinkFieldsSchema>

const linkResponse = z.object({ link: simLinkSchema })

export const listSimLinksContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/sim-links',
  params,
  query: z
    .object({
      search: z.string().max(200).optional(),
      cursor: z.string().min(1).max(128).optional(),
      sort: z.enum(SIM_LINK_SORTS).optional(),
      dir: z.enum(SORT_DIRECTIONS).optional(),
    })
    .refine((query) => !(query.sort === 'popular' && query.cursor), {
      path: ['cursor'],
      message: 'The most-used view is a single page',
    }),
  response: {
    mode: 'json',
    schema: z.object({ links: z.array(simLinkSchema), nextCursor: z.string().nullable() }),
  },
})

export const createSimLinkContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/sim-links',
  params,
  body: simLinkFieldsSchema,
  response: { mode: 'json', schema: linkResponse },
})

export const updateSimLinkContract = defineRouteContract({
  method: 'PUT',
  path: '/api/organizations/[id]/sim-links/[linkId]',
  params: linkParams,
  body: simLinkFieldsSchema,
  response: { mode: 'json', schema: linkResponse },
})

export const deleteSimLinkContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/organizations/[id]/sim-links/[linkId]',
  params: linkParams,
  response: { mode: 'json', schema: z.object({ success: z.literal(true) }) },
})

/** The browser extension's address-bar suggestions, from the organization `sim/` opens in. */
export const suggestSimLinksContract = defineRouteContract({
  method: 'GET',
  path: SIM_LINK_SUGGESTIONS_PATH,
  query: z.object({ q: z.string().max(200).default('') }),
  response: { mode: 'json', schema: simLinkSuggestionsSchema },
})
