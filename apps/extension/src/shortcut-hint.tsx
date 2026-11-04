import { useEffect, useState } from 'react'
import { OPEN_SIM_COMMAND } from '@/config'

/** Reads the binding in this Chrome profile, including changes made in the shortcut settings. */
export function ShortcutHint() {
  const [shortcut, setShortcut] = useState<string | null>(null)
  useEffect(() => {
    let revision = 0
    const read = () => {
      const current = ++revision
      void chrome.commands
        .getAll()
        .then((commands) => {
          if (current === revision)
            setShortcut(commands.find((entry) => entry.name === OPEN_SIM_COMMAND)?.shortcut ?? '')
        })
        .catch(() => {
          if (current === revision) setShortcut(null)
        })
    }
    read()
    window.addEventListener('focus', read)
    return () => {
      revision++
      window.removeEventListener('focus', read)
    }
  }, [])
  if (shortcut === null) return null
  return (
    <p className='mt-1'>
      {shortcut ? (
        <>
          For one-time access, press <kbd>{shortcut}</kbd> on the page.
        </>
      ) : (
        <button
          type='button'
          className='underline underline-offset-2'
          onClick={() => {
            void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })
          }}
        >
          Set shortcut
        </button>
      )}
    </p>
  )
}
