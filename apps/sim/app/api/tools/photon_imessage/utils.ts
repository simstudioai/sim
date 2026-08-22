import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { Spectrum, type SpectrumInstance, text } from '@spectrum-ts/core'
import { imessage } from '@spectrum-ts/imessage'

const logger = createLogger('PhotonImessageClient')

/**
 * Photon mints per-project gRPC credentials and opens a connection per configured line when the
 * instance is constructed, so building one per request would re-mint on every send. Instances are
 * cached by project and evicted least-recently-used; the bound keeps a workspace that rotates
 * secrets or runs many projects from growing the pool without limit.
 */
const MAX_CACHED_INSTANCES = 8

const instances = new Map<string, Promise<SpectrumInstance>>()

const cacheKey = (projectId: string, projectSecret: string): string =>
  `${projectId}:${sha256Hex(projectSecret)}`

async function evictOldest(): Promise<void> {
  while (instances.size > MAX_CACHED_INSTANCES) {
    const oldestKey = instances.keys().next().value
    if (oldestKey === undefined) {
      return
    }
    const evicted = instances.get(oldestKey)
    instances.delete(oldestKey)
    try {
      await (await evicted)?.stop()
    } catch (error) {
      logger.warn('Failed to stop evicted Photon instance', { error })
    }
  }
}

/**
 * Resolve a Photon instance for these credentials. The returned instance never reads
 * `app.messages` — that would open the inbound stream, which is the trigger's job, not the
 * send tool's.
 */
async function getInstance(projectId: string, projectSecret: string): Promise<SpectrumInstance> {
  const key = cacheKey(projectId, projectSecret)
  const cached = instances.get(key)
  if (cached) {
    // Re-insert so the Map's insertion order stays LRU rather than FIFO.
    instances.delete(key)
    instances.set(key, cached)
    return await cached
  }

  const created = Spectrum({
    projectId,
    projectSecret,
    providers: [imessage.config()],
  }) as Promise<SpectrumInstance>
  instances.set(key, created)

  try {
    const instance = await created
    await evictOldest()
    return instance
  } catch (error) {
    // A failed construction must not be cached, or every later send reuses the rejection.
    instances.delete(key)
    throw error
  }
}

export interface PhotonImessageSendResult {
  messageId: string | null
  chatId: string
  timestamp: string | null
}

/**
 * Send one text message, addressing either an existing chat GUID or an address (phone number or
 * email) whose DM is resolved first. Group chats can only be addressed by `chatId`: Photon has no
 * by-id resolver for a group it has not seen this session.
 */
export async function sendPhotonImessage(params: {
  projectId: string
  projectSecret: string
  to?: string | null
  chatId?: string | null
  text: string
}): Promise<PhotonImessageSendResult> {
  const app = await getInstance(params.projectId, params.projectSecret)
  const platform = imessage(app)

  let space: Awaited<ReturnType<typeof platform.space.get>>
  if (params.chatId) {
    space = await platform.space.get(params.chatId)
  } else if (params.to) {
    space = await platform.space.create(await platform.user(params.to))
  } else {
    throw new Error('Provide either a recipient address or a chat ID')
  }

  const sent = await space.send(text(params.text))

  return {
    messageId: sent?.id ?? null,
    chatId: space.id,
    timestamp: sent?.timestamp?.toISOString() ?? null,
  }
}
