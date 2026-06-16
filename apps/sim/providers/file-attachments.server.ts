import { FileState, GoogleGenAI } from '@google/genai'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import OpenAI, { toFile } from 'openai'
import type { StorageContext } from '@/lib/uploads'
import { StorageService } from '@/lib/uploads'
import { inferContextFromKey } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { verifyFileAccess } from '@/app/api/files/authorization'
import type { UserFile } from '@/executor/types'
import {
  getProviderAttachmentMaxBytes,
  getProviderFileStrategy,
  inferAttachmentMimeType,
  shouldUseLargeFilePath,
} from '@/providers/attachments'
import type { Message, ProviderId, ProviderRequest } from '@/providers/types'

const logger = createLogger('ProviderFileAttachments')

const PRESIGNED_URL_EXPIRY_SECONDS = 60 * 60
/** OpenAI auto-deletes uploaded files after this window — see the "rely on provider expiry" lifecycle. */
const OPENAI_FILE_EXPIRY_SECONDS = 60 * 60
const GEMINI_POLL_INTERVAL_MS = 1000
const GEMINI_PROCESSING_TIMEOUT_MS = 5 * 60_000

interface RemoteUrlContext {
  requestId: string
  userId?: string
}

/**
 * Mints a short-lived signed download URL for every attachment that exceeds the inline
 * threshold on a large-file-capable provider, storing it on `file.remoteUrl`. Providers
 * with a `remote-url` strategy use it directly; `files-api` providers upload from it later.
 * Requires cloud storage — without it large files fall back to the (capped) base64 path.
 *
 * The server-only handle fields are first cleared on every file for every provider
 * (including inline) so a forged handle on untrusted input can never reach a builder.
 */
export async function attachLargeFileRemoteUrls(
  files: UserFile[] | undefined,
  providerId: ProviderId | string,
  ctx: RemoteUrlContext
): Promise<void> {
  if (!files?.length) return

  for (const file of files) {
    file.providerFileId = undefined
    file.providerFileUri = undefined
    file.remoteUrl = undefined
  }

  if (getProviderFileStrategy(providerId) === 'inline') return

  for (const file of files) {
    if (!file.key || !shouldUseLargeFilePath(file, providerId)) continue

    const maxBytes = getProviderAttachmentMaxBytes(providerId)
    if (Number.isFinite(file.size) && file.size > maxBytes) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(2)
      const maxMB = (maxBytes / (1024 * 1024)).toFixed(0)
      throw new Error(
        `File "${file.name}" (${sizeMB}MB) exceeds the ${maxMB}MB agent attachment limit for provider "${providerId}"`
      )
    }

    if (!StorageService.hasCloudStorage()) {
      logger.warn(
        `[${ctx.requestId}] "${file.name}" exceeds the inline limit for "${providerId}" but cloud storage is unavailable; it cannot be sent`
      )
      continue
    }

    if (!ctx.userId) {
      throw new Error(
        `File "${file.name}" requires an authenticated user for provider "${providerId}"`
      )
    }

    const context = (file.context as StorageContext) || inferContextFromKey(file.key)
    const hasAccess = await verifyFileAccess(file.key, ctx.userId, undefined, context, false)
    if (!hasAccess) {
      throw new Error(`File "${file.name}" is not accessible for provider "${providerId}"`)
    }

    file.remoteUrl = await StorageService.generatePresignedDownloadUrl(
      file.key,
      context,
      PRESIGNED_URL_EXPIRY_SECONDS
    )
  }
}

/**
 * For `files-api` providers, uploads each large attachment (already carrying a signed
 * `remoteUrl`) to the provider Files API and records the returned handle on the file.
 * Runs after the request's API key is resolved so hosted and BYOK keys both work.
 */
