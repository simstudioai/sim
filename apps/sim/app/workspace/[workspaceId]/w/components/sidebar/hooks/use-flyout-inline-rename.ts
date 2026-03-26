import { useCallback, useEffect, useRef, useState } from 'react'

interface RenameTarget {
  id: string
  name: string
}

interface UseFlyoutInlineRenameProps {
  onSave: (id: string, name: string) => Promise<void>
}

export function useFlyoutInlineRename({ onSave }: UseFlyoutInlineRenameProps) {
  const [editingTarget, setEditingTarget] = useState<RenameTarget | null>(null)
  const [value, setValue] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelRequestedRef = useRef(false)

  useEffect(() => {
    if (editingTarget && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingTarget])

  const startRename = useCallback((target: RenameTarget) => {
    cancelRequestedRef.current = false
    setEditingTarget(target)
    setValue(target.name)
  }, [])

  const cancelRename = useCallback(() => {
    cancelRequestedRef.current = true
    setEditingTarget(null)
  }, [])

  const saveRename = useCallback(async () => {
    if (cancelRequestedRef.current) {
      cancelRequestedRef.current = false
      return
    }

    if (!editingTarget) {
      return
    }

    const trimmedValue = value.trim()
    if (!trimmedValue || trimmedValue === editingTarget.name) {
      setEditingTarget(null)
      return
    }

    setIsSaving(true)
    try {
      await onSave(editingTarget.id, trimmedValue)
      setEditingTarget(null)
    } finally {
      setIsSaving(false)
    }
  }, [editingTarget, onSave, value])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void saveRename()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cancelRename()
      }
    },
    [cancelRename, saveRename]
  )

  return {
    editingId: editingTarget?.id ?? null,
    value,
    setValue,
    isSaving,
    inputRef,
    startRename,
    cancelRename,
    saveRename,
    handleKeyDown,
  }
}
