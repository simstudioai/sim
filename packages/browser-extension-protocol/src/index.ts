import { z } from 'zod'

export const PAGE_SNAPSHOT_MAX_TEXT_LENGTH = 50_000
export const PAGE_SNAPSHOT_MAX_BYTES = 150_000

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

const extensionActionSchema = z.enum(['capture-page', 'capture-selection', 'site-access'])
export type ExtensionAction = z.infer<typeof extensionActionSchema>

export const appToExtensionMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...envelope, type: z.literal('theme'), theme: z.enum(['light', 'dark']) }),
  z.strictObject({ ...envelope, type: z.literal('ready'), sessionId: z.uuid() }),
  z.strictObject({ ...envelope, type: z.literal('unavailable'), sessionId: z.uuid() }),
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
  z.strictObject({ ...envelope, type: z.literal('connected'), sessionId: z.uuid() }),
  z.strictObject({
    ...envelope,
    type: z.literal('context'),
    sessionId: z.uuid(),
    snapshot: pageSnapshotSchema,
  }),
])
export type ExtensionToAppMessage = z.infer<typeof extensionToAppMessageSchema>

/** Where the extension asks for the address-bar suggestions behind its `sim` keyword. */
export const SIM_LINK_SUGGESTIONS_PATH = '/api/sim-links/suggestions'

/** Listed Sim links whose name starts with what was typed, most visited first. */
export const simLinkSuggestionsSchema = z.strictObject({
  links: z.array(
    z.strictObject({ name: z.string(), description: z.string().nullable(), url: z.string() })
  ),
})
