'use client'

import { useId } from 'react'
import { ChipModal, ChipModalBody, ChipModalHeader } from '@sim/emcn'

interface MicrophonePermissionHelpProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

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
        <div className='flex flex-col gap-3 px-2 text-sm'>
          <p id={descriptionId} className='text-[var(--text-secondary)]'>
            Once microphone access is blocked, your browser requires you to change it from the site
            controls.
          </p>
          <ol className='flex list-decimal flex-col gap-2 pl-5 text-[var(--text-body)]'>
            <li>Open the site controls beside the address bar.</li>
            <li>Set Microphone access for this site to Allow.</li>
            <li>Reload the page if prompted, then try voice input again.</li>
          </ol>
          <p className='text-[var(--text-tertiary)]'>
            In Safari, open Safari Settings, then Websites, then Microphone.
          </p>
        </div>
      </ChipModalBody>
    </ChipModal>
  )
}
