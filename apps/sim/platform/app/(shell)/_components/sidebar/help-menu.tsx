'use client'

import { useState } from 'react'
import type { ShellHelp } from '@/platform/app/(shell)/_components/model'
import { SESSION_HELP } from '@/platform/app/(shell)/_components/session/shell-actions'
import { openLinkInNewTab } from '@/platform/app/(shell)/_components/sidebar/row-links'
import { SupportModal } from '@/platform/app/(shell)/_components/sidebar/support-modal'
import { ActionMenu, type MenuAction } from '@/platform/design-system/components/menu/action-menu'

interface HelpMenuProps {
  iconOnly?: boolean
  help?: ShellHelp
}

export function HelpMenu({ iconOnly, help = SESSION_HELP }: HelpMenuProps) {
  const [contacting, setContacting] = useState(false)
  const { support, desktopUpdate, downloadUrl, slackUrl, changelogUrl } = help
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
    ...(downloadUrl
      ? [
          {
            id: 'downloads',
            label: 'Download apps',
            icon: 'I102',
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
    {
      id: 'support',
      label: 'Contact support',
      icon: 'I047',
      onSelect: () => {
        if (support.submit) setContacting(true)
        else window.location.href = `mailto:${support.email}`
      },
    },
    {
      id: 'documentation',
      label: 'Documentation',
      icon: 'I079',
      trailingIcon: 'I030',
      onSelect: () => openLinkInNewTab(help.documentationUrl),
    },
    ...(slackUrl
      ? [
          {
            id: 'slack',
            label: 'Join Slack',
            icon: 'I123',
            trailingIcon: 'I030',
            onSelect: () => openLinkInNewTab(slackUrl),
          } satisfies MenuAction,
        ]
      : []),
    ...(changelogUrl
      ? [
          {
            id: 'changelog',
            label: 'Changelog',
            icon: 'I046',
            separatorBefore: true,
            onSelect: () => openLinkInNewTab(changelogUrl),
          } satisfies MenuAction,
        ]
      : []),
  ]
  return (
    <>
      <ActionMenu
        label='Help'
        triggerSize='row'
        icon={iconOnly ? 'I047' : null}
        actions={actions}
      />
      {support.submit && contacting && (
        <SupportModal support={support} onClose={() => setContacting(false)} />
      )}
    </>
  )
}
