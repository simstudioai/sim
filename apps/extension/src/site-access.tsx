import { useEffect, useRef, useState } from 'react'
import { Chip, ChipModalBody, ChipModalField, ChipModalHeader, ChipModalSurface } from '@sim/emcn'
import { parseSiteAddress, readSitePermission, requiredSite, sitePattern } from '@/site-permissions'

interface SiteAccessDialogProps {
  onClose: () => void
  onAccessGranted: () => void
}

interface ActiveSite {
  tabId: number
  windowId: number
  origin?: string
}

async function getActiveSite(): Promise<ActiveSite | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.id === undefined || tab.incognito) return null
  const target = { tabId: tab.id, windowId: tab.windowId }
  if (!tab.url) return target
  const url = new URL(tab.url)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
  return { ...target, origin: url.origin }
}

/** Native modality avoids the inline scroll-lock stylesheet blocked by the extension CSP. */
function mountAccessDialog(dialog: HTMLDialogElement | null) {
  if (!dialog) return
  dialog.showModal()
  return () => dialog.close()
}

interface SitePermissionFormProps {
  site: ActiveSite
  onAccessGranted: () => void
}

function SitePermissionForm({ site, onAccessGranted }: SitePermissionFormProps) {
  const [address, setAddress] = useState('')
  const [chosenOrigin, setChosenOrigin] = useState<string>()
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [permission, setPermission] = useState<Awaited<ReturnType<typeof readSitePermission>>>()
  const origin = chosenOrigin ?? site.origin
  const target = origin ? new URL(origin) : parseSiteAddress(address)
  const grant = permission?.origin === origin ? permission : undefined
  const required = target && requiredSite(target)

  useEffect(() => {
    if (!origin) return
    let generation = 0
    const update = () => {
      const current = ++generation
      void readSitePermission(new URL(origin))
        .then((permission) => {
          if (current === generation) setPermission(permission)
        })
        .catch(() => {
          if (current === generation)
            setNotice('Could not check site access. Reopen the dialog to try again.')
        })
    }
    update()
    chrome.permissions.onAdded.addListener(update)
    chrome.permissions.onRemoved.addListener(update)
    return () => {
      generation++
      chrome.permissions.onAdded.removeListener(update)
      chrome.permissions.onRemoved.removeListener(update)
    }
  }, [origin])

  async function changeAccess() {
    if (!target || busy || required || (origin && !grant)) return
    setBusy(true)
    setNotice('')
    try {
      if (grant?.allowed) {
        if (!grant.removable.length) return
        await chrome.permissions.remove({ origins: grant.removable })
        const remaining = await readSitePermission(target)
        setPermission(remaining)
        if (!remaining.allowed) setChosenOrigin(undefined)
        setNotice(
          remaining.allowed ? 'Chrome still allows access to this site.' : 'Site access removed.'
        )
        return
      }
      if (!(await chrome.permissions.request({ origins: [sitePattern(target)] }))) {
        setNotice('Access was not granted. Click the Sim toolbar icon for one-time access.')
        return
      }
      setChosenOrigin(target.origin)
      setAddress('')
      const active = await getActiveSite()
      if (
        active?.tabId === site.tabId &&
        active.windowId === site.windowId &&
        active.origin === target.origin
      ) {
        onAccessGranted()
        setNotice('Access granted. Try attaching the page again.')
      } else {
        setNotice('Access granted for this address. Open that site to attach its page.')
      }
    } catch {
      setNotice('Could not change site access. Click the Sim toolbar icon for one-time access.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {!origin && (
        <ChipModalField
          type='input'
          title='Site address'
          value={address}
          placeholder='https://example.com'
          hint={
            address && !target
              ? 'Use an HTTP or HTTPS site address without credentials or wildcards.'
              : 'Paste the page address, or click the Sim toolbar icon for one-time access.'
          }
          autoComplete='off'
          maxLength={8192}
          onChange={(value) => {
            setAddress(value)
            setNotice('')
          }}
          onSubmit={() => void changeAccess()}
        />
      )}
      {required || (grant?.allowed && !grant.removable.length) ? (
        <p className='text-[var(--text-muted)] text-small'>Sim already has access to this site.</p>
      ) : (
        <Chip
          className='max-w-full'
          disabled={busy || !target || Boolean(origin && !grant)}
          onClick={() => void changeAccess()}
        >
          {`${grant?.allowed ? 'Remove access' : 'Allow access'}${target ? ` to ${target.origin}` : ''}`}
        </Chip>
      )}
      {grant?.allPorts && (
        <p className='text-[var(--text-muted)] text-small'>
          This existing grant covers all ports on the host.
        </p>
      )}
      {notice && (
        <p role='status' className='text-[var(--text-secondary)] text-small'>
          {notice}
        </p>
      )}
    </>
  )
}

export function SiteAccessDialog({ onClose, onAccessGranted }: SiteAccessDialogProps) {
  const [site, setSite] = useState<(ActiveSite & { revision: number }) | null>()
  const revision = useRef(0)
  useEffect(() => {
    let windowId: number | undefined
    const update = () => {
      const current = ++revision.current
      setSite(undefined)
      void getActiveSite()
        .catch(() => null)
        .then((next) => {
          if (revision.current === current) {
            windowId = next?.windowId
            setSite(next && { ...next, revision: current })
          }
        })
    }
    const activated = (info: chrome.tabs.OnActivatedInfo) => {
      if (windowId === undefined || info.windowId === windowId) update()
    }
    const navigated = (_id: number, change: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
      if (
        tab.active &&
        (windowId === undefined || tab.windowId === windowId) &&
        (change.url !== undefined || change.status === 'loading')
      )
        update()
    }
    update()
    chrome.tabs.onActivated.addListener(activated)
    chrome.tabs.onUpdated.addListener(navigated)
    return () => {
      revision.current++
      chrome.tabs.onActivated.removeListener(activated)
      chrome.tabs.onUpdated.removeListener(navigated)
    }
  }, [])

  return (
    <dialog
      ref={mountAccessDialog}
      aria-labelledby='site-access-title'
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
          <span id='site-access-title'>Site access</span>
        </ChipModalHeader>
        <ChipModalBody>
          {site && (
            <SitePermissionForm
              key={site.revision}
              site={site}
              onAccessGranted={() => {
                if (revision.current === site.revision) onAccessGranted()
              }}
            />
          )}
          {site === null && (
            <p className='text-[var(--text-muted)] text-small'>
              Open a web page to manage site access.
            </p>
          )}
        </ChipModalBody>
      </ChipModalSurface>
    </dialog>
  )
}
