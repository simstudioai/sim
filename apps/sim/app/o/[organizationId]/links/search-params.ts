import { createSerializer, parseAsString } from 'nuqs/server'
import { organizationPageParsers } from '@/app/o/[organizationId]/components/organization-page/search-params'

/** `create` opens the new-link editor, prefilled with its value as the name. */
export const simLinkViewParsers = { create: parseAsString } as const

export const serializeSimLinkView = createSerializer({
  ...organizationPageParsers,
  ...simLinkViewParsers,
})
