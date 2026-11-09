'use client'

import { useState } from 'react'
import { AttachmentGrid } from '@sim/emcn/attachments'
import { SelectField, TextAreaField, TextField } from '@sim/emcn/field'
import { FileField } from '@sim/emcn/field/file-field'
import { Modal } from '@sim/emcn/modal'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { ShellSupport } from '@/app/(product)/_components/model'
import { readFormText } from '@/platform/shared/row-links'

interface SupportImage {
  id: string
  file: File
}

interface SupportModalProps {
  support: Extract<ShellSupport, { submit: unknown }>
  onClose: () => void
}

export function SupportModal({ support, onClose }: SupportModalProps) {
  const [images, setImages] = useState<readonly SupportImage[]>([])
  const [imageError, setImageError] = useState<string>()
  const [processing, setProcessing] = useState(false)

  async function attach(file: File) {
    setImageError(undefined)
    setProcessing(true)
    try {
      const prepared = await support.prepareImage(file)
      const image = { id: generateId(), file: prepared }
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
        await support.submit({
          type: readFormText(values, 'type'),
          subject,
          message,
          images: images.map((image) => image.file),
        })
      }}
    >
      <SelectField
        label='Request'
        name='type'
        defaultValue={support.requestTypes[0]?.value}
        options={support.requestTypes}
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
        placeholder='Please provide details about your request...'
      />
      <FileField
        label='Images'
        optional
        accept={support.imageAccept}
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
