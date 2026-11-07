'use client'

import { useState } from 'react'
import { ActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import { openLinkInNewTab } from '@/app/o/[organizationId]/_redesign/rail/row-links'
import { useHelp } from '@/app/o/[organizationId]/_redesign/rail/shell-actions'
import { SupportModal } from '@/app/o/[organizationId]/_redesign/rail/support-modal'

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
  actions.push(
    {
      id: 'documentation',
      label: 'Docs',
      icon: 'I082',
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
    }
  )
  if (downloadUrl)
    actions.push({
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
    })
  if (changelogUrl)
    actions.push({
      id: 'changelog',
      label: 'Changelog',
      icon: 'I046',
      separatorBefore: !downloadUrl,
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
