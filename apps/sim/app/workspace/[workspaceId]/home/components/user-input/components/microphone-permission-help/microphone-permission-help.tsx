'use client'

import { useId } from 'react'
import { ChipModal, ChipModalBody, ChipModalHeader } from '@sim/emcn'

interface MicrophonePermissionHelpProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Shows browser recovery steps and reports every dismissal path through `onOpenChange`. */
export function MicrophonePermissionHelp({ open, onOpenChange }: MicrophonePermissionHelpProps) {
  const descriptionId = useId()
  const handleClose = () => onOpenChange(false)

  return (
    <ChipModal
      open={open}
      onOpenChange={onOpenChange}
      srTitle='Allow microphone access'
      aria-describedby={descriptionId}
      size='sm'
    >
      <ChipModalHeader onClose={handleClose}>Allow microphone access</ChipModalHeader>
      <ChipModalBody>
        <p id={descriptionId} className='px-2 text-[var(--text-secondary)] text-sm'>
          Once microphone access is blocked, your browser requires you to change it from the site
          controls.
        </p>
        <ol className='mx-2 flex list-decimal flex-col gap-2 pl-5 text-[var(--text-body)] text-sm'>
          <li>Open the site controls beside the address bar.</li>
          <li>Set Microphone access for this site to Allow.</li>
          <li>Reload the page if prompted, then try voice input again.</li>
        </ol>
        <p className='px-2 text-[var(--text-tertiary)] text-sm'>
          In Safari, open Safari Settings, then Websites, then Microphone.
        </p>
      </ChipModalBody>
    </ChipModal>
  )
}
