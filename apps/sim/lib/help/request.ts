import { createLogger } from '@sim/logger'
import type { HelpFormBody } from '@/lib/api/contracts/common'

const logger = createLogger('HelpRequest')

const MAX_HELP_IMAGE_BYTES = 20 * 1024 * 1024
const TARGET_SIZE_MB = 2
export const ACCEPTED_HELP_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]

export const HELP_REQUEST_TYPE_OPTIONS: { label: string; value: HelpFormBody['type'] }[] = [
  { label: 'Bug report', value: 'bug' },
  { label: 'Feedback', value: 'feedback' },
  { label: 'Feature request', value: 'feature_request' },
  { label: 'Other', value: 'other' },
]

/** Why `file` cannot be attached to a help request, or null when it can. */
export function validateHelpImage(file: Pick<File, 'size' | 'type'>): string | null {
  if (file.size > MAX_HELP_IMAGE_BYTES) return 'Images must be 20MB or smaller.'
  if (!ACCEPTED_HELP_IMAGE_TYPES.includes(file.type))
    return 'Attach a JPEG, PNG, WebP or GIF image.'
  return null
}

export async function compressHelpImage(file: File): Promise<File> {
  if (file.size < TARGET_SIZE_MB * 1024 * 1024 || file.type === 'image/gif') {
    return file
  }

  try {
    const { default: imageCompression } = await import('browser-image-compression')
    const compressedFile = await imageCompression(file, {
      maxSizeMB: TARGET_SIZE_MB,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
      fileType: file.type,
      initialQuality: 0.8,
      alwaysKeepResolution: true,
    })

    return new File([compressedFile], file.name, {
      type: file.type,
      lastModified: Date.now(),
    })
  } catch (error) {
    logger.warn('Image compression failed, using original file:', { error })
    return file
  }
}

interface SubmitHelpRequestInput {
  data: HelpFormBody
  images: readonly File[]
  workflowId?: string
  workspaceId?: string
}

export async function submitHelpRequest({
  data,
  images,
  workflowId,
  workspaceId,
}: SubmitHelpRequestInput): Promise<void> {
  const formData = new FormData()
  formData.append('subject', data.subject)
  formData.append('message', data.message)
  formData.append('type', data.type)
  if (workspaceId) formData.append('workspaceId', workspaceId)
  formData.append('userAgent', navigator.userAgent)
  if (workflowId) {
    formData.append('workflowId', workflowId)
  }

  images.forEach((image, index) => {
    formData.append(`image_${index}`, image)
  })

  // boundary-raw-fetch: multipart/form-data submission with image attachments, requestJson only supports JSON bodies
  const response = await fetch('/api/help', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => null)
    throw new Error(errorData?.error || 'Failed to submit help request')
  }
}
