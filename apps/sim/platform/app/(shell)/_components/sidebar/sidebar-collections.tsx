'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { ShellData, ShellItem } from '@/platform/app/(shell)/_components/model'
import { useChatChanges } from '@/platform/app/(shell)/_components/session/chat-changes'
import styles from '@/platform/app/(shell)/_components/sidebar/sidebar-collections.module.css'
import { useSidebarLayout } from '@/platform/app/(shell)/_components/sidebar/sidebar-layout'
import {
  ActionMenu,
  Chip,
  Disclosure,
  IconButton,
  Modal,
  TextField,
} from '@/platform/design-system/components'
import { platformHref } from '@/platform/design-system/navigation'

interface SidebarCollectionsProps {
  data: ShellData | null
  activeChat?: string
  navigate: (href: string) => void
}

export function SidebarCollections({ data, activeChat, navigate }: SidebarCollectionsProps) {
  const query = useSearchParams()
  const changes = useChatChanges()
  const { workspacesOpen, setWorkspacesOpen, chatsOpen, setChatsOpen, order, setOrder } =
    useSidebarLayout()
  const [editing, setEditing] = useState<{ action: 'Rename' | 'Archive'; chat: ShellItem } | null>(
    null
  )
  const chats = [...changes.created, ...(data?.chats ?? [])]
    .filter((item) => !changes.isRemoved(item.id))
    .map((item) => ({ ...item, title: changes.titleFor(item.id, item.title) }))
    .sort((a, b) => {
      if (order === 'Name (A–Z)') return a.title.localeCompare(b.title)
      if (order === 'Name (Z–A)') return b.title.localeCompare(a.title)
      return 0
    })

  return (
    <>
      <Disclosure
        variant='section'
        label='Workspaces'
        open={workspacesOpen}
        onOpenChange={setWorkspacesOpen}
        actions={
          <>
            <IconButton
              tooltip
              size='compact'
              label='Sort workspaces'
              icon='I050'
              onClick={() => navigate('/home')}
            />
            <IconButton
              tooltip
              size='compact'
              label='Add workspace'
              icon='I074'
              onClick={() => navigate('/home')}
            />
          </>
        }
      >
        <div className={styles.group}>
          {(data?.workspaces ?? []).map((item) => (
            <Chip
              key={item.id}
              href={platformHref('/home', query)}
              action={
                <ActionMenu
                  label={`Actions for ${item.name}`}
                  tooltip={false}
                  icon='I108'
                  triggerSize='compact'
                  align='end'
                  actions={[
                    { id: 'open', label: 'Open workspace', onSelect: () => navigate('/home') },
                  ]}
                />
              }
            >
              {item.name}
            </Chip>
          ))}
        </div>
      </Disclosure>
      <Disclosure
        variant='section'
        label='Chats'
        open={chatsOpen}
        onOpenChange={setChatsOpen}
        actions={
          <ActionMenu
            label='Sort chats'
            triggerSize='compact'
            icon='I050'
            actions={['Recent activity', 'Name (A–Z)', 'Name (Z–A)'].map((label) => ({
              id: label,
              label,
              checked: label === order,
              onSelect: () => setOrder(label),
            }))}
          />
        }
      >
        <div className={styles.group}>
          {chats.map((item) => (
            <Chip
              key={item.id}
              href={platformHref(`/chat/${item.id}`, query)}
              selected={activeChat === item.id}
              action={
                <ActionMenu
                  label={`Actions for ${item.title}`}
                  tooltip={false}
                  icon='I108'
                  triggerSize='compact'
                  align='end'
                  actions={[
                    {
                      id: 'rename',
                      label: 'Rename',
                      icon: 'I036',
                      onSelect: () => setEditing({ action: 'Rename', chat: item }),
                    },
                    {
                      id: 'archive',
                      destructive: true,
                      label: 'Archive',
                      icon: 'I061',
                      onSelect: () => setEditing({ action: 'Archive', chat: item }),
                    },
                  ]}
                />
              }
            >
              {item.title}
            </Chip>
          ))}
        </div>
      </Disclosure>
      {editing && (
        <Modal
          open
          onOpenChange={() => setEditing(null)}
          variant={editing.action === 'Archive' ? 'confirm' : 'form'}
          title={`${editing.action} chat`}
          confirmLabel={editing.action === 'Archive' ? 'Archive' : 'Save'}
          destructive={editing.action === 'Archive'}
          onConfirm={(values) => {
            if (editing.action === 'Rename') {
              const title = values.get('title')
              if (typeof title === 'string') changes.rename(editing.chat.id, title)
            } else {
              changes.archive(editing.chat.id)
              if (activeChat === editing.chat.id) navigate('/home')
            }
          }}
        >
          {editing.action === 'Rename' ? (
            <TextField label='Chat name' name='title' defaultValue={editing.chat.title} />
          ) : (
            <p data-type='T048'>Archive “{editing.chat.title}”?</p>
          )}
        </Modal>
      )}
    </>
  )
}
