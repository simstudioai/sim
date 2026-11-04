'use client'

import { type ReactNode, useState } from 'react'
import {
  BrowserActionsMenu,
  IconButton,
  Input,
  SearchField,
} from '@/platform/design-system/components'
import styles from '@/platform/design-system/features/chat/panels/panels.module.css'
import type { PanelData } from '@/platform/design-system/models/panel'

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
  const [tool, setTool] = useState<'find' | 'downloads' | 'open' | null>(null)
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
          label='Reload preview'
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
            if (action === 'find' || action === 'downloads' || action === 'open')
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
            <span>
              {tool === 'open'
                ? 'Opening an external browser is unavailable in this preview.'
                : 'No downloads'}
            </span>
          )}
          <IconButton label='Close browser tool' icon='I105' onClick={() => setTool(null)} />
        </div>
      )}
      {address ? (
        <div className={styles.website} data-zoom={zoom}>
          {sample ? (
            <img src={website.image} alt={`${website.name} homepage`} />
          ) : (
            <p data-type='T067'>No preview is available for this address.</p>
          )}
        </div>
      ) : (
        children
      )}
    </>
  )
}
