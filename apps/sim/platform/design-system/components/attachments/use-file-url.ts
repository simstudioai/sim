'use client'
import { useEffect, useState } from 'react'

export function useFileUrl(file?: File) {
  const [resource, setResource] = useState<{ file: File; url: string }>()
  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setResource({ file, url })
    return () => URL.revokeObjectURL(url)
  }, [file])
  return resource?.file === file ? resource?.url : undefined
}
