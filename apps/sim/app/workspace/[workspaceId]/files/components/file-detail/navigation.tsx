'use client'

import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSettingsUnsavedGuard } from '@/components/settings/use-settings-unsaved-guard'
import type { FileDownloadSource } from '@/lib/uploads/client/download'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface FileNavigationController {
  owner: EditableFileOwner
  fileId: string | null
  saveRef: React.MutableRefObject<(() => Promise<void>) | null>
  discardRef: React.MutableRefObject<(() => void) | null>
  downloadSourceRef: React.MutableRefObject<FileDownloadSource | null>
  isDirty: boolean
  saveStatus: SaveStatus
  setIsDirty: (dirty: boolean) => void
  setSaveStatus: (status: SaveStatus) => void
  navigate: (url: string) => void
  save: () => Promise<void>
}

const FileNavigationContext = createContext<FileNavigationController | null>(null)

interface FileNavigationProviderProps {
  owner: EditableFileOwner
  fileId: string | null
  children: ReactNode
}

/** One draft scope surrounds both owner tabs and the current file's detail view. */
export function FileNavigationProvider({ owner, fileId, children }: FileNavigationProviderProps) {
  const saveRef = useRef<(() => Promise<void>) | null>(null)
  const discardRef = useRef<(() => void) | null>(null)
  const downloadSourceRef = useRef<FileDownloadSource | null>(null)
  const dirtyRef = useRef(false)
  const savingRef = useRef<SaveStatus>('idle')
  const router = useRouter()
  const [isDirty, updateIsDirty] = useState(false)
  const [saveStatus, updateSaveStatus] = useState<SaveStatus>('idle')
  const setIsDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty
    updateIsDirty(dirty)
  }, [])
  const setSaveStatus = useCallback((status: SaveStatus) => {
    savingRef.current = status
    updateSaveStatus(status)
  }, [])
  const { guardBack } = useSettingsUnsavedGuard({
    isDirty,
    navigationBlocked: saveStatus === 'saving',
    onDiscard: () => {
      discardRef.current?.()
      setIsDirty(false)
      setSaveStatus('idle')
    },
  })
  const navigate = useCallback(
    (url: string) => guardBack(() => router.push(url)),
    [guardBack, router]
  )
  const save = useCallback(async () => {
    if (saveRef.current && dirtyRef.current && savingRef.current !== 'saving') {
      await saveRef.current()
    }
  }, [])

  return (
    <FileNavigationContext.Provider
      value={{
        owner,
        fileId,
        saveRef,
        discardRef,
        downloadSourceRef,
        isDirty,
        saveStatus,
        setIsDirty,
        setSaveStatus,
        navigate,
        save,
      }}
    >
      {children}
    </FileNavigationContext.Provider>
  )
}

interface UseFileNavigationProps {
  owner: EditableFileOwner
}

export function useFileNavigation({ owner }: UseFileNavigationProps) {
  const controller = useContext(FileNavigationContext)
  if (
    !controller ||
    controller.owner.entityType !== owner.entityType ||
    controller.owner.entityId !== owner.entityId
  ) {
    throw new Error('File navigation requires its explicit owner scope')
  }
  return controller
}
