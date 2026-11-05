import { z } from 'zod'

export const PAGE_SNAPSHOT_MAX_TEXT_LENGTH = 50_000
export const PAGE_SNAPSHOT_MAX_BYTES = 150_000
export const PAGE_REFERENCE_TIMEOUT_MS = 10_000

const pageUrlSchema = z
  .string()
  .max(4_096)
  .refine((value) => {
    try {
      const url = new URL(value)
      return (
        (url.protocol === 'https:' || url.protocol === 'http:') &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      )
    } catch {
      return false
    }
  }, 'Expected a web page URL without credentials, query parameters, or fragments')

/** Immutable, explicitly captured page text crossing the extension/app/server boundary. */
export const pageSnapshotSchema = z
  .strictObject({
    id: z.uuid(),
    url: pageUrlSchema,
    title: z.string().max(512),
    text: z.string().min(1).max(PAGE_SNAPSHOT_MAX_TEXT_LENGTH),
    capturedAt: z.iso.datetime(),
    kind: z.enum(['page', 'selection']),
    truncated: z.boolean(),
  })
  .refine(
    (snapshot) =>
      new TextEncoder().encode(JSON.stringify(snapshot)).byteLength <= PAGE_SNAPSHOT_MAX_BYTES,
    'Page snapshot exceeds its byte budget'
  )

export type PageSnapshot = z.infer<typeof pageSnapshotSchema>

const envelope = { channel: z.literal('sim-extension'), version: z.literal(1) }

const extensionActionSchema = z.enum([
  'capture-page',
  'capture-selection',
  'site-access',
  'microphone-settings',
])
export type ExtensionAction = z.infer<typeof extensionActionSchema>

export const appToExtensionMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...envelope, type: z.literal('theme'), theme: z.enum(['light', 'dark']) }),
  z.strictObject({ ...envelope, type: z.literal('signed-in') }),
  z.strictObject({ ...envelope, type: z.literal('ready'), sessionId: z.uuid() }),
  z.strictObject({ ...envelope, type: z.literal('composer-focused'), sessionId: z.uuid() }),
  z.strictObject({ ...envelope, type: z.literal('unavailable'), sessionId: z.uuid() }),
  z.strictObject({
    ...envelope,
    type: z.literal('set-reference-preference'),
    sessionId: z.uuid(),
    enabled: z.boolean(),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('capture-for-send'),
    sessionId: z.uuid(),
    requestId: z.uuid(),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('action'),
    sessionId: z.uuid(),
    action: extensionActionSchema,
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('context-received'),
    sessionId: z.uuid(),
    snapshotId: z.uuid(),
  }),
])
export type AppToExtensionMessage = z.infer<typeof appToExtensionMessageSchema>

export const extensionToAppMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...envelope, type: z.literal('focus-composer'), sessionId: z.uuid() }),
  z.strictObject({ ...envelope, type: z.literal('connected'), sessionId: z.uuid() }),
  z.strictObject({
    ...envelope,
    type: z.literal('reference-preference'),
    sessionId: z.uuid(),
    enabled: z.boolean(),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('send-context'),
    sessionId: z.uuid(),
    requestId: z.uuid(),
    snapshot: pageSnapshotSchema,
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('send-context-error'),
    sessionId: z.uuid(),
    requestId: z.uuid(),
    message: z.string().min(1).max(240),
    reason: z.enum(['site-access', 'selection']).optional(),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('context'),
    sessionId: z.uuid(),
    snapshot: pageSnapshotSchema,
  }),
])
export type ExtensionToAppMessage = z.infer<typeof extensionToAppMessageSchema>

/** The longest Sim link name; the extension asks about nothing longer. */
export const SIM_LINK_NAME_MAX_LENGTH = 64

/** Destination limit shared by editable drafts and saved Sim links. */
export const SIM_LINK_URL_MAX_LENGTH = 2048

/** Short hosts a link opens from: `sim/<name>` and `go/<name>`. */
export const SIM_LINK_HOSTS = ['sim', 'go'] as const

export const SIM_LINK_HOST_PATTERN = SIM_LINK_HOSTS.join('|')

/** Where the extension asks for the address-bar suggestions behind its `sim` keyword. */
export const SIM_LINK_SUGGESTIONS_PATH = '/api/sim-links/suggestions'

/**
 * Listed Sim links matching what was typed, and whether links are on at all for this session. Not
 * strict: an installed extension lags the server, so a field added later must not break its parse.
 */
export const simLinkSuggestionsSchema = z.object({
  enabled: z.boolean().optional(),
  links: z.array(
    z.object({ name: z.string(), description: z.string().nullable(), url: z.string() })
  ),
})

export const SIM_LINK_DRAFT_PATH = '/extension/create-link'

/** A proposed link is editable before saving. Never pass URL secrets into the draft handoff. */
export function simLinkDraftDestination(value: string): string | null {
  if (!value || value.length > 4096) return null
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    url.search = ''
    url.hash = ''
    return url.href.length <= SIM_LINK_URL_MAX_LENGTH ? url.href : null
  } catch {
    return null
  }
}
