import { z } from 'zod'

/** Keeps a connection card's create/reconnect intent intact through provider authorization. */
export const credentialGroupConnectionIntentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create') }).strict(),
  z.object({ kind: z.literal('reconnect'), credentialId: z.string().min(1).max(128) }).strict(),
])
export type CredentialGroupConnectionIntent = z.infer<typeof credentialGroupConnectionIntentSchema>
