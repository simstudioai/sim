'use client'

import { ActionMenu } from '@/platform/design-system/components/action-menu'

interface HelpMenuProps {
  iconOnly?: boolean
}

export function HelpMenu({ iconOnly }: HelpMenuProps) {
  function visit(url: string) {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
  return (
    <ActionMenu
      label='Help'
      icon={iconOnly ? 'I047' : undefined}
      actions={[
        {
          id: 'downloads',
          label: 'Download apps',
          icon: 'I102',
          children: [
            {
              id: 'macos',
              label: 'Sim for macOS',
              icon: 'I041',
              trailingIcon: 'I037',
              onSelect: () => visit('https://www.sim.ai/api/desktop/update/download'),
            },
          ],
        },
        {
          id: 'support',
          label: 'Contact support',
          icon: 'I047',
          onSelect: () => {
            window.location.href = 'mailto:help@sim.ai'
          },
        },
        {
          id: 'documentation',
          label: 'Documentation',
          icon: 'I079',
          trailingIcon: 'I037',
          onSelect: () => visit('https://docs.sim.ai'),
        },
        {
          id: 'changelog',
          label: 'Changelog',
          icon: 'I046',
          separatorBefore: true,
          onSelect: () => visit('https://www.sim.ai/changelog'),
        },
      ]}
    />
  )
}
