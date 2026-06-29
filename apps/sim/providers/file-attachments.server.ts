import { FileState, GoogleGenAI } from '@google/genai'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import type { StorageContext } from '@/lib/uploads'
import { StorageService } from '@/lib/uploads'
import { inferContextFromKey } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
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

const OPENAI_FILES_ENDPOINT = 'https://api.openai.com/v1/files'
const PRESIGNED_URL_EXPIRY_SECONDS = 60 * 60
/** OpenAI auto-deletes uploaded files after this window — see the "rely on provider expiry" lifecycle. */
const OPENAI_FILE_EXPIRY_SECONDS = 60 * 60
const GEMINI_POLL_INTERVAL_MS = 1000
const GEMINI_PROCESSING_TIMEOUT_MS = 5 * 60_000

function* iterateRequestFiles(messages: Message[] | undefined): Generator<UserFile> {
  for (const message of messages ?? []) {
    for (const file of message.files ?? []) {
      yield file
    }
  }
}

/**
 * Resolves every attachment that exceeds the inline threshold on a large-file-capable
 * provider to a short-lived signed URL on `file.remoteUrl`. `remote-url` providers send it
 * to the model directly; for `files-api` providers it marks the file for upload (the bytes
 * are read from storage at upload time). Requires cloud storage — a large file (already past
 * the inline base64 cap) cannot be sent without it, so the request fails with a clear error.
 *
 * Runs for every request in {@link executeProviderRequest} (after the API key resolves), so
 * the server-only handle fields are first cleared on every file for every provider — a forged
 * handle on an untrusted request body can never survive to a builder or trigger a fetch.
 */
export async function attachLargeFileRemoteUrls(
  request: ProviderRequest,
  providerId: ProviderId | string
): Promise<void> {
  for (const file of iterateRequestFiles(request.messages)) {
    file.providerFileId = undefined
    file.providerFileUri = undefined
    file.remoteUrl = undefined
  }

  if (getProviderFileStrategy(providerId) === 'inline') return

  const requestId = request.workflowId ?? 'provider-request'
  const maxBytes = getProviderAttachmentMaxBytes(providerId)

  for (const file of iterateRequestFiles(request.messages)) {
    if (!file.key || !shouldUseLargeFilePath(file, providerId)) continue

    if (Number.isFinite(file.size) && file.size > maxBytes) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(2)
      const maxMB = (maxBytes / (1024 * 1024)).toFixed(0)
      throw new Error(
        `File "${file.name}" (${sizeMB}MB) exceeds the ${maxMB}MB agent attachment limit for provider "${providerId}"`
      )
    }

    if (!StorageService.hasCloudStorage()) {
      logger.warn(
        `[${requestId}] "${file.name}" exceeds the inline limit for "${providerId}" but cloud storage is unavailable`
      )
      throw new Error(
        `File "${file.name}" exceeds the inline attachment limit and requires cloud file storage, which is not configured`
      )
    }

    if (!request.userId) {
      throw new Error(
        `File "${file.name}" requires an authenticated user for provider "${providerId}"`
      )
    }

    const context = (file.context as StorageContext) || inferContextFromKey(file.key)
    const hasAccess = await verifyFileAccess(file.key, request.userId, undefined, context, false)
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
 * `remoteUrl` from {@link attachLargeFileRemoteUrls}) to the provider Files API and records
 * the returned handle on the file. Runs after the request's API key is resolved so hosted
 * and BYOK keys both work.
 */
export async function uploadLargeFilesToProvider(
  request: ProviderRequest,
  providerId: ProviderId | string
): Promise<void> {
  if (getProviderFileStrategy(providerId) !== 'files-api') return

  const groups = groupUploadableFiles(request.messages)
  if (groups.length === 0) return

  const maxBytes = getProviderAttachmentMaxBytes(providerId)
  const ai = providerId === 'google' ? new GoogleGenAI({ apiKey: request.apiKey }) : null

  for (const group of groups) {
    const [representative] = group
    await assertFileAccessForUpload(representative, request.userId)
    if (providerId === 'openai') {
      await uploadOpenAIFile(representative, request.apiKey, maxBytes, request.abortSignal)
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
 * Verifies the caller may read this file before its bytes are uploaded to a provider. Enforced
 * for every caller of {@link uploadLargeFilesToProvider} (not just the agent path), so a forged
 * storage key in a passthrough request cannot exfiltrate another user's file.
 */
async function assertFileAccessForUpload(
  file: UserFile,
  userId: string | undefined
): Promise<void> {
  if (!file.key) {
    throw new Error(`File "${file.name}" has no storage key`)
  }
  if (!userId) {
    throw new Error(`File "${file.name}" requires an authenticated user to upload`)
  }
  const context = (file.context as StorageContext) || inferContextFromKey(file.key)
  const hasAccess = await verifyFileAccess(file.key, userId, undefined, context, false)
  if (!hasAccess) {
    throw new Error(`File "${file.name}" is not accessible`)
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
  const { buffer, contentType } = await downloadServableFileFromStorage(
    file,
    'provider-file-upload',
    logger,
    { maxBytes }
  )
  return new Blob([new Uint8Array(buffer)], {
    type: contentType || file.type || inferAttachmentMimeType(file),
  })
}

/**
 * Uploads to `POST /v1/files` via multipart directly (not the SDK), because the installed
 * `openai` SDK does not type `expires_after`; the bracketed form fields are the documented
 * multipart encoding for the nested object and give the file an auto-expiry.
 */
async function uploadOpenAIFile(
  file: UserFile,
  apiKey: string | undefined,
  maxBytes: number,
  signal?: AbortSignal
): Promise<void> {
  const mimeType = inferAttachmentMimeType(file)
  const blob = await downloadFileForUpload(file, maxBytes)

  const form = new FormData()
  form.append('purpose', mimeType.startsWith('image/') ? 'vision' : 'user_data')
  form.append('expires_after[anchor]', 'created_at')
  form.append('expires_after[seconds]', String(OPENAI_FILE_EXPIRY_SECONDS))
  form.append('file', blob, file.name)

  const response = await fetch(OPENAI_FILES_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal,
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`OpenAI file upload failed for "${file.name}" (${response.status}): ${detail}`)
  }

  const uploaded = (await response.json()) as { id?: string }
  if (!uploaded.id) {
    throw new Error(`OpenAI file upload for "${file.name}" returned no id`)
  }
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
  if (!uploaded.name) {
    throw new Error(`Gemini upload for "${file.name}" returned no file name`)
  }
  const uploadedName = uploaded.name

  const deadline = Date.now() + GEMINI_PROCESSING_TIMEOUT_MS
  while (uploaded.state === FileState.PROCESSING) {
    if (Date.now() > deadline) {
      throw new Error(`Gemini file processing timed out for "${file.name}"`)
    }
    await sleep(GEMINI_POLL_INTERVAL_MS)
    uploaded = await ai.files.get({ name: uploadedName })
  }

  if (uploaded.state === FileState.FAILED || !uploaded.uri) {
    throw new Error(
      `Gemini file processing failed for "${file.name}": ${getErrorMessage(uploaded.error, 'unknown error')}`
    )
  }
  file.providerFileUri = uploaded.uri
  logger.info(`Uploaded "${file.name}" to Gemini File API`, { fileUri: uploaded.uri })
}
