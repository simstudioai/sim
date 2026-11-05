'use client'

import { useState } from 'react'
import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import {
  ACCEPTED_HELP_IMAGE_TYPES,
  compressHelpImage,
  DEFAULT_HELP_REQUEST_TYPE,
  HELP_REQUEST_TYPE_OPTIONS,
  submitHelpRequest,
  validateHelpImage,
} from '@/lib/help/request'
import { readFormText } from '@/platform/app/(shell)/_components/sidebar/row-links'
import { AttachmentGrid } from '@/platform/design-system/components/attachments/attachment-grid'
import {
  SelectField,
  TextAreaField,
  TextField,
} from '@/platform/design-system/components/field/fields'
import { FileField } from '@/platform/design-system/components/field/file-field'
import { Modal } from '@/platform/design-system/components/modal/modal'

interface SupportImage {
  id: string
  file: File
}

interface SupportModalProps {
  onClose: () => void
}

export function SupportModal({ onClose }: SupportModalProps) {
  const [images, setImages] = useState<readonly SupportImage[]>([])
  const [imageError, setImageError] = useState<string>()
  const [processing, setProcessing] = useState(false)

  async function attach(file: File) {
    setImageError(undefined)
    setProcessing(true)
    try {
      const problem = validateHelpImage(file)
      if (problem) throw new Error(problem)
      const image = { id: generateId(), file: await compressHelpImage(file) }
      setImages((previous) => [...previous, image])
    } catch (error) {
      setImageError(getErrorMessage(error, 'That image could not be attached.'))
    } finally {
      setProcessing(false)
    }
  }

  function detach(id: string) {
    setImages((previous) => previous.filter((image) => image.id !== id))
  }

  return (
    <Modal
      open
      onOpenChange={onClose}
      title='Contact support'
      confirmLabel='Send'
      confirmDisabled={processing}
      onConfirm={async (values) => {
        const subject = readFormText(values, 'subject')
        const message = readFormText(values, 'message')
        if (!subject) throw new Error('Subject is required')
        if (!message) throw new Error('Message is required')
        const type = HELP_REQUEST_TYPE_OPTIONS.find(
          (option) => option.value === readFormText(values, 'type')
        )
        if (!type) throw new Error('Select a request type')
        await submitHelpRequest({
          data: { type: type.value, subject, message },
          images: images.map((image) => image.file),
        })
        toast.success('Request sent')
      }}
    >
      <SelectField
        label='Request'
        name='type'
        defaultValue={DEFAULT_HELP_REQUEST_TYPE}
        options={HELP_REQUEST_TYPE_OPTIONS}
      />
      <TextField
        label='Subject'
        name='subject'
        required
        placeholder='Brief description of your request'
      />
      <TextAreaField
        label='Message'
        name='message'
        required
        placeholder='Details about your request…'
      />
      <FileField
        label='Images'
        optional
        accept={ACCEPTED_HELP_IMAGE_TYPES.join(',')}
        disabled={processing}
        error={imageError}
        onFileChange={(file) => void attach(file)}
      />
      {images.length > 0 && (
        <AttachmentGrid
          label='Attached images'
          attachments={images.map((image) => ({
            id: image.id,
            kind: 'image',
            name: image.file.name,
            description: 'Image attachment',
            previewFile: image.file,
          }))}
          onRemove={detach}
        />
      )}
    </Modal>
  )
}
