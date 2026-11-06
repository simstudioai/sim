'use client'

import { useEffect, useState } from 'react'
import { FileField } from '@/platform/design-system/components'

interface FileFieldSpecimenProps {
  label: string
}

export function FileFieldSpecimen({ label }: FileFieldSpecimenProps) {
  const [selection, setSelection] = useState<{ name: string; previewSrc: string }>()
  useEffect(() => {
    return () => {
      if (selection) URL.revokeObjectURL(selection.previewSrc)
    }
  }, [selection])
  return (
    <FileField
      kind='image'
      label={label}
      optional
      accept='image/*'
      selection={selection}
      onFileChange={(file) =>
        setSelection({ name: file.name, previewSrc: URL.createObjectURL(file) })
      }
      onClear={() => setSelection(undefined)}
    />
  )
}
