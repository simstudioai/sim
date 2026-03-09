import { useCallback, useRef, useState } from 'react'

interface UseInlineRenameProps {
  onSave: (id: string, newName: string) => void
}

export function useInlineRename({ onSave }: UseInlineRenameProps) {
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave

  const originalNameRef = useRef('')
  const doneRef = useRef(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const startRename = useCallback((id: string, currentName: string) => {
    doneRef.current = false
    setEditingId(id)
    setEditValue(currentName)
    originalNameRef.current = currentName
  }, [])

  const submitRename = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    const id = editingId
    const trimmed = editValue.trim()
    setEditingId(null)
    if (!id || !trimmed || trimmed === originalNameRef.current) return
    onSaveRef.current(id, trimmed)
  }, [editingId, editValue])

  const cancelRename = useCallback(() => {
    doneRef.current = true
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
