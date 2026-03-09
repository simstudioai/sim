import { useCallback, useRef, useState } from 'react'

interface UseInlineRenameProps {
  onSave: (id: string, newName: string) => void
}

export function useInlineRename({ onSave }: UseInlineRenameProps) {
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave

  const originalNameRef = useRef('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const startRename = useCallback((id: string, currentName: string) => {
    setEditingId(id)
    setEditValue(currentName)
    originalNameRef.current = currentName
  }, [])

  const submitRename = useCallback(() => {
    const id = editingId
    const trimmed = editValue.trim()
    setEditingId(null)
    if (!id || !trimmed || trimmed === originalNameRef.current) return
    onSaveRef.current(id, trimmed)
  }, [editingId, editValue])

  const cancelRename = useCallback(() => {
    setEditingId(null)
  }, [])

  return {
    editingId,
    editValue,
    setEditValue,
    startRename,
    submitRename,
    cancelRename,
  }
}