export async function uploadLargeFilesToProvider(
  request: ProviderRequest,
  providerId: ProviderId | string
): Promise<void> {
  if (getProviderFileStrategy(providerId) !== 'files-api') return

  const groups = groupUploadableFiles(request.messages)
  if (groups.length === 0) return

  const maxBytes = getProviderAttachmentMaxBytes(providerId)
  const openai = providerId === 'openai' ? new OpenAI({ apiKey: request.apiKey }) : null
  const ai = providerId === 'google' ? new GoogleGenAI({ apiKey: request.apiKey }) : null

  for (const group of groups) {
    const [representative] = group
    if (openai) {
      await uploadOpenAIFile(representative, openai, maxBytes, request.abortSignal)
    } else if (ai) {
      await uploadGeminiFile(representative, ai, maxBytes, request.abortSignal)
    }
    for (const file of group) {
      file.providerFileId = representative.providerFileId
      file.providerFileUri = representative.providerFileUri
    }
  }
}

/**
 * Groups large files needing a Files API upload by storage key so a file referenced across
 * multiple messages uploads once; the resulting handle is then applied to every occurrence.
 */
function groupUploadableFiles(messages: Message[] | undefined): UserFile[][] {
  const groups = new Map<string, UserFile[]>()
  for (const message of messages ?? []) {
    for (const file of message.files ?? []) {
      if (!file.remoteUrl || file.providerFileId || file.providerFileUri) continue
      const dedupeKey = file.key || file.remoteUrl
      const group = groups.get(dedupeKey)
      if (group) group.push(file)
      else groups.set(dedupeKey, [file])
    }
  }
  return [...groups.values()]
}

/**
 * Reads the file bytes straight from storage via the storage SDK (not by HTTP-fetching the
 * signed URL), so there is no server-side URL fetch to be an SSRF vector and internal
 * object storage works. Bounded by the provider's attachment ceiling.
 */
async function downloadFileForUpload(file: UserFile, maxBytes: number): Promise<Blob> {
  const buffer = await downloadFileFromStorage(file, 'provider-file-upload', logger, { maxBytes })
  return new Blob([buffer], { type: file.type || inferAttachmentMimeType(file) })
}

async function uploadOpenAIFile(
  file: UserFile,
  client: OpenAI,
  maxBytes: number,
  signal?: AbortSignal
): Promise<void> {
  const mimeType = inferAttachmentMimeType(file)
  const blob = await downloadFileForUpload(file, maxBytes)

  const uploaded = await client.files.create(
    {
      file: await toFile(blob, file.name, { type: mimeType }),
      purpose: mimeType.startsWith('image/') ? 'vision' : 'user_data',
      expires_after: { anchor: 'created_at', seconds: OPENAI_FILE_EXPIRY_SECONDS },
    },
    { signal }
  )

  file.providerFileId = uploaded.id
  logger.info(`Uploaded "${file.name}" to OpenAI Files API`, { fileId: uploaded.id })
}

async function uploadGeminiFile(
  file: UserFile,
  ai: GoogleGenAI,
  maxBytes: number,
  signal?: AbortSignal
): Promise<void> {
  const mimeType = inferAttachmentMimeType(file)
  const blob = await downloadFileForUpload(file, maxBytes)

  let uploaded = await ai.files.upload({ file: blob, config: { mimeType, abortSignal: signal } })

  const deadline = Date.now() + GEMINI_PROCESSING_TIMEOUT_MS
  while (uploaded.state === FileState.PROCESSING) {
    if (Date.now() > deadline) {
      throw new Error(`Gemini file processing timed out for "${file.name}"`)
    }
    await sleep(GEMINI_POLL_INTERVAL_MS)
    uploaded = await ai.files.get({ name: uploaded.name as string })
  }

  if (uploaded.state === FileState.FAILED || !uploaded.uri) {
    throw new Error(
      `Gemini file processing failed for "${file.name}": ${getErrorMessage(uploaded.error, 'unknown error')}`
    )
  }
  file.providerFileUri = uploaded.uri
  logger.info(`Uploaded "${file.name}" to Gemini File API`, { fileUri: uploaded.uri })
}
