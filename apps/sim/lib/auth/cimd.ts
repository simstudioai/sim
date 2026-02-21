import { randomUUID } from 'node:crypto'
import { db } from '@sim/db'
import { oauthApplication } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'

const logger = createLogger('cimd')

interface ClientMetadataDocument {
  client_id: string
  client_name: string
  logo_uri?: string
  redirect_uris: string[]
  client_uri?: string
  policy_uri?: string
  tos_uri?: string
  contacts?: string[]
  scope?: string
}

export function isMetadataUrl(clientId: string): boolean {
  return clientId.startsWith('https://')
}

async function fetchClientMetadata(url: string): Promise<ClientMetadataDocument> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') {
    throw new Error('CIMD URL must use HTTPS')
  }

  const res = await secureFetchWithValidation(url, {
    headers: { Accept: 'application/json' },
    timeout: 5000,
    maxResponseBytes: 256 * 1024,
  })

  if (!res.ok) {
    throw new Error(`CIMD fetch failed: ${res.status} ${res.statusText}`)
  }

  const doc = (await res.json()) as ClientMetadataDocument

  if (doc.client_id !== url) {
    throw new Error(`CIMD client_id mismatch: document has "${doc.client_id}", expected "${url}"`)
  }

  if (!Array.isArray(doc.redirect_uris) || doc.redirect_uris.length === 0) {
    throw new Error('CIMD document must contain at least one redirect_uri')
  }

  for (const uri of doc.redirect_uris) {
    let parsed: URL
    try {
      parsed = new URL(uri)
    } catch {
      throw new Error(`Invalid redirect_uri: ${uri}`)
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`Invalid redirect_uri scheme: ${parsed.protocol}`)
    }
    if (uri.includes(',')) {
      throw new Error(`redirect_uri must not contain commas: ${uri}`)
    }
  }

  if (doc.logo_uri) {
    try {
      const logoParsed = new URL(doc.logo_uri)
      if (logoParsed.protocol !== 'https:') {
        doc.logo_uri = undefined
      }
    } catch {
      doc.logo_uri = undefined
    }
  }

  if (!doc.client_name || typeof doc.client_name !== 'string') {
    throw new Error('CIMD document must contain a client_name')
  }

  return doc
}

const CACHE_TTL_MS = 5 * 60 * 1000
const NEGATIVE_CACHE_TTL_MS = 60 * 1000
const cache = new Map<string, { doc: ClientMetadataDocument; expiresAt: number }>()
const failureCache = new Map<string, { error: string; expiresAt: number }>()
const inflight = new Map<string, Promise<ClientMetadataDocument>>()

interface ResolveResult {
  metadata: ClientMetadataDocument
  fromCache: boolean
}

export async function resolveClientMetadata(url: string): Promise<ResolveResult> {
  const cached = cache.get(url)
  if (cached && Date.now() < cached.expiresAt) {
    return { metadata: cached.doc, fromCache: true }
  }

  const failed = failureCache.get(url)
  if (failed && Date.now() < failed.expiresAt) {
    throw new Error(failed.error)
  }

  const pending = inflight.get(url)
  if (pending) {
    return pending.then((doc) => ({ metadata: doc, fromCache: false }))
  }

  const promise = fetchClientMetadata(url)
    .then((doc) => {
      cache.set(url, { doc, expiresAt: Date.now() + CACHE_TTL_MS })
      failureCache.delete(url)
      return doc
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err)
      failureCache.set(url, { error: message, expiresAt: Date.now() + NEGATIVE_CACHE_TTL_MS })
      throw err
    })
    .finally(() => {
      inflight.delete(url)
    })

  inflight.set(url, promise)
  return promise.then((doc) => ({ metadata: doc, fromCache: false }))
}

export async function upsertCimdClient(metadata: ClientMetadataDocument): Promise<void> {
  const now = new Date()
  const redirectURLs = metadata.redirect_uris.join(',')

  await db
    .insert(oauthApplication)
    .values({
      id: randomUUID(),
      clientId: metadata.client_id,
      name: metadata.client_name,
      icon: metadata.logo_uri ?? null,
      redirectURLs,
      type: 'public',
      clientSecret: null,
      userId: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: oauthApplication.clientId,
      set: {
        name: metadata.client_name,
        icon: metadata.logo_uri ?? null,
        redirectURLs,
        type: 'public',
        clientSecret: null,
        updatedAt: now,
      },
    })

  logger.info('Upserted CIMD client', {
    clientId: metadata.client_id,
    name: metadata.client_name,
  })
}
