'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn'

interface CreateWorkspaceModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (name: string) => Promise<void>
  isCreating: boolean
}

/**
 * Modal for naming a new workspace before creation.
 */
export function CreateWorkspaceModal({
  open,
  onOpenChange,
  onConfirm,
  isCreating,
}: CreateWorkspaceModalProps) {
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setName('')
    }
  }, [open])

  const handleSubmit = async () => {
    const trimmed = name.trim()
    if (!trimmed || isCreating) return
    await onConfirm(trimmed)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleSubmit()
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent
        size='sm'
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          inputRef.current?.focus()
        }}
      >
        <ModalHeader>Create Workspace</ModalHeader>
        <ModalBody>
          <Input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Workspace name'
            maxLength={100}
            autoComplete='off'
            autoCorrect='off'
            autoCapitalize='off'
            spellCheck={false}
            disabled={isCreating}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant='default' onClick={() => onOpenChange(false)} disabled={isCreating}>
            Cancel
          </Button>
          <Button
            variant='primary'
            onClick={() => void handleSubmit()}
            disabled={!name.trim() || isCreating}
          >
            {isCreating ? 'Creating...' : 'Create'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
