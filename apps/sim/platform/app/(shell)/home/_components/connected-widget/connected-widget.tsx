'use client'

import { type ReactNode, useState } from 'react'
import styles from '@/platform/app/(shell)/home/_components/connected-widget/connected-widget.module.css'
import { HomeSection } from '@/platform/app/(shell)/home/_components/home-section/home-section'
import { ActionMenu, Button } from '@/platform/design-system/components'
import { Modal } from '@/platform/design-system/components/modal/modal'

const integrations = {
  Email: [
    { name: 'Gmail', icon: 'I005' },
    { name: 'Microsoft 365', icon: 'I085' },
  ],
  Calendar: [
    { name: 'Google Calendar', icon: 'I088' },
    { name: 'Outlook', icon: 'I120' },
  ],
} as const

interface ConnectedWidgetProps {
  title: keyof typeof integrations
  address?: string
  connected: boolean
  onConnectionChange: (connected: boolean) => void
  onHide: () => void
  children: ReactNode
}

export function ConnectedWidget({
  title,
  address,
  connected,
  onConnectionChange,
  onHide,
  children,
}: ConnectedWidgetProps) {
  const [disconnecting, setDisconnecting] = useState(false)
  const actions = [{ id: 'hide', label: `Hide ${title}`, onSelect: onHide }]
  if (connected)
    actions.push({
      id: 'disconnect',
      label: `Disconnect ${title}`,
      onSelect: () => setDisconnecting(true),
    })
  return (
    <HomeSection
      title={title}
      icon={title === 'Email' ? 'I005' : 'I088'}
      actions={<ActionMenu label={`${title} options`} icon='I108' align='end' actions={actions} />}
    >
      {connected ? (
        children
      ) : (
        <div className={styles.connect}>
          <p data-type='T067'>Connect your {title.toLowerCase()}</p>
          <div className={styles.providers}>
            {integrations[title].map(({ name, icon }) => (
              <Button
                key={name}
                size='compact'
                icon={icon}
                onClick={() => onConnectionChange(true)}
              >
                {name}
              </Button>
            ))}
          </div>
        </div>
      )}
      <Modal
        open={disconnecting}
        onOpenChange={setDisconnecting}
        variant='confirm'
        title={`Disconnect ${title}?`}
        confirmLabel='Disconnect'
        destructive
        description={`Sim will stop syncing ${title === 'Email' ? 'email' : 'calendar events'}${address ? ` from ${address}` : ''}. You can reconnect anytime.`}
        onConfirm={() => {
          onConnectionChange(false)
          setDisconnecting(false)
        }}
      />
    </HomeSection>
  )
}
