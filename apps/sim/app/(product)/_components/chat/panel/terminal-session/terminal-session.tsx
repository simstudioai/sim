'use client'

import { useState } from 'react'
import { PointActionMenu } from '@sim/emcn/menu/action-menu'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { useRouter } from 'next/navigation'
import styles from '@/app/(product)/_components/chat/panel/terminal-session/terminal-session.module.css'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { useTerminalSession, useTerminalView } from '@/platform/lib/data/terminal-panel'
import { useSurfaceScope } from '@/platform/lib/surface-scope'

type Session = ReturnType<typeof useTerminalSession>

interface TerminalViewProps {
  terminalId: string
  scopeId: string
  active: boolean
  visible: boolean
  session: Session
}

function TerminalView({ terminalId, scopeId, active, visible, session }: TerminalViewProps) {
  const router = useRouter()
  const scope = useSurfaceScope()
  const view = useTerminalView({
    terminalId,
    scopeId,
    onscreen: active && visible,
    appearanceTheme: session.appearanceTheme,
    defaultZoom: session.defaultZoom,
  })
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null)
  const themeRow = (option: Session['themes'][number]) => ({
    id: option.id,
    label: option.label,
    checked: option.checked,
    disabled: session.themePending,
    onSelect: option.select,
  })
  return (
    <>
      <div
        ref={view.hostRef}
        className={styles.view}
        hidden={!active}
        data-paste-max-bytes={view.pasteLimit}
        onPointerDown={view.focus}
        onContextMenu={(event) => {
          // Electron's own editable-field menu would target xterm's offscreen textarea.
          event.preventDefault()
          view.captureSelection()
          setPoint({ x: event.clientX, y: event.clientY })
        }}
      />
      <PointActionMenu
        label='Terminal actions'
        point={point}
        onClose={() => setPoint(null)}
        actions={[
          { id: 'copy', label: 'Copy', disabled: !view.hasSelection, onSelect: view.copy },
          { id: 'paste', label: 'Paste', onSelect: view.paste },
          { id: 'clear', label: 'Clear', onSelect: view.clear },
          {
            id: 'zoom',
            label: 'Zoom',
            separatorBefore: true,
            children: [
              { id: 'zoom-in', label: 'Zoom in', onSelect: () => view.zoom('in') },
              { id: 'zoom-out', label: 'Zoom out', onSelect: () => view.zoom('out') },
              { id: 'zoom-reset', label: 'Actual size', onSelect: () => view.zoom('reset') },
            ],
          },
          {
            id: 'theme',
            label: 'Theme',
            children: [themeRow(session.themes[0]), ...session.themes.slice(1).map(themeRow)],
          },
          {
            id: 'new',
            label: 'New terminal',
            separatorBefore: true,
            onSelect: session.newTerminal,
          },
          { id: 'close', label: 'Close terminal', onSelect: () => session.close(terminalId) },
          {
            id: 'settings',
            label: 'Terminal settings',
            separatorBefore: true,
            onSelect: () => router.push(surfaceHref(scope, '/settings/terminal')),
          },
        ]}
      />
    </>
  )
}

interface TerminalSessionProps {
  scopeId: string
  /** Whether a terminal tab is on screen in an open panel. */
  visible: boolean
}

/**
 * The chat's desktop shells in a panel tab. Nothing native is overlaid here: xterm renders each
 * PTY in the DOM, and every shell stays mounted so its scrollback survives a switch.
 */
export function TerminalSession({ scopeId, visible }: TerminalSessionProps) {
  const session = useTerminalSession({ scopeId, visible })
  return (
    <div ref={session.panelRef} className={styles.session}>
      {session.tabs.map((terminalId) => (
        <TerminalView
          key={terminalId}
          terminalId={terminalId}
          scopeId={scopeId}
          active={terminalId === session.activeTerminalId}
          visible={visible}
          session={session}
        />
      ))}
      <ConfirmDialog
        target={session.closing}
        onClose={session.cancelClose}
        title={(request) => request.title}
        description={(request) => request.description}
        confirmLabel='Close terminal'
        pendingLabel='Closing…'
        onConfirm={session.confirmClose}
      />
    </div>
  )
}
