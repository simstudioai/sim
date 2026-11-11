'use client'

import { type ReactNode, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { ActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow } from '@sim/emcn/settings-section'
import Link from 'next/link'
import { SettingsList } from '@/app/(product)/_components/settings-parts/settings-list'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import {
  ActionRow,
  SectionStack,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'

/** A row's one visible action: a link to the source's records or a command. */
export type SourceRowAction =
  | { label: string; href: string; onSelect?: never; disabled?: never }
  | { label: string; onSelect: () => void; disabled?: boolean; href?: never }

export interface SourceListRow {
  id: string
  name: string
  leading: ReactNode
  description: string
  primary?: SourceRowAction
  /** The row's other actions; the list ends the menu with Remove. */
  more: SourceRowAction[]
  /** What removing it loses, as its confirmation states it. */
  removeConsequence: string
  removeDisabled?: boolean
  onRemove: () => Promise<unknown> | unknown
}

interface SourcesListProps {
  search: string
  onSearchChange: (search: string) => void
  /** Assistant apps, which members connect their own accounts to. */
  assistantApps?: ReactNode
  /** Null while the first read is pending; a failed read passes `failure` instead. */
  rows: SourceListRow[] | null
  failure?: ReactNode
  /** Some source exists to search: the search field shows only then. */
  searchable: boolean
  addDisabled: boolean
  onAdd: () => void
  /** The dialogs the rows and Add source open. */
  children?: ReactNode
}

function menuAction(action: SourceRowAction, index: number): MenuAction {
  return action.href !== undefined
    ? { id: `action-${index}`, label: action.label, href: action.href }
    : {
        id: `action-${index}`,
        label: action.label,
        disabled: action.disabled,
        onSelect: action.onSelect,
      }
}

/**
 * The organization's Sim Search sources, rendered from props by both the live page and its
 * fixtures. Each row has one visible action and a menu for the rest, ending in Remove, which asks
 * first.
 */
export function SourcesList({
  search,
  onSearchChange,
  assistantApps,
  rows,
  failure,
  searchable,
  addDisabled,
  onAdd,
  children,
}: SourcesListProps) {
  const [removing, setRemoving] = useState<SourceListRow | null>(null)
  const addSource = (
    <Button size='compact' icon='I074' disabled={addDisabled} onClick={onAdd}>
      Add source
    </Button>
  )
  return (
    <SectionStack>
      <SettingsPageHeader />
      {searchable && (
        <SectionToolbar
          grow={
            <SearchField
              label='Search sources'
              placeholder='Search sources…'
              value={search}
              onValueChange={onSearchChange}
            />
          }
        />
      )}
      {assistantApps}
      {failure ??
        (rows && (
          <SettingsList
            title='Search sources'
            empty={
              rows.length > 0
                ? undefined
                : search.trim()
                  ? { title: 'No matching sources' }
                  : {
                      title: 'No sources yet',
                      description: 'Connect a source for Sim Search to read',
                      action: addSource,
                    }
            }
          >
            {rows.map((row) => (
              <SettingsRow
                key={row.id}
                label={row.name}
                leading={row.leading}
                description={row.description}
              >
                <ActionRow>
                  {row.primary &&
                    (row.primary.href !== undefined ? (
                      <Button size='compact' render={<Link href={row.primary.href} />}>
                        {row.primary.label}
                      </Button>
                    ) : (
                      <Button
                        size='compact'
                        disabled={row.primary.disabled}
                        onClick={row.primary.onSelect}
                      >
                        {row.primary.label}
                      </Button>
                    ))}
                  <ActionMenu
                    label={`${row.name} source actions`}
                    icon='I108'
                    actions={[
                      ...row.more.map(menuAction),
                      {
                        id: 'remove',
                        label: 'Remove source',
                        destructive: true,
                        separatorBefore: row.more.length > 0,
                        disabled: row.removeDisabled,
                        onSelect: () => setRemoving(row),
                      },
                    ]}
                  />
                </ActionRow>
              </SettingsRow>
            ))}
            <SettingsRow label='Add source' description='Connect a source for Sim Search to read'>
              {addSource}
            </SettingsRow>
          </SettingsList>
        ))}
      {children}
      <ConfirmDialog
        target={removing}
        onClose={() => setRemoving(null)}
        title={(row) => `Remove ${row.name}`}
        description={(row) => row.removeConsequence}
        confirmLabel='Remove source'
        pendingLabel='Removing…'
        onConfirm={async (row) => {
          await row.onRemove()
        }}
      />
    </SectionStack>
  )
}
