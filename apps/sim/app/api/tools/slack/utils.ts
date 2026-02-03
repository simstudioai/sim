import type { Logger } from '@sim/logger'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import type { ToolFileData } from '@/tools/types'

/**
 * Sends a message to a Slack channel using chat.postMessage
 */
export async function postSlackMessage(
  accessToken: string,
  channel: string,
  text: string,
  threadTs?: string | null
): Promise<{ ok: boolean; ts?: string; channel?: string; message?: any; error?: string }> {
  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      channel,
      text,
      ...(threadTs && { thread_ts: threadTs }),
    }),
  })

  return response.json()
}

/**
 * Creates a default message object when the API doesn't return one
 */
export function createDefaultMessageObject(
  ts: string,
  text: string,
  channel: string
): Record<string, any> {
  return {
    type: 'message',
    ts,
    text,
    channel,
  }
}

/**
 * Formats the success response for a sent message
 */
export function formatMessageSuccessResponse(
  data: any,
  text: string
): {
  message: any
  ts: string
  channel: string
} {
  const messageObj = data.message || createDefaultMessageObject(data.ts, text, data.channel)
  return {
    message: messageObj,
    ts: data.ts,
    channel: data.channel,
  }
}

/**
 * Uploads files to Slack and returns the uploaded file IDs
 */
export async function uploadFilesToSlack(
  files: any[],
  accessToken: string,
  requestId: string,
  logger: Logger
): Promise<{ fileIds: string[]; files: ToolFileData[] }> {
  const userFiles = processFilesToUserFiles(files, requestId, logger)
  const uploadedFileIds: string[] = []
  const uploadedFiles: ToolFileData[] = []

  for (const userFile of userFiles) {
    logger.info(`[${requestId}] Uploading file: ${userFile.name}`)

    const buffer = await downloadFileFromStorage(userFile, requestId, logger)

    const getUrlResponse = await fetch('https://slack.com/api/files.getUploadURLExternal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${accessToken}`,
      },
      body: new URLSearchParams({
        filename: userFile.name,
        length: buffer.length.toString(),
      }),
    })

    const urlData = await getUrlResponse.json()

    if (!urlData.ok) {
      logger.error(`[${requestId}] Failed to get upload URL:`, urlData.error)
      continue
    }

    logger.info(`[${requestId}] Got upload URL for ${userFile.name}, file_id: ${urlData.file_id}`)

    const uploadResponse = await secureFetchWithValidation(
      urlData.upload_url,
      {
        method: 'POST',
        body: buffer,
      },
      'uploadUrl'
    )

    if (!uploadResponse.ok) {
      logger.error(`[${requestId}] Failed to upload file data: ${uploadResponse.status}`)
      continue
    }

    logger.info(`[${requestId}] File data uploaded successfully`)
    uploadedFileIds.push(urlData.file_id)
    // Only add to uploadedFiles after successful upload to keep arrays in sync
    uploadedFiles.push({
      name: userFile.name,
      mimeType: userFile.type || 'application/octet-stream',
      data: buffer.toString('base64'),
      size: buffer.length,
    })
  }

  return { fileIds: uploadedFileIds, files: uploadedFiles }
}

/**
 * Completes the file upload process by associating files with a channel
 */
export async function completeSlackFileUpload(
  uploadedFileIds: string[],
  channel: string,
  text: string,
  accessToken: string,
  threadTs?: string | null
): Promise<{ ok: boolean; files?: any[]; error?: string }> {
  const response = await fetch('https://slack.com/api/files.completeUploadExternal', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      files: uploadedFileIds.map((id) => ({ id })),
      channel_id: channel,
      initial_comment: text,
      ...(threadTs && { thread_ts: threadTs }),
    }),
  })

  return response.json()
}

/**
 * Creates a message object for file uploads
 */
export function createFileMessageObject(
  text: string,
  channel: string,
  files: any[]
): Record<string, any> {
  const fileTs = files?.[0]?.created?.toString() || (Date.now() / 1000).toString()
  return {
    type: 'message',
    ts: fileTs,
    text,
    channel,
    files: files?.map((file: any) => ({
      id: file?.id,
      name: file?.name,
      mimetype: file?.mimetype,
      size: file?.size,
      url_private: file?.url_private,
      permalink: file?.permalink,
    })),
  }
}

/**
 * Opens a DM channel with a user and returns the channel ID
 */
export async function openDMChannel(
  accessToken: string,
  userId: string,
  requestId: string,
  logger: Logger
): Promise<string> {
  const response = await fetch('https://slack.com/api/conversations.open', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      users: userId,
    }),
  })

  const data = await response.json()

  if (!data.ok) {
    logger.error(`[${requestId}] Failed to open DM channel:`, data.error)
    throw new Error(data.error || 'Failed to open DM channel with user')
  }

  logger.info(`[${requestId}] Opened DM channel: ${data.channel.id}`)
  return data.channel.id
}

export interface SlackMessageParams {
  accessToken: string
  channel?: string
  userId?: string
  text: string
  threadTs?: string | null
  files?: any[] | null
}

/**
 * Sends a Slack message with optional file attachments
 * Supports both channel messages and direct messages via userId
 */
export async function sendSlackMessage(
  params: SlackMessageParams,
  requestId: string,
  logger: Logger
): Promise<{
  success: boolean
  output?: {
    message: any
    ts: string
    channel: string
    fileCount?: number
    files?: ToolFileData[]
  }
  error?: string
}> {
  const { accessToken, text, threadTs, files } = params
  let { channel } = params

  if (!channel && params.userId) {
    logger.info(`[${requestId}] Opening DM channel for user: ${params.userId}`)
    channel = await openDMChannel(accessToken, params.userId, requestId, logger)
  }

  if (!channel) {
    return { success: false, error: 'Either channel or userId is required' }
  }

  // No files - simple message
  if (!files || files.length === 0) {
    logger.info(`[${requestId}] No files, using chat.postMessage`)

    const data = await postSlackMessage(accessToken, channel, text, threadTs)

    if (!data.ok) {
      logger.error(`[${requestId}] Slack API error:`, data.error)
      return { success: false, error: data.error || 'Failed to send message' }
    }

    logger.info(`[${requestId}] Message sent successfully`)
    return { success: true, output: formatMessageSuccessResponse(data, text) }
  }

  // Process files
  logger.info(`[${requestId}] Processing ${files.length} file(s)`)
  const { fileIds, files: uploadedFiles } = await uploadFilesToSlack(
    files,
    accessToken,
    requestId,
    logger
  )

  // No valid files uploaded - send text-only
  if (fileIds.length === 0) {
    logger.warn(`[${requestId}] No valid files to upload, sending text-only message`)

    const data = await postSlackMessage(accessToken, channel, text, threadTs)

    if (!data.ok) {
      return { success: false, error: data.error || 'Failed to send message' }
    }

    return { success: true, output: formatMessageSuccessResponse(data, text) }
  }

  // Complete file upload with thread support
  const completeData = await completeSlackFileUpload(fileIds, channel, text, accessToken, threadTs)

  if (!completeData.ok) {
    logger.error(`[${requestId}] Failed to complete upload:`, completeData.error)
    return { success: false, error: completeData.error || 'Failed to complete file upload' }
  }

  logger.info(`[${requestId}] Files uploaded and shared successfully`)

  const fileMessage = createFileMessageObject(text, channel, completeData.files || [])

  return {
    success: true,
    output: {
      message: fileMessage,
      ts: fileMessage.ts,
      channel,
      fileCount: fileIds.length,
      files: uploadedFiles,
    },
  }
}
