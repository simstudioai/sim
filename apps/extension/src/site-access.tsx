import { useEffect, useRef, useState } from 'react'
import { Chip, ChipModalBody, ChipModalHeader, ChipModalSurface } from '@sim/emcn'

const PAGE_ACCESS_ORIGINS = ['https://*/*', 'http://*/*']

interface PageAccessButtonProps {
  allowed?: boolean
  onAccessGranted: () => void
}

export function PageAccessButton({ allowed, onAccessGranted }: PageAccessButtonProps) {
  const mounted = useRef(false)
  const [status, setStatus] = useState<'idle' | 'requesting' | 'error'>('idle')

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  async function enable() {
    if (status === 'requesting') return
    setStatus('requesting')
    try {
      const granted = await chrome.permissions.request({ origins: PAGE_ACCESS_ORIGINS })
      if (!mounted.current) return
      if (granted) {
        setStatus('idle')
        onAccessGranted()
      } else setStatus('idle')
    } catch {
      if (mounted.current) setStatus('error')
    }
  }

  if (allowed) {
    return (
      <Chip
        onClick={() =>
          void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })
        }
      >
        Manage in browser
      </Chip>
    )
  }

  return (
    <span className='inline-flex flex-wrap items-center gap-2'>
      <Chip disabled={status === 'requesting'} onClick={() => void enable()}>
        Allow across websites
      </Chip>
      {status === 'error' && <span role='status'>Could not enable page access. Try again.</span>}
    </span>
  )
}

interface SiteAccessDialogProps {
  onClose: () => void
  onAccessGranted: () => void
}

/** Native modality avoids the inline scroll-lock stylesheet blocked by the extension CSP. */
function mountAccessDialog(dialog: HTMLDialogElement | null) {
  if (!dialog) return
  dialog.showModal()
  return () => dialog.close()
}

export function SiteAccessDialog({ onClose, onAccessGranted }: SiteAccessDialogProps) {
  const [allowed, setAllowed] = useState<boolean>()

  useEffect(() => {
    let revision = 0
    const update = () => {
      const current = ++revision
      void chrome.permissions.contains({ origins: PAGE_ACCESS_ORIGINS }).then(
        (next) => {
          if (current === revision) setAllowed(next)
        },
        () => {
          if (current === revision) setAllowed(false)
        }
      )
    }
    update()
    chrome.permissions.onAdded.addListener(update)
    chrome.permissions.onRemoved.addListener(update)
    return () => {
      revision++
      chrome.permissions.onAdded.removeListener(update)
      chrome.permissions.onRemoved.removeListener(update)
    }
  }, [])

  return (
    <dialog
      ref={mountAccessDialog}
      aria-labelledby='page-access-title'
      className='m-auto max-h-[85vh] w-[90vw] max-w-[440px] overflow-visible border-0 bg-transparent p-0 text-inherit backdrop:bg-black/10 backdrop:backdrop-blur-[2px]'
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <ChipModalSurface>
        <ChipModalHeader onClose={onClose}>
          <span id='page-access-title'>Page access</span>
        </ChipModalHeader>
        <ChipModalBody>
          <p className='text-[var(--text-muted)] text-small'>
            {allowed
              ? 'Page access is enabled across websites.'
              : 'Allow Sim to read pages across websites when you attach a page or send with page reference enabled.'}
          </p>
          <PageAccessButton allowed={allowed} onAccessGranted={onAccessGranted} />
        </ChipModalBody>
      </ChipModalSurface>
    </dialog>
  )
}
