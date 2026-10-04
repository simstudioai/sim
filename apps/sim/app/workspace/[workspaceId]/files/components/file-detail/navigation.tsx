'use client'

import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react'
import { ChipConfirmModal } from '@sim/emcn'
import { useRouter } from 'next/navigation'
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
  const [pendingUrl, setPendingUrl] = useState<string | null>(null)
  const setIsDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty
    updateIsDirty(dirty)
  }, [])
  const setSaveStatus = useCallback((status: SaveStatus) => {
    savingRef.current = status
    updateSaveStatus(status)
  }, [])
  const navigate = useCallback(
    (url: string) => {
      if (dirtyRef.current) setPendingUrl(url)
      else router.push(url)
    },
    [router]
  )
  const save = useCallback(async () => {
    if (saveRef.current && dirtyRef.current && savingRef.current !== 'saving') {
      await saveRef.current()
    }
  }, [])

  function discardAndNavigate() {
    if (!pendingUrl) return
    discardRef.current?.()
    setIsDirty(false)
    setSaveStatus('idle')
    setPendingUrl(null)
    router.push(pendingUrl)
  }

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
      <ChipConfirmModal
        open={pendingUrl !== null}
        onOpenChange={(open) => {
          if (!open) setPendingUrl(null)
        }}
        srTitle='Unsaved Changes'
        title='Unsaved Changes'
        text='You have unsaved changes. Are you sure you want to discard them?'
        dismissLabel='Keep editing'
        confirm={{ label: 'Discard Changes', onClick: discardAndNavigate }}
      />
    </FileNavigationContext.Provider>
  )
}

export function useFileNavigation(owner: EditableFileOwner) {
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
