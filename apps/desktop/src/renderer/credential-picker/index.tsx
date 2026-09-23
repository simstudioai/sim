import { useRef, useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { createRoot } from 'react-dom/client'
import { initializeShellPage } from '@/renderer/shell'
import type {
  CredentialPickerApi,
  CredentialPickerConfiguration,
} from '@/shared/browser-credentials'
import '@/renderer/shell.css'

const api = (window as Window & { simCredentialPicker?: CredentialPickerApi }).simCredentialPicker

interface CredentialPickerProps {
  configuration: CredentialPickerConfiguration
  api: CredentialPickerApi
}

function CredentialPicker({ configuration, api }: CredentialPickerProps) {
  const firstItem = useRef<HTMLDivElement>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const select = async (id: string) => {
    setPending(true)
    setError(null)
    try {
      const result = await api.select(id)
      if (result === 'filled') api.dismiss()
      else
        setError(
          result === 'stale-target'
            ? 'The form changed. Select the field again.'
            : 'Could not fill this form. Select the field again.'
        )
    } catch {
      setError('Could not fill this form. Select the field again.')
    } finally {
      setPending(false)
    }
  }
  return (
    <DropdownMenu
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) api.dismiss()
      }}
    >
      <DropdownMenuTrigger className='absolute top-0 left-0 size-0' tabIndex={-1} aria-hidden />
      <DropdownMenuContent
        align='start'
        sideOffset={0}
        avoidCollisions={false}
        className='w-[320px] max-w-none'
        aria-label='Saved passwords'
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          firstItem.current?.focus()
        }}
        onCloseAutoFocus={(event) => event.preventDefault()}
        ref={(element) => {
          if (!element) return
          const resize = () =>
            api.resize(element.offsetHeight + element.scrollHeight - element.clientHeight)
          const observer = new ResizeObserver(resize)
          observer.observe(element)
          resize()
          return () => observer.disconnect()
        }}
      >
        <DropdownMenuLabel>{new URL(configuration.origin).host}</DropdownMenuLabel>
        {configuration.accounts.map((account, index) => (
          <DropdownMenuItem
            ref={index === 0 ? firstItem : undefined}
            key={account.id}
            disabled={pending || error !== null}
            onSelect={(event) => {
              event.preventDefault()
              void select(account.id)
            }}
          >
            {account.username || 'No username'}
          </DropdownMenuItem>
        ))}
        {error && (
          <p role='alert' className='px-2 py-1 text-[var(--text-error)] text-xs'>
            {error}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const container = document.getElementById('root')
if (!container || !api) throw new Error('Credential picker unavailable')
void Promise.all([initializeShellPage(), api.configuration()]).then(([, configuration]) => {
  createRoot(container).render(<CredentialPicker configuration={configuration} api={api} />)
})
