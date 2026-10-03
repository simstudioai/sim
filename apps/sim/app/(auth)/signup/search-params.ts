import { createSearchParamsCache, parseAsString } from 'nuqs/server'

/**
 * The redirect signals the signup page carries. Read once to decide where a
 * visitor goes after authenticating, never written, so every parser is nullable
 * with no default — absent means "no destination", which is a real state rather
 * than something to fall back from.
 */
const signupParsers = {
  redirect: parseAsString,
  callbackUrl: parseAsString,
  inviteFlow: parseAsString,
} as const

/** `invite_flow` on the wire; camelCase for destructuring. */
const signupUrlKeys = { urlKeys: { inviteFlow: 'invite_flow' } } as const

/**
 * Server-side reader for the signup page. The client form reads these same keys
 * through `useSearchParams` (the read-once auth-signal carve-out), so the wire
 * keys here and in `signup-form.tsx` must stay in step.
 */
export const signupSearchParamsCache = createSearchParamsCache(signupParsers, signupUrlKeys)
