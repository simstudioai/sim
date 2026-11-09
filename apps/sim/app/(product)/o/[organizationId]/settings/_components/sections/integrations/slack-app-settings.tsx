'use client'

import { Button } from '@sim/emcn/button'
import { Modal } from '@sim/emcn/modal'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { FieldStack, Muted } from '@/app/(product)/_components/settings-parts/settings-parts'
import { platformHref } from '@/platform/lib/navigation'

interface SlackAppSettingsProps {
  value: string | null
  close: () => void
  save: (app: string | null) => void
}

export function SlackAppSettings({ value, close, save }: SlackAppSettingsProps) {
  const search = useSearchParams()
  return (
    <Modal
      open
      title='Set up Slack app'
      confirmLabel={value ? 'Verify permissions' : 'Done'}
      onOpenChange={(open) => !open && close()}
      onConfirm={value ? () => save(value) : undefined}
    >
      <FieldStack>
        <Muted>
          {value
            ? `Installed in ${value}. Verify member permissions before members connect their Slack accounts.`
            : 'Install the Sim Search app in your Slack workspace to connect member accounts.'}
        </Muted>
        <Button
          size='compact'
          render={<Link href={platformHref('/settings/search-slack', search)} />}
        >
          {value ? 'Manage app' : 'Set up Sim Search in Slack'}
        </Button>
      </FieldStack>
    </Modal>
  )
}
