import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Chip,
  ChipModalBody,
  ChipModalDescription,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipModalSurface,
  Switch,
} from '@sim/emcn'
import {
  readSearchRecovery,
  SEARCH_RECOVERY_KEY,
  SEARCH_RECOVERY_PROVIDERS,
  setSearchRecovery,
} from '@/search-recovery'

interface SearchRecoveryDialogProps {
  onClose: () => void
}

type SearchProvider = (typeof SEARCH_RECOVERY_PROVIDERS)[number]
type SearchRecovery = Awaited<ReturnType<typeof readSearchRecovery>>

/** Chrome owns modality so the dialog works without an injected scroll-lock stylesheet. */
function mountSearchRecoveryDialog(dialog: HTMLDialogElement | null) {
  if (!dialog) return
  dialog.showModal()
  return () => dialog.close()
}

export function SearchRecoveryDialog({ onClose }: SearchRecoveryDialogProps) {
  const generation = useRef(0)
  const [settings, setSettings] = useState<SearchRecovery>()
  const [busyProvider, setBusyProvider] = useState<SearchProvider['id'] | null>(null)
  const [notices, setNotices] = useState<Partial<Record<SearchProvider['id'], string>>>({})
  const [loadError, setLoadError] = useState(false)

  const refresh = useCallback(async () => {
    const current = ++generation.current
    try {
      const next = await readSearchRecovery()
      if (current === generation.current) {
        setSettings(next)
        setLoadError(false)
      }
    } catch {
      if (current === generation.current) setLoadError(true)
    }
  }, [])

  useEffect(() => {
    const update = () => void refresh()
    const stored = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && SEARCH_RECOVERY_KEY in changes) update()
    }
    update()
    chrome.permissions.onAdded.addListener(update)
    chrome.permissions.onRemoved.addListener(update)
    chrome.storage.onChanged.addListener(stored)
    return () => {
      generation.current++
      chrome.permissions.onAdded.removeListener(update)
      chrome.permissions.onRemoved.removeListener(update)
      chrome.storage.onChanged.removeListener(stored)
    }
  }, [refresh])

  async function changeProvider(provider: SearchProvider, enabled: boolean) {
    if (!settings || busyProvider || loadError) return
    setBusyProvider(provider.id)
    setNotices((previous) => ({ ...previous, [provider.id]: '' }))
    try {
      if (enabled && !(await chrome.permissions.request({ origins: [...provider.origins] }))) {
        setNotices((previous) => ({
          ...previous,
          [provider.id]: 'Site access was not granted. This shortcut is still off.',
        }))
        return
      }
      await setSearchRecovery(provider.id, enabled)
      await refresh()
    } catch {
      setNotices((previous) => ({
        ...previous,
        [provider.id]: 'Could not change this shortcut. Try again.',
      }))
      await refresh()
    } finally {
      setBusyProvider(null)
    }
  }

  return (
    <dialog
      ref={mountSearchRecoveryDialog}
      aria-labelledby='search-recovery-title'
      aria-describedby='search-recovery-description'
      className='m-auto max-h-[85vh] w-[90vw] max-w-[440px] overflow-visible border-0 bg-transparent p-0 text-inherit backdrop:bg-black/10 backdrop:backdrop-blur-[2px]'
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <ChipModalSurface className='max-h-[85vh]'>
        <ChipModalHeader onClose={onClose}>
          <span id='search-recovery-title'>Browser shortcuts</span>
        </ChipModalHeader>
        <ChipModalBody>
          <ChipModalDescription id='search-recovery-description'>
            Send explicit sim/ searches to your Sim Links. Ordinary searches stay with your search
            engine.
          </ChipModalDescription>
          {SEARCH_RECOVERY_PROVIDERS.map((provider) => (
            <ChipModalField
              key={provider.id}
              type='custom'
              title={provider.label}
              titleActions={
                <Switch
                  aria-label={`${provider.label} sim/ shortcuts`}
                  aria-busy={busyProvider === provider.id}
                  checked={settings?.[provider.id] ?? false}
                  disabled={!settings || loadError || busyProvider !== null}
                  onCheckedChange={(enabled) => void changeProvider(provider, enabled)}
                />
              }
              hint={provider.origins.map((origin) => new URL(origin).origin).join(', ')}
              submitOnEnter={false}
            >
              {notices[provider.id] && (
                <p role='status' className='text-[var(--text-secondary)] text-caption'>
                  {notices[provider.id]}
                </p>
              )}
            </ChipModalField>
          ))}
          <p className='px-2 text-[var(--text-muted)] text-caption'>
            Chrome asks for access to the sites shown above. Page reference stays unchanged. Turning
            a shortcut off keeps site access.
          </p>
          {loadError && (
            <div className='flex flex-wrap items-center gap-2 px-2'>
              <p role='status' className='text-[var(--text-secondary)] text-caption'>
                Could not load browser shortcuts.
              </p>
              <Chip onClick={() => void refresh()}>Retry</Chip>
            </div>
          )}
        </ChipModalBody>
        <ChipModalFooter defaultAction='dismiss' cancelLabel='Done' onCancel={onClose} />
      </ChipModalSurface>
    </dialog>
  )
}
