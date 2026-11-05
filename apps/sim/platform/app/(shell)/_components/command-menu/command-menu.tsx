'use client'

import type {
  ShellChat,
  ShellDestination,
  ShellWorkspace,
} from '@/platform/app/(shell)/_components/model'
import { CommandPalette } from '@/platform/design-system/components/command-palette/command-palette'
import { OverlayDialog } from '@/platform/design-system/components/modal/overlay-dialog'
import { useSearchModalStore } from '@/stores/modals/search/store'

interface CommandMenuProps {
  navigate: (href: string) => void
  chats: readonly ShellChat[]
  workspaces: readonly ShellWorkspace[]
  destinations: readonly ShellDestination[]
}

/** The same store the desktop shell's View > Search toggles. Reads it here so the rail needn't. */
export function CommandMenu({ navigate, chats, workspaces, destinations }: CommandMenuProps) {
  const open = useSearchModalStore((state) => state.isOpen)
  const setOpen = useSearchModalStore((state) => state.setOpen)
  if (!open) return null
  return (
    <OverlayDialog label='Search' presentation='command' open onClose={() => setOpen(false)}>
      <CommandPalette
        label='Search the platform'
        onSelect={(href) => {
          setOpen(false)
          navigate(href)
        }}
        groups={[
          { items: destinations },
          {
            label: 'Workspaces',
            items: workspaces.map((item) => ({ id: item.id, label: item.name, value: item.href })),
          },
          {
            label: 'Chats',
            items: chats.map((item) => ({ id: item.id, label: item.title, value: item.href })),
          },
        ]}
      />
    </OverlayDialog>
  )
}
