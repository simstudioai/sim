import { useEffect, useState } from 'react'
import { Chip } from '@sim/emcn'
import { createRoot } from 'react-dom/client'
import { RECENT_PAGES_ENABLED_KEY, RECENT_PAGES_PERMISSIONS } from '@/config'
import '@/shell.css'

type Availability = 'loading' | 'off' | 'on'

async function readAvailability(): Promise<Availability> {
  const [granted, values] = await Promise.all([
    chrome.permissions.contains({ permissions: ['history'] }),
    chrome.storage.local.get(RECENT_PAGES_ENABLED_KEY),
  ])
  return granted && values[RECENT_PAGES_ENABLED_KEY] === true ? 'on' : 'off'
}

function RecentsSetup() {
  const [availability, setAvailability] = useState<Availability>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let revision = 0
    const update = () => {
      const current = ++revision
      void readAvailability().then((next) => {
        if (current === revision) setAvailability(next)
      })
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

  async function turnOn() {
    setMessage('')
    try {
      // Chrome needs this in the click's own task, before anything is awaited.
      const granted = await chrome.permissions.request({ permissions: RECENT_PAGES_PERMISSIONS })
      if (!granted) {
        setMessage('Chrome did not grant access, so nothing changed.')
        return
      }
      await chrome.storage.local.set({ [RECENT_PAGES_ENABLED_KEY]: true })
      setAvailability('on')
      setMessage('Your recent pages will appear on Sim Home. You can close this tab.')
    } catch {
      setMessage('Could not turn this on. Try again.')
    }
  }

  async function turnOff() {
    setMessage('')
    try {
      await chrome.storage.local.remove(RECENT_PAGES_ENABLED_KEY)
      await chrome.permissions.remove({ permissions: RECENT_PAGES_PERMISSIONS })
      setAvailability('off')
    } catch {
      setMessage('Could not turn this off. Try again.')
    }
  }

  return (
    <main className='mx-auto flex max-w-[560px] flex-col gap-4 px-6 py-10 text-[var(--text-primary)]'>
      <h1 className='font-medium text-lg'>Recent pages on Sim Home</h1>
      <p className='text-[var(--text-secondary)] text-sm'>
        See the pages you visited recently on your Sim Home, so you can get back to them in one
        click.
      </p>
      <p className='text-[var(--text-secondary)] text-sm'>
        Chrome will ask to read your browsing history, which covers your signed-in devices. It stays
        on this device: the extension hands Sim Home the addresses, titles and icons of up to 20
        recent pages to show you, and they are never sent to Sim's servers or stored by the
        extension.
      </p>
      <p className='text-[var(--text-secondary)] text-sm'>
        Sign-in pages, private and local addresses, and addresses that depend on a query string are
        left out.
      </p>
      <div className='flex items-center gap-2'>
        {availability === 'on' ? (
          <Chip onClick={() => void turnOff()}>Turn off</Chip>
        ) : (
          <Chip disabled={availability === 'loading'} onClick={() => void turnOn()}>
            Turn on
          </Chip>
        )}
      </div>
      {message && (
        <p role='status' className='text-[var(--text-secondary)] text-sm'>
          {message}
        </p>
      )}
    </main>
  )
}

const root = document.getElementById('root')
if (root) createRoot(root).render(<RecentsSetup />)
