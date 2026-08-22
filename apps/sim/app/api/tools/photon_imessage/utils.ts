import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import {
  addMember,
  attachment,
  avatar,
  edit,
  leaveSpace,
  poll,
  reaction,
  read,
  removeMember,
  rename,
  reply,
  Spectrum,
  type SpectrumInstance,
  text,
  typing,
  unsend,
  voice,
} from '@spectrum-ts/core'
import { effect, imessage } from '@spectrum-ts/imessage'

// Apple effect identifiers keyed by friendly name (balloons, confetti, slam, …), exposed as a
// static on the provider callable.
const messageEffects = imessage.effect.message

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
 * tool layer's.
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

export interface PhotonCredentials {
  projectId: string
  projectSecret: string
}

export interface PhotonChatTarget {
  /** A phone number or Apple ID email, or a chat GUID from a trigger. */
  to: string
}

async function getContext(credentials: PhotonCredentials) {
  const app = await getInstance(credentials.projectId, credentials.projectSecret)
  return { app, platform: imessage(app) }
}

type PhotonContext = Awaited<ReturnType<typeof getContext>>
type PhotonSpace = Awaited<ReturnType<PhotonContext['platform']['space']['get']>>

/** Chat GUIDs are unmistakable: a DM is `any;-;<address>`, a group is `<service>;+;<id>`. */
const isChatGuid = (value: string): boolean => value.includes(';-;') || value.includes(';+;')

/**
 * Address a conversation from one field: a chat GUID (the only way to reach a group) resolves
 * directly; anything else is a phone/email whose DM is created or reused.
 */
async function resolveSpace(ctx: PhotonContext, target: string): Promise<PhotonSpace> {
  if (isChatGuid(target)) {
    return await ctx.platform.space.get(target)
  }
  return await ctx.platform.space.create(await ctx.platform.user(target))
}

async function requireMessage(space: PhotonSpace, messageId: string) {
  const message = await space.getMessage(messageId)
  if (!message) {
    throw new Error(`Message ${messageId} was not found in this chat`)
  }
  return message
}

export interface PhotonSentMessage {
  messageId: string | null
  chatId: string
  timestamp: string | null
}

function sentResult(space: PhotonSpace, sent: { id: string; timestamp?: Date } | undefined) {
  return {
    messageId: sent?.id ?? null,
    chatId: space.id,
    timestamp: sent?.timestamp?.toISOString() ?? null,
  }
}

/** Effect names the send tool accepts, mapped to Apple's effect identifiers. */
export const PHOTON_EFFECT_NAMES = Object.keys(messageEffects) as Array<keyof typeof messageEffects>

export async function sendPhotonImessage(
  params: PhotonCredentials &
    PhotonChatTarget & {
      text: string
      effectName?: string | null
      replyToMessageId?: string | null
    }
): Promise<PhotonSentMessage> {
  const ctx = await getContext(params)
  const space = await resolveSpace(ctx, params.to)

  let content = text(params.text)
  if (params.replyToMessageId) {
    content = reply(content, await requireMessage(space, params.replyToMessageId))
  }
  if (params.effectName) {
    const effectId = messageEffects[params.effectName as keyof typeof messageEffects]
    if (!effectId) {
      throw new Error(
        `Unknown effect "${params.effectName}". Valid effects: ${PHOTON_EFFECT_NAMES.join(', ')}`
      )
    }
    // Effects wrap the whole send, including a reply wrapper.
    content = effect(content, effectId)
  }

  const sent = await space.send(content)
  return sentResult(space, sent)
}

export async function sendPhotonMedia(
  params: PhotonCredentials &
    PhotonChatTarget & {
      fileBuffer: Buffer
      fileName: string
      mimeType?: string | null
      caption?: string | null
    }
): Promise<PhotonSentMessage> {
  const ctx = await getContext(params)
  const space = await resolveSpace(ctx, params.to)

  const media = attachment(params.fileBuffer, {
    name: params.fileName,
    ...(params.mimeType ? { mimeType: params.mimeType } : {}),
  })
  const sent = await space.send(media)
  // iMessage renders caption and media as separate bubbles; send the caption after the media so
  // it reads as a description of what just arrived.
  if (params.caption) {
    await space.send(text(params.caption))
  }
  return sentResult(space, sent)
}

export async function sendPhotonVoiceMemo(
  params: PhotonCredentials &
    PhotonChatTarget & {
      fileBuffer: Buffer
      fileName: string
      mimeType?: string | null
    }
): Promise<PhotonSentMessage> {
  const ctx = await getContext(params)
  const space = await resolveSpace(ctx, params.to)
  const sent = await space.send(
    voice(params.fileBuffer, {
      name: params.fileName,
      ...(params.mimeType ? { mimeType: params.mimeType } : {}),
    })
  )
  return sentResult(space, sent)
}

export async function sendPhotonReaction(
  params: PhotonCredentials &
    PhotonChatTarget & {
      messageId: string
      emoji: string
    }
): Promise<PhotonSentMessage> {
  const ctx = await getContext(params)
  const space = await resolveSpace(ctx, params.to)
  const target = await requireMessage(space, params.messageId)
  const sent = await space.send(reaction(params.emoji, target))
  return sentResult(space, sent)
}

