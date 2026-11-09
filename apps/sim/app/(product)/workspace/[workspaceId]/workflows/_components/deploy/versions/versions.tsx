'use client'

import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { DataTable } from '@sim/emcn/data-display'
import { Input } from '@sim/emcn/field/inputs'
import { ActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import { OverflowText } from '@sim/emcn/overflow-text'
import { useMinuteClock } from '@/app/(product)/workspace/[workspaceId]/_components/resource-table/rename-dialog'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/deploy/versions/versions.module.css'
import {
  type DeploymentVersion,
  useUpdateDeploymentVersion,
} from '@/platform/lib/data/workflow-deploy'
import { formatRelativeTime } from '@/platform/shared/time'

interface VersionsProps {
  workflowId: string | null
  versions: readonly DeploymentVersion[]
  isPromotingVersion: boolean
  onDescribe: (version: number) => void
  onCompare: (version: number) => void
  onPromote: (version: number) => void
  onLoad: (version: number) => void
}

/** The one state a row shows: live, or the latest attempt of a version that is not. */
function versionState(version: DeploymentVersion) {
  if (version.isActive) return 'Live'
  const operation = version.latestOperationStatus
  if (operation === 'preparing' || operation === 'activating') return 'Pending'
  if (operation === 'failed') return 'Failed'
  return ''
}

const COLUMNS = [
  { key: 'version', label: 'Version', kind: 'text', primary: true },
  { key: 'status', label: 'Status', kind: 'status', width: 'compact' },
  { key: 'deployedBy', label: 'Deployed by', kind: 'text', showFrom: 'compact' },
  { key: 'deployed', label: 'Deployed', kind: 'text' },
] as const

interface RenameState {
  version: number
  value: string
}

/**
 * Every deployment of the workflow, newest first: its number, name and state, who deployed it and
 * when, with a menu to rename, describe, compare, promote it to live or load it into the editor.
 */
export function Versions({
  workflowId,
  versions,
  isPromotingVersion,
  onDescribe,
  onCompare,
  onPromote,
  onLoad,
}: VersionsProps) {
  const [rename, setRename] = useState<RenameState | null>(null)
  const renameMutation = useUpdateDeploymentVersion()
  const now = useMinuteClock()

  const saveRename = () => {
    if (!rename || renameMutation.isPending) return
    const value = rename.value.trim()
    // The number is always the canonical reference, so a cleared name changes nothing.
    if (!workflowId || !value) {
      setRename(null)
      return
    }
    const current = versions.find((entry) => entry.version === rename.version)
    // Re-submitting the displayed `v{n}` fallback saves no redundant name.
    if (value === (current?.name || `v${rename.version}`)) {
      setRename(null)
      return
    }
    renameMutation.mutate(
      { workflowId, version: rename.version, name: value },
      { onSuccess: () => setRename(null) }
    )
  }

  const rows = versions.map((version) => {
    const state = versionState(version)
    const renaming = rename?.version === version.version
    const actions: MenuAction[] = [
      {
        id: 'rename',
        label: 'Rename',
        icon: 'I036',
        onSelect: () =>
          setRename({
            version: version.version,
            value: version.name || `v${version.version}`,
          }),
      },
      {
        id: 'describe',
        label: version.description ? 'Edit description' : 'Add description',
        icon: 'I075',
        onSelect: () => onDescribe(version.version),
      },
      {
        id: 'compare',
        label: 'Compare',
        icon: 'columns',
        onSelect: () => onCompare(version.version),
      },
      ...(version.isActive
        ? []
        : [
            {
              id: 'promote',
              label: 'Promote to live',
              icon: 'I065' as const,
              disabled: isPromotingVersion,
              onSelect: () => onPromote(version.version),
            },
          ]),
      {
        id: 'load',
        label: 'Load deployment',
        icon: 'I053',
        onSelect: () => onLoad(version.version),
      },
    ]
    return {
      id: version.id,
      values: {
        version: version.name || `v${version.version}`,
        status: state,
        deployedBy: version.deployedBy || 'Unknown',
        deployed: formatRelativeTime(Date.parse(version.createdAt), now),
      },
      cells: {
        version: (
          <span className={styles.version}>
            <span className={styles.number}>v{version.version}</span>
            {renaming ? (
              <RenameField
                version={version.version}
                value={rename.value}
                saving={renameMutation.isPending}
                onChange={(value) => setRename({ version: version.version, value })}
                onSubmit={saveRename}
                onCancel={() => setRename(null)}
              />
            ) : (
              version.name && <OverflowText text={version.name}>{version.name}</OverflowText>
            )}
          </span>
        ),
      },
      action: (
        <ActionMenu
          label={`Actions for v${version.version}`}
          icon='I108'
          align='end'
          triggerSize='compact'
          disabled={isPromotingVersion}
          actions={actions}
        />
      ),
    }
  })

  return <DataTable title='Versions' titleHidden columns={COLUMNS} rows={rows} />
}

interface RenameFieldProps {
  version: number
  value: string
  saving: boolean
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
}

/** The version's name in place: Enter or leaving the field saves it, Escape keeps the old one. */
function RenameField({ version, value, saving, onChange, onSubmit, onCancel }: RenameFieldProps) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  return (
    <span
      className={styles.rename}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          onSubmit()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onCancel()
        }
      }}
    >
      <Input
        label={`Rename v${version}`}
        placeholder={`v${version}`}
        value={value}
        onChange={onChange}
        onBlur={onSubmit}
        maxLength={100}
        disabled={saving}
        autoComplete='off'
        spellCheck={false}
        inputRef={input}
      />
    </span>
  )
}
