import { PLATFORM_DESTINATIONS } from '@/platform/app/(shell)/_components/destinations'
import type { ShellData, ShellItem } from '@/platform/app/(shell)/_components/model'
import { CommandPalette } from '@/platform/design-system/components/command-palette/command-palette'
import { OverlayDialog } from '@/platform/design-system/components/modal/overlay-dialog'

interface CommandMenuProps {
  open: boolean
  onClose: () => void
  navigate: (href: string) => void
  chats: readonly ShellItem[]
  workspaces: ShellData['workspaces']
}

export function CommandMenu({ open, onClose, navigate, chats, workspaces }: CommandMenuProps) {
  return (
    <OverlayDialog label='Search' presentation='command' open={open} onClose={onClose}>
      <CommandPalette
        label='Search the platform'
        onSelect={navigate}
        groups={[
          { items: PLATFORM_DESTINATIONS },
          {
            label: 'Workspaces',
            items: workspaces.map((item) => ({
              id: item.id,
              label: item.name,
              value: '/home',
            })),
          },
          {
            label: 'Chats',
            items: chats.map((item) => ({
              id: item.id,
              label: item.title,
              icon: 'I073',
              value: `/chat/${item.id}`,
            })),
          },
        ]}
      />
    </OverlayDialog>
  )
}