export async function editPhotonMessage(
  params: PhotonCredentials &
    PhotonChatTarget & {
      messageId: string
      text: string
    }
): Promise<PhotonSentMessage> {
  const ctx = await getContext(params)
  const space = await resolveSpace(ctx, params.to)
  const target = await requireMessage(space, params.messageId)
  const sent = await space.send(edit(text(params.text), target))
  return sentResult(space, sent)
}

export async function unsendPhotonMessage(
  params: PhotonCredentials &
    PhotonChatTarget & {
      messageId: string
    }
): Promise<{ chatId: string; messageId: string }> {
  const ctx = await getContext(params)
  const space = await resolveSpace(ctx, params.to)
  const target = await requireMessage(space, params.messageId)
  await space.send(unsend(target))
  return { chatId: space.id, messageId: params.messageId }
}

export async function createPhotonPoll(
  params: PhotonCredentials &
    PhotonChatTarget & {
      title: string
      options: string[]
    }
): Promise<PhotonSentMessage> {
  const ctx = await getContext(params)
  const space = await resolveSpace(ctx, params.to)
  const sent = await space.send(poll(params.title, params.options))
  return sentResult(space, sent)
}

export async function setPhotonTyping(
  params: PhotonCredentials &
    PhotonChatTarget & {
      state: 'start' | 'stop'
    }
): Promise<{ chatId: string; state: 'start' | 'stop' }> {
  const ctx = await getContext(params)
  const space = await resolveSpace(ctx, params.to)
  await space.send(typing(params.state))
  return { chatId: space.id, state: params.state }
}

export async function markPhotonChatRead(
  params: PhotonCredentials &
    PhotonChatTarget & {
      messageId: string
    }
): Promise<{ chatId: string; messageId: string }> {
  const ctx = await getContext(params)
  const space = await resolveSpace(ctx, params.to)
  const target = await requireMessage(space, params.messageId)
  await space.send(read(target))
  return { chatId: space.id, messageId: params.messageId }
}

export async function renamePhotonChat(
  params: PhotonCredentials & {
    chatId: string
    displayName: string
  }
): Promise<{ chatId: string; displayName: string }> {
  const ctx = await getContext(params)
  const space = await resolveSpace(ctx, params.chatId)
  await space.send(rename(params.displayName))
  return { chatId: space.id, displayName: params.displayName }
}

export async function setPhotonGroupAvatar(
  params: PhotonCredentials & {
    chatId: string
    fileBuffer?: Buffer | null
    fileName?: string | null
    mimeType?: string | null
    clear?: boolean
  }
): Promise<{ chatId: string; cleared: boolean }> {
  const ctx = await getContext(params)
  const space = await resolveSpace(ctx, params.chatId)
  if (params.clear) {
    await space.send(avatar('clear'))
    return { chatId: space.id, cleared: true }
  }
  if (!params.fileBuffer) {
    throw new Error('Provide an image file, or set clear to remove the current group photo')
  }
  await space.send(avatar(params.fileBuffer, { mimeType: params.mimeType ?? 'image/jpeg' }))
  return { chatId: space.id, cleared: false }
}

export async function addPhotonParticipant(
  params: PhotonCredentials & {
    chatId: string
    handle: string
  }
): Promise<{ chatId: string; handle: string }> {
  const ctx = await getContext(params)
  const space = await resolveSpace(ctx, params.chatId)
  await space.send(addMember(params.handle))
  return { chatId: space.id, handle: params.handle }
}

export async function removePhotonParticipant(
  params: PhotonCredentials & {
    chatId: string
    handle: string
  }
): Promise<{ chatId: string; handle: string }> {
  const ctx = await getContext(params)
  const space = await resolveSpace(ctx, params.chatId)
  await space.send(removeMember(params.handle))
  return { chatId: space.id, handle: params.handle }
}

export async function leavePhotonChat(
  params: PhotonCredentials & {
    chatId: string
  }
): Promise<{ chatId: string }> {
  const ctx = await getContext(params)
  const space = await resolveSpace(ctx, params.chatId)
  await space.send(leaveSpace())
  return { chatId: space.id }
}

export async function createPhotonGroup(
  params: PhotonCredentials & {
    handles: string[]
    initialText?: string | null
  }
): Promise<PhotonSentMessage> {
  const ctx = await getContext(params)
  const users = await Promise.all(params.handles.map((handle) => ctx.platform.user(handle)))
  let space: PhotonSpace
  try {
    space = await ctx.platform.space.create(users)
  } catch (error) {
    // Shared Photon lines cannot create group chats; surface the real constraint instead of the
    // provider's lower-level error.
    throw new Error(
      `Could not create the group chat. Group creation requires a dedicated Photon line. (${
        error instanceof Error ? error.message : String(error)
      })`
    )
  }
  const sent = params.initialText ? await space.send(text(params.initialText)) : undefined
  return sentResult(space, sent)
}

