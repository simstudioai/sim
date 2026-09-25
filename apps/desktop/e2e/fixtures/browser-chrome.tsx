import { useEffect, useRef, useState } from 'react'
import type { BrowserPanelSnapshot } from '@sim/browser-protocol'
import type { SimDesktopApi } from '@sim/desktop-bridge'
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  TabStrip,
  Tooltip,
} from '@sim/emcn'
import { File } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'

const SCOPE = 'browser-chrome-fixture'

interface BrowserChromeFixtureProps {
  useOcclusion: (
    scopeId: string,
    activeTabId: string | null,
    visible: boolean,
    getHostRect: () => DOMRect | null
  ) => {
    snapshot: BrowserPanelSnapshot | null
    snapshotLayer: 'modal' | 'popover'
    onSnapshotError: () => void
  }
}

function reportPanelBounds(api: SimDesktopApi, host: HTMLDivElement | null) {
  const bounds = host?.getBoundingClientRect()
  if (!bounds) return
  api.browserAgent.setPanelBounds(
    { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    null,
    SCOPE
  )
}

function BrowserChromeFixture({ useOcclusion }: BrowserChromeFixtureProps) {
  const host = useRef<HTMLDivElement>(null)
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [selected, setSelected] = useState('tab-0')
  const [tabCount, setTabCount] = useState(8)
  const [error, setError] = useState<string | null>(null)
  const api = (globalThis as typeof globalThis & { simDesktop: SimDesktopApi }).simDesktop
  const { snapshot, snapshotLayer, onSnapshotError } = useOcclusion(
    SCOPE,
    activeTabId,
    true,
    () => host.current?.getBoundingClientRect() ?? null
  )

  const startBrowser = async () => {
    if (!api.browserAgent.openUrl) throw new Error('Native browser bridge is unavailable')
    await api.browserAgent.activateScope(SCOPE)
    const tabs = await api.browserAgent.openUrl(
      `${location.origin.replace('127.0.0.1', 'localhost')}/page`,
      SCOPE
    )
    setActiveTabId(tabs.activeTabId)
    reportPanelBounds(api, host.current)
  }

  useEffect(() => {
    const element = host.current
    if (!element) return
    const observer = new ResizeObserver(() => reportPanelBounds(api, element))
    observer.observe(element)
    const heartbeat = window.setInterval(() => reportPanelBounds(api, element), 1_000)
    return () => {
      window.clearInterval(heartbeat)
      observer.disconnect()
      api.browserAgent.setPanelBounds(null, null, SCOPE)
    }
  }, [api])

  return (
    <>
      <div className='flex gap-2 pt-[32px]'>
        <Button
          id='start-native'
          onClick={() => void startBrowser().catch((cause) => setError(getErrorMessage(cause)))}
        >
          Start browser
        </Button>
        <Button id='eight-tabs' onClick={() => setTabCount(8)}>
          Eight tabs
        </Button>
        <Button id='many-tabs' onClick={() => setTabCount(18)}>
          Many tabs
        </Button>
      </div>
      {error && <p role='alert'>{error}</p>}
      <TabStrip
        tabs={Array.from({ length: tabCount }, (_, index) => ({
          id: `tab-${index}`,
          title: `Example resource ${index + 1} with a descriptive title`,
          icon: <File className='size-[16px] shrink-0' />,
          active: selected === `tab-${index}`,
        }))}
        variant='floating'
        onSelect={setSelected}
        onClose={() => undefined}
        onNew={() => setTabCount((count) => count + 1)}
      />
      <div className='absolute top-[260px] left-[340px] w-[190px]'>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button id='reference'>Example reference</Button>
          </Tooltip.Trigger>
          <Tooltip.Content>
            A descriptive reference tooltip that extends across the browser boundary.
          </Tooltip.Content>
        </Tooltip.Root>
      </div>
      <div className='absolute top-[370px] left-[420px]'>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button id='menu-trigger'>Open menu</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start' className='w-[280px]'>
            <DropdownMenuItem id='plain-item'>Open example item</DropdownMenuItem>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <DropdownMenuItem id='tooltip-item'>Preview details</DropdownMenuItem>
              </Tooltip.Trigger>
              <Tooltip.Content>Additional details for this example menu item.</Tooltip.Content>
            </Tooltip.Root>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div
        ref={host}
        id='browser-host'
        className='absolute top-[160px] right-0 bottom-0 left-[550px]'
      />
      {snapshot &&
        createPortal(
          <img
            id='snapshot'
            src={snapshot.dataUrl}
            width={snapshot.viewportBounds?.width}
            height={snapshot.viewportBounds?.height}
            onError={onSnapshotError}
            className={cn(
              'pointer-events-none fixed top-[160px] left-[550px] max-w-none',
              snapshotLayer === 'modal'
                ? 'z-[calc(var(--z-modal)-1)]'
                : 'z-[calc(var(--z-dropdown)-1)]'
            )}
          />,
          document.body
        )}
    </>
  )
}

/** The real Sim hook is supplied by the bundle entry using Sim's module aliases. */
export function mountBrowserChromeFixture(useOcclusion: BrowserChromeFixtureProps['useOcclusion']) {
  const root = document.getElementById('root')
  if (!root) throw new Error('Missing fixture root')
  createRoot(root).render(<BrowserChromeFixture useOcclusion={useOcclusion} />)
}
