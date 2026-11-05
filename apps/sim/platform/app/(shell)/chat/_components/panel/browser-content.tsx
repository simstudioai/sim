'use client'

import { type ReactNode, useState } from 'react'
import type { PanelData } from '@/platform/app/(shell)/chat/_components/panel/model'
import styles from '@/platform/app/(shell)/chat/_components/panel/panels.module.css'
import {
  BrowserActionsMenu,
  IconButton,
  Input,
  SearchField,
} from '@/platform/design-system/components'

interface BrowserContentProps {
  children: ReactNode
  website?: PanelData['website']
  initialAddress?: string
  showTools: boolean
}

export function BrowserContent({
  children,
  website,
  initialAddress,
  showTools,
}: BrowserContentProps) {
  const [history, setHistory] = useState(initialAddress ? ['', initialAddress] : [''])
  const [index, setIndex] = useState(initialAddress ? 1 : 0)
  const [zoom, setZoom] = useState(100)
  const [tool, setTool] = useState<'find' | 'downloads' | null>(null)
  const [query, setQuery] = useState('')
  const address = history[index]
  const sample =
    website && address.replace(/^https?:\/\//i, '').replace(/\/$/, '') === website.address
  function visit(value: string) {
    if (value === address) return
    setHistory([...history.slice(0, index + 1), value])
    setIndex(index + 1)
    setTool(null)
  }
  return (
    <>
      <div className={styles.browserTools} hidden={!showTools}>
        <IconButton
          label='Previous browser page'
          icon='I093'
          disabled={index === 0}
          onClick={() => setIndex(index - 1)}
        />
        <div className={styles.forward}>
          <IconButton
            label='Next browser page'
            icon='I093'
            disabled={index === history.length - 1}
            onClick={() => setIndex(index + 1)}
          />
        </div>
        <IconButton
          label='Reload page'
          icon='I065'
          disabled={!address}
          onClick={() => setTool(null)}
        />
        <form
          key={address}
          onSubmit={(event) => {
            event.preventDefault()
            visit(String(new FormData(event.currentTarget).get('address') ?? '').trim())
          }}
        >
          <Input
            label='Browser address'
            name='address'
            defaultValue={address}
            placeholder='Search or enter a URL'
          />
        </form>
        <BrowserActionsMenu
          zoomPercent={zoom}
          onZoom={setZoom}
          onAction={(action) => {
            if (action === 'find' || action === 'downloads')
              setTool(tool === action ? null : action)
            if (action === 'copy' && address)
              void navigator.clipboard?.writeText(address).catch(() => {})
          }}
        />
      </div>
      {showTools && tool && (
        <div className={styles.tool} data-type='T067'>
          {tool === 'find' ? (
            <>
              <SearchField label='Find on page' onValueChange={setQuery} />
              {query && (
                <output>
                  {sample && website.name.toLowerCase().includes(query.toLowerCase())
                    ? '1 match'
                    : 'No matches'}
                </output>
              )}
            </>
          ) : (
            <span>No downloads</span>
          )}
          <IconButton label='Close browser tool' icon='I105' onClick={() => setTool(null)} />
        </div>
      )}
      {address ? (
        <div className={styles.website} data-zoom={zoom}>
          {sample ? (
            <img src={website.image} alt={`${website.name} homepage`} />
          ) : (
            <p data-type='T067'>Page unavailable.</p>
          )}
        </div>
      ) : (
        children
      )}
    </>
  )
}
