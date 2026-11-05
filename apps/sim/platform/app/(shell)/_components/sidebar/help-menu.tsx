'use client'

import { useState } from 'react'
import type { ShellHelp } from '@/platform/app/(shell)/_components/model'
import { openLinkInNewTab } from '@/platform/app/(shell)/_components/sidebar/row-links'
import { SupportModal } from '@/platform/app/(shell)/_components/sidebar/support-modal'
import { ActionMenu, type MenuAction } from '@/platform/design-system/components/menu/action-menu'

interface HelpMenuProps {
  help: ShellHelp
}

export function HelpMenu({ help }: HelpMenuProps) {
  const [contacting, setContacting] = useState(false)
  const { desktopUpdate, downloadUrl, changelogUrl } = help
  const actions: MenuAction[] = [
    ...(desktopUpdate
      ? [
          {
            id: 'desktop-update',
            label: desktopUpdate.label,
            icon: 'I049',
            disabled: desktopUpdate.disabled,
            onSelect: desktopUpdate.run,
          } satisfies MenuAction,
        ]
      : []),
    {
      id: 'documentation',
      label: 'Docs',
      icon: 'I079',
      trailingIcon: 'I030',
      separatorBefore: Boolean(desktopUpdate),
      onSelect: help.openDocumentation,
    },
    {
      id: 'slack',
      label: 'Join Slack',
      icon: 'I123',
      trailingIcon: 'I030',
      onSelect: help.joinSlack,
    },
    {
      id: 'support',
      label: 'Contact support',
      icon: 'I047',
      onSelect: () => setContacting(true),
    },
    ...(downloadUrl
      ? [
          {
            id: 'downloads',
            label: 'Download apps',
            icon: 'I102',
            separatorBefore: true,
            children: [
              {
                id: 'macos',
                label: 'Sim for macOS',
                icon: 'I041',
                trailingIcon: 'I030',
                onSelect: () => openLinkInNewTab(downloadUrl),
              },
            ],
          } satisfies MenuAction,
        ]
      : []),
    ...(changelogUrl
      ? [
          {
            id: 'changelog',
            label: 'Changelog',
            icon: 'I046',
            separatorBefore: !downloadUrl,
            onSelect: () => openLinkInNewTab(changelogUrl),
          } satisfies MenuAction,
        ]
      : []),
  ]
  return (
    <>
      <ActionMenu
        label={desktopUpdate ? 'Help, update available' : 'Help'}
        triggerSize='row'
        icon={desktopUpdate ? 'I049' : 'I047'}
        actions={actions}
      />
      {contacting && <SupportModal support={help.support} onClose={() => setContacting(false)} />}
    </>
  )
}
