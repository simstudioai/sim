import { createSerializer, parseAsString } from 'nuqs/server'

/** `create` opens the new-link editor, prefilled with its value as the name. */
export const simLinkViewParsers = { create: parseAsString } as const

export const serializeSimLinkView = createSerializer(simLinkViewParsers)
