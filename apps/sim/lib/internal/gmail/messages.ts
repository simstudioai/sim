import type {
  GmailAddLabelBody,
  GmailArchiveBody,
  GmailDeleteBody,
  GmailMarkReadBody,
  GmailMarkUnreadBody,
  GmailMoveBody,
  GmailRemoveLabelBody,
  GmailUnarchiveBody,
} from '@/lib/api/contracts/tools/google'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { GmailClient, type JsonObject } from '@/lib/internal/gmail/client'
import { GmailOperationError } from '@/lib/internal/gmail/errors'

interface GmailMessageResultOptions {
  content: string
  data: JsonObject
}

function messageResult({ content, data }: GmailMessageResultOptions) {
  return {
    success: true,
    output: {
      content,
      metadata: { id: data.id, threadId: data.threadId, labelIds: data.labelIds },
    },
  }
}

function csv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function validateMessageAndLabels(messageId: string, labelIds: string[]): void {
  if (labelIds.length === 0) {
    const message = 'At least one label ID is required'
    throw new GmailOperationError(message, 400, { success: false, error: message })
  }
  for (const labelId of labelIds) {
    const validation = validateAlphanumericId(labelId, 'labelId', 255)
    if (!validation.isValid) {
      const message = validation.error || 'Invalid labelId'
      throw new GmailOperationError(message, 400, {
        success: false,
        error: message,
      })
    }
  }
  const validation = validateAlphanumericId(messageId, 'messageId', 255)
  if (!validation.isValid) {
    const message = validation.error || 'Invalid messageId'
    throw new GmailOperationError(message, 400, {
      success: false,
      error: message,
    })
  }
}

async function modifyMessage(
  input:
    | GmailAddLabelBody
    | GmailArchiveBody
    | GmailMarkReadBody
    | GmailMarkUnreadBody
    | GmailMoveBody
    | GmailRemoveLabelBody
    | GmailUnarchiveBody,
  body: { addLabelIds?: string[]; removeLabelIds?: string[] },
  content: string,
  signal?: AbortSignal
) {
  const client = new GmailClient(input.accessToken)
  const data = await client.json(
    client.api(`/messages/${encodeURIComponent(input.messageId)}/modify`),
    { method: 'POST', body: JSON.stringify(body) },
    signal
  )
  return messageResult({ content, data })
}

export function executeGmailArchive(input: GmailArchiveBody, signal?: AbortSignal) {
  return modifyMessage(input, { removeLabelIds: ['INBOX'] }, 'Email archived successfully', signal)
}

export function executeGmailMarkRead(input: GmailMarkReadBody, signal?: AbortSignal) {
  return modifyMessage(
    input,
    { removeLabelIds: ['UNREAD'] },
    'Email marked as read successfully',
    signal
  )
}

export function executeGmailMarkUnread(input: GmailMarkUnreadBody, signal?: AbortSignal) {
  return modifyMessage(
    input,
    { addLabelIds: ['UNREAD'] },
    'Email marked as unread successfully',
    signal
  )
}

export function executeGmailUnarchive(input: GmailUnarchiveBody, signal?: AbortSignal) {
  return modifyMessage(
    input,
    { addLabelIds: ['INBOX'] },
    'Email moved back to inbox successfully',
    signal
  )
}

export async function executeGmailDelete(input: GmailDeleteBody, signal?: AbortSignal) {
  const client = new GmailClient(input.accessToken)
  const data = await client.json(
    client.api(`/messages/${encodeURIComponent(input.messageId)}/trash`),
    { method: 'POST' },
    signal
  )
  return messageResult({ content: 'Email moved to trash successfully', data })
}

export function executeGmailAddLabel(input: GmailAddLabelBody, signal?: AbortSignal) {
  const labelIds = csv(input.labelIds)
  validateMessageAndLabels(input.messageId, labelIds)
  return modifyMessage(
    input,
    { addLabelIds: labelIds },
    `Successfully added ${labelIds.length} label(s) to email`,
    signal
  )
}

export function executeGmailRemoveLabel(input: GmailRemoveLabelBody, signal?: AbortSignal) {
  const labelIds = csv(input.labelIds)
  validateMessageAndLabels(input.messageId, labelIds)
  return modifyMessage(
    input,
    { removeLabelIds: labelIds },
    `Successfully removed ${labelIds.length} label(s) from email`,
    signal
  )
}

export function executeGmailMove(input: GmailMoveBody, signal?: AbortSignal) {
  const addLabelIds = csv(input.addLabelIds)
  const removeLabelIds = input.removeLabelIds ? csv(input.removeLabelIds) : []
  validateMessageAndLabels(input.messageId, addLabelIds)
  if (removeLabelIds.length > 0) {
    validateMessageAndLabels(input.messageId, removeLabelIds)
  }
  return modifyMessage(
    input,
    {
      ...(addLabelIds.length ? { addLabelIds } : {}),
      ...(removeLabelIds.length ? { removeLabelIds } : {}),
    },
    'Email moved successfully',
    signal
  )
}
