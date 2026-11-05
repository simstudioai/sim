import { PLATFORM_DESTINATIONS } from '@/platform/app/(shell)/_components/destinations'
import type {
  ShellChat,
  ShellData,
  ShellDestination,
} from '@/platform/app/(shell)/_components/model'
import { CommandPalette } from '@/platform/design-system/components/command-palette/command-palette'
import { OverlayDialog } from '@/platform/design-system/components/modal/overlay-dialog'

interface CommandMenuProps {
  open: boolean
  onClose: () => void
  navigate: (href: string) => void
  chats: readonly ShellChat[]
  workspaces: ShellData['workspaces']
  destinations?: readonly ShellDestination[]
}

export function CommandMenu({
  open,
  onClose,
  navigate,
  chats,
  workspaces,
  destinations = PLATFORM_DESTINATIONS,
}: CommandMenuProps) {
  return (
    <OverlayDialog label='Search' presentation='command' open={open} onClose={onClose}>
      <CommandPalette
        label='Search the platform'
        onSelect={navigate}
        groups={[
          { items: destinations },
          {
            label: 'Workspaces',
            items: workspaces.map((item) => ({
              id: item.id,
              label: item.name,
              value: item.href ?? '/home',
            })),
          },
          {
            label: 'Chats',
            items: chats.map((item) => ({
              id: item.id,
              label: item.title,
              value: item.href ?? `/chat/${item.id}`,
            })),
          },
        ]}
      />
    </OverlayDialog>
  )
}
