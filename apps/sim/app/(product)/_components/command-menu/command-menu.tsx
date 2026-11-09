'use client'

import { CommandPalette } from '@sim/emcn/command-palette'
import { OverlayDialog } from '@sim/emcn/modal/overlay-dialog'
import { workspaceEntry } from '@/lib/navigation/paths'
import { useRegisteredPageCommands } from '@/app/(product)/_components/command-menu/page-commands'
import { platformDestinations } from '@/app/(product)/_components/destinations'
import type { ShellChat, ShellData } from '@/app/(product)/_components/model'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { useSurfaceScope } from '@/platform/lib/surface-scope'
import type { ShellDestination } from '@/platform/shared/shell'

/** Marks a page command's value apart from the hrefs every other entry navigates to. */
const COMMAND_PREFIX = 'command:'

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
  destinations,
}: CommandMenuProps) {
  const scope = useSurfaceScope()
  const pageCommands = useRegisteredPageCommands()
  return (
    <OverlayDialog label='Search' presentation='command' open={open} onClose={onClose}>
      <CommandPalette
        label='Search the platform'
        onSelect={(value) => {
          const command = value.startsWith(COMMAND_PREFIX)
            ? pageCommands.find((item) => `${COMMAND_PREFIX}${item.id}` === value)
            : undefined
          if (!command) return navigate(value)
          onClose()
          command.run()
        }}
        groups={[
          {
            label: 'This page',
            items: pageCommands.map((item) => ({
              id: item.id,
              label: item.label,
              value: `${COMMAND_PREFIX}${item.id}`,
            })),
          },
          { items: destinations ?? platformDestinations(scope) },
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
              value: item.href ?? surfaceHref(scope, `/chat/${item.id}`),
            })),
          },
        ]}
      />
    </OverlayDialog>
  )
}
