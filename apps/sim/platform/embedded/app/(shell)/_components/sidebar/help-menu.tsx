'use client'

import { useState } from 'react'
import { ActionMenu, type MenuAction } from '@/platform/design-system/components/menu/action-menu'
import { SupportModal } from '@/platform/embedded/app/(shell)/_components/sidebar/support-modal'
import { useHelp } from '@/platform/embedded/lib/data/shell-actions'
import { openLinkInNewTab } from '@/platform/embedded/lib/row-links'

export function HelpMenu() {
  const help = useHelp()
  const [contacting, setContacting] = useState(false)
  const { desktopUpdate, downloadUrl, changelogUrl } = help
  const actions: MenuAction[] = []
  if (desktopUpdate)
    actions.push({
      id: 'desktop-update',
      label: desktopUpdate.label,
      icon: 'I049',
      disabled: desktopUpdate.disabled,
      onSelect: desktopUpdate.run,
    })
  if (downloadUrl)
    actions.push({
      id: 'downloads',
      label: 'Download apps',
      icon: 'I102',
      separatorBefore: Boolean(desktopUpdate),
      children: [
        {
          id: 'macos',
          label: 'Sim for macOS',
          icon: 'I041',
          trailingIcon: 'I030',
          onSelect: () => openLinkInNewTab(downloadUrl),
        },
      ],
    })
  actions.push(
    {
      id: 'support',
      label: 'Contact support',
      icon: 'I047',
      separatorBefore: Boolean(desktopUpdate) && !downloadUrl,
      onSelect: () => setContacting(true),
    },
    {
      id: 'documentation',
      label: 'Documentation',
      icon: 'I082',
      trailingIcon: 'I030',
      onSelect: help.openDocumentation,
    },
    {
      id: 'slack',
      label: 'Join Slack',
      icon: 'I123',
      trailingIcon: 'I030',
      onSelect: help.joinSlack,
    }
  )
  if (changelogUrl)
    actions.push({
      id: 'changelog',
      label: 'Changelog',
      icon: 'I046',
      separatorBefore: true,
      onSelect: () => openLinkInNewTab(changelogUrl),
    })
  return (
    <>
      <ActionMenu
        label={desktopUpdate ? 'Help, update available' : 'Help'}
        triggerSize='row'
        icon={desktopUpdate ? 'I049' : 'I047'}
        actions={actions}
      />
      {contacting && <SupportModal onClose={() => setContacting(false)} />}
    </>
  )
}
