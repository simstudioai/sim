'use client'

import { useEffect, useRef, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { ShellSupport } from '@/platform/app/(shell)/_components/model'
import {
  AttachmentGrid,
  FileField,
  Modal,
  SelectField,
  TextAreaField,
  TextField,
} from '@/platform/design-system/components'

interface SupportImage {
  id: string
  file: File
  preview: string
}

interface SupportModalProps {
  support: Extract<ShellSupport, { submit: unknown }>
  onClose: () => void
}

function readText(values: FormData, name: string): string {
  const value = values.get(name)
  return typeof value === 'string' ? value.trim() : ''
}

export function SupportModal({ support, onClose }: SupportModalProps) {
  const [images, setImages] = useState<readonly SupportImage[]>([])
  const [imageError, setImageError] = useState<string>()
  const [processing, setProcessing] = useState(false)
  const previews = useRef(images)

  useEffect(() => {
    previews.current = images
  }, [images])

  useEffect(
    () => () => {
      for (const image of previews.current) URL.revokeObjectURL(image.preview)
    },
    []
  )

  async function attach(file: File) {
    setImageError(undefined)
    setProcessing(true)
    try {
      const prepared = await support.prepareImage(file)
      const image = { id: generateId(), file: prepared, preview: URL.createObjectURL(prepared) }
      setImages((previous) => [...previous, image])
    } catch (error) {
      setImageError(getErrorMessage(error, 'That image could not be attached.'))
    } finally {
      setProcessing(false)
    }
  }

  function detach(id: string) {
    const removed = images.find((image) => image.id === id)
    if (removed) URL.revokeObjectURL(removed.preview)
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
        const subject = readText(values, 'subject')
        const message = readText(values, 'message')
        if (!subject) throw new Error('Subject is required')
        if (!message) throw new Error('Message is required')
        await support.submit({
          type: readText(values, 'type'),
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
            preview: image.preview,
          }))}
          onRemove={detach}
        />
      )}
    </Modal>
  )
}
