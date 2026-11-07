import { CommandPalette } from '@sim/emcn/command-palette'
import { OverlayDialog } from '@sim/emcn/modal/overlay-dialog'
import { PLATFORM_DESTINATIONS } from '@/platform/app/(shell)/_components/destinations'
import type {
  ShellChat,
  ShellData,
  ShellDestination,
} from '@/platform/app/(shell)/_components/model'
import { workspaceEntry } from '@/platform/lib/workspace-navigation'

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
              value: item.href ?? workspaceEntry(item.id),
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