export interface PhotonMessageDetails {
  messageId: string
  chatId: string
  text: string | null
  contentType: string
  senderId: string | null
  timestamp: string | null
  attachments: Array<{ id: string | null; name: string | null; mimeType: string | null }>
}

/** Depth-first text extraction through reply/group wrappers, mirroring the webhook handler. */
function extractText(content: unknown): string | null {
  if (!content || typeof content !== 'object') {
    return null
  }
  const node = content as Record<string, unknown>
  if (node.type === 'text' && typeof node.text === 'string') {
    return node.text
  }
  if (node.type === 'reply') {
    return extractText(node.content)
  }
  if (node.type === 'group' && Array.isArray(node.items)) {
    for (const item of node.items) {
      const found = extractText((item as Record<string, unknown>).content ?? item)
      if (found !== null) {
        return found
      }
    }
  }
  return null
}

function extractAttachments(
  content: unknown
): Array<{ id: string | null; name: string | null; mimeType: string | null }> {
  if (!content || typeof content !== 'object') {
    return []
  }
  const node = content as Record<string, unknown>
  if (node.type === 'attachment') {
    return [
      {
        id: typeof node.id === 'string' ? node.id : null,
        name: typeof node.name === 'string' ? node.name : null,
        mimeType: typeof node.mimeType === 'string' ? node.mimeType : null,
      },
    ]
  }
  if (node.type === 'reply') {
    return extractAttachments(node.content)
  }
  if (node.type === 'group' && Array.isArray(node.items)) {
    return node.items.flatMap((item) =>
      extractAttachments((item as Record<string, unknown>).content ?? item)
    )
  }
  return []
}

export async function getPhotonMessage(
  params: PhotonCredentials & {
    chatId: string
    messageId: string
  }
): Promise<PhotonMessageDetails> {
  const ctx = await getContext(params)
  const space = await resolveSpace(ctx, params.chatId)
  const message = await requireMessage(space, params.messageId)

  return {
    messageId: message.id,
    chatId: space.id,
    text: extractText(message.content),
    contentType: message.content?.type ?? 'unknown',
    senderId: message.sender?.id ?? null,
    timestamp: message.timestamp?.toISOString() ?? null,
    attachments: extractAttachments(message.content),
  }
}

export interface PhotonGroupInfo {
  chatId: string
  displayName: string | null
  members: string[]
}

export async function getPhotonGroupInfo(
  params: PhotonCredentials & {
    chatId: string
  }
): Promise<PhotonGroupInfo> {
  const ctx = await getContext(params)
  const space = await resolveSpace(ctx, params.chatId)
  // Both actions are group-only in the provider; a DM chatId surfaces the provider's
  // UnsupportedError, which the route maps to a clear message.
  const [displayName, members] = await Promise.all([
    space.getDisplayName().catch(() => null),
    space.getMembers(),
  ])
  return {
    chatId: space.id,
    displayName: displayName ?? null,
    members: (members as Array<{ id?: string } | string>).map((member) =>
      typeof member === 'string' ? member : (member.id ?? String(member))
    ),
  }
}

export interface PhotonAttachmentDownload {
  attachmentId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  base64: string
}

/**
 * The route ships attachment bytes back to the executor as base64 for FileToolProcessor; cap the
 * payload so one giant video cannot balloon a workflow run.
 */
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024

export async function downloadPhotonAttachment(
  params: PhotonCredentials & {
    attachmentId: string
  }
): Promise<PhotonAttachmentDownload> {
  const ctx = await getContext(params)
  const att = await ctx.platform.getAttachment(params.attachmentId)
  if (!att) {
    throw new Error(`Attachment ${params.attachmentId} was not found`)
  }
  const bytes = await att.read()
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(
      `Attachment is ${Math.round(buffer.byteLength / (1024 * 1024))}MB, above the 50MB download limit`
    )
  }
  return {
    attachmentId: params.attachmentId,
    fileName: att.name ?? 'attachment',
    mimeType: att.mimeType ?? 'application/octet-stream',
    sizeBytes: buffer.byteLength,
    base64: buffer.toString('base64'),
  }
}

export async function sharePhotonContactCard(
  params: PhotonCredentials & PhotonChatTarget
): Promise<{ chatId: string }> {
  const ctx = await getContext(params)
  const space = await resolveSpace(ctx, params.to)
  await imessage(space).shareContactCard()
  return { chatId: space.id }
}

export async function setPhotonChatBackground(
  params: PhotonCredentials &
    PhotonChatTarget & {
      fileBuffer?: Buffer | null
      fileName?: string | null
      mimeType?: string | null
      clear?: boolean
    }
): Promise<{ chatId: string; cleared: boolean }> {
  const ctx = await getContext(params)
  const space = await resolveSpace(ctx, params.to)
  const narrowed = imessage(space)
  if (params.clear) {
    await narrowed.background('clear')
    return { chatId: space.id, cleared: true }
  }
  if (!params.fileBuffer) {
    throw new Error('Provide an image file, or set clear to remove the current background')
  }
  await narrowed.background(params.fileBuffer, {
    ...(params.mimeType ? { mimeType: params.mimeType } : {}),
  })
  return { chatId: space.id, cleared: false }
}
