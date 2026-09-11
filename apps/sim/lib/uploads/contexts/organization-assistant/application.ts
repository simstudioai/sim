import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { uploadSession } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import sharp from 'sharp'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getServeStoragePrefix } from '@/lib/uploads/config'
import {
  assertOrganizationAttachmentControlBinding,
  organizationAttachmentBinding,
} from '@/lib/uploads/contexts/organization-assistant/binding'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import {
  ASSISTANT_IMAGE_MAX_BYTES,
  isAssistantImageType,
} from '@/lib/uploads/shared/assistant-images'
import { createUploadSession, type UploadSessionRecord } from '@/lib/uploads/upload-session/service'

const organizationAttachmentOperation = defineOrganizationOperation({
  id: 'organization.assistant.attachments.use',
  minimumRole: 'member',
  principalKinds: ['session'],
  capability: 'copilot.use',
})

const MAX_ASSISTANT_IMAGE_PIXELS = 25_000_000

export interface CreateOrganizationAssistantAttachmentInput {
  organizationId: string
  name: string
  contentType: string
  size: number
  localOrigin: string
}

export async function createOrganizationAssistantAttachment(
  principal: Principal,
  input: CreateOrganizationAssistantAttachmentInput
) {
  const context = await authorizeOrganizationOperation(
    principal,
    organizationAttachmentOperation,
    input
  )
  return createUploadSession({
    purpose: 'mothership_attachment',
    principal,
    organizationId: context.organizationId,
    userId: context.userId,
    fileName: input.name,
    contentType: input.contentType,
    fileSize: input.size,
    localOrigin: input.localOrigin,
  })
}

export async function authorizeOrganizationAttachmentControl(
  principal: Principal,
  session: UploadSessionRecord
): Promise<void> {
  const binding = assertOrganizationAttachmentControlBinding(session, principal)
  await authorizeOrganizationOperation(principal, organizationAttachmentOperation, binding)
}

/** A bounded decode removes active content, metadata, and animation before preview or model use. */
async function readImageBytes(key: string, contentType: string, signal?: AbortSignal) {
  if (!isAssistantImageType(contentType))
    throw new OrchestrationError('validation', 'Unsupported image type')
  const buffer = await downloadFile({
    key,
    context: 'mothership',
    maxBytes: ASSISTANT_IMAGE_MAX_BYTES,
    signal,
  })
  try {
    const image = sharp(buffer, { limitInputPixels: MAX_ASSISTANT_IMAGE_PIXELS, pages: 1 })
    const metadata = await image.metadata()
    if (!metadata.format || !['jpeg', 'png', 'gif', 'webp'].includes(metadata.format)) {
      throw new OrchestrationError(
        'validation',
        'Attachment must contain a PNG, JPEG, GIF, or WebP image'
      )
    }
    const normalized = await image
      .rotate()
      .resize(1568, 1568, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer()
    if (normalized.length > ASSISTANT_IMAGE_MAX_BYTES)
      throw new OrchestrationError('payload_too_large', 'Image exceeds the 5 MB limit')
    return normalized
  } catch (cause) {
    if (cause instanceof OrchestrationError) throw cause
    const error = new OrchestrationError('validation', 'Attachment is not a valid supported image')
    error.cause = cause
    throw error
  }
}

export async function finalizeOrganizationAssistantAttachment(
  principal: Principal,
  session: UploadSessionRecord
) {
  await authorizeOrganizationAttachmentControl(principal, session)
  await readImageBytes(session.finalKey, session.contentType)
  await authorizeOrganizationAttachmentControl(principal, session)
  return {
    path: `/api/files/serve/${getServeStoragePrefix()}/${encodeURIComponent(session.finalKey)}?context=mothership`,
    key: session.finalKey,
    name: session.fileName,
    size: session.fileSize,
    type: session.contentType,
  }
}

/** Resolves only completed images owned by the current user and their current organization. */
export async function readOrganizationAssistantImage(input: {
  principal: Principal
  organizationId?: string
  key: string
  signal?: AbortSignal
}) {
  if (input.principal.kind !== 'session')
    throw new OrchestrationError('not_found', 'Attachment not found')
  const keyParts = input.key.split('/')
  if (
    keyParts.length !== 5 ||
    keyParts[0] !== 'assistant' ||
    keyParts.some((part) => !part || part === '.' || part === '..')
  ) {
    throw new OrchestrationError('not_found', 'Attachment not found')
  }
  const [session] = await db
    .select({
      id: uploadSession.id,
      purpose: uploadSession.purpose,
      workspaceId: uploadSession.workspaceId,
      userId: uploadSession.userId,
      metadata: uploadSession.metadata,
      fileName: uploadSession.fileName,
      contentType: uploadSession.contentType,
      fileSize: uploadSession.fileSize,
      finalKey: uploadSession.finalKey,
    })
    .from(uploadSession)
    .where(
      and(
        eq(uploadSession.id, keyParts[3]),
        eq(uploadSession.finalKey, input.key),
        eq(uploadSession.userId, input.principal.userId),
        eq(uploadSession.purpose, 'mothership_attachment'),
        eq(uploadSession.status, 'completed'),
        isNull(uploadSession.workspaceId)
      )
    )
    .limit(1)
  if (!session) throw new OrchestrationError('not_found', 'Attachment not found')
  const binding = organizationAttachmentBinding(session)
  if (
    session.userId !== input.principal.userId ||
    keyParts[1] !== binding.organizationId ||
    keyParts[2] !== binding.userId ||
    (input.organizationId && input.organizationId !== binding.organizationId)
  ) {
    throw new OrchestrationError('not_found', 'Attachment not found')
  }
  await authorizeOrganizationOperation(input.principal, organizationAttachmentOperation, binding)
  if (session.fileSize > ASSISTANT_IMAGE_MAX_BYTES)
    throw new OrchestrationError('payload_too_large', 'Image exceeds the 5 MB limit')
  const buffer = await readImageBytes(session.finalKey, session.contentType, input.signal)
  return {
    id: session.id,
    key: session.finalKey,
    name: session.fileName,
    size: buffer.length,
    contentType: 'image/webp',
    buffer,
  }
}
