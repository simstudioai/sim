'use client'

import { useState } from 'react'
import { FieldFrame, TextField } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'
import { InlineNotice } from '@sim/emcn/status'
import { useRouter, useSearchParams } from 'next/navigation'
import { CheckboxTree } from '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/sections/forks/fork-checkbox-tree'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/sections/forks/forks.module.css'
import { copyKindNode } from '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/sections/forks/resource-nodes'
import {
  type GetForkResourcesResponse,
  useForkResources,
  useForkWorkspace,
} from '@/platform/lib/data/forks'
import { platformHref } from '@/platform/lib/navigation'
import { workspaceEntry } from '@/platform/lib/workspace-navigation'
import { toast } from '@/platform/shared/toast'

type ResourceKey = Exclude<keyof GetForkResourcesResponse, 'deployedWorkflowCount'>
type ResourceSelection = Record<ResourceKey, ReadonlySet<string>>

const RESOURCE_KINDS: ReadonlyArray<{ key: ResourceKey; label: string }> = [
  { key: 'files', label: 'Files' },
  { key: 'tables', label: 'Tables' },
  { key: 'knowledgeBases', label: 'Knowledge bases' },
  { key: 'customTools', label: 'Custom tools' },
  { key: 'skills', label: 'Skills' },
  { key: 'mcpServers', label: 'MCP servers' },
  { key: 'workflowMcpServers', label: 'Workflow MCP servers' },
]

function fullSelection(data: GetForkResourcesResponse): ResourceSelection {
  const ids = (key: ResourceKey) => new Set(data[key].map((item) => item.id))
  return {
    files: ids('files'),
    tables: ids('tables'),
    knowledgeBases: ids('knowledgeBases'),
    customTools: ids('customTools'),
    skills: ids('skills'),
    mcpServers: ids('mcpServers'),
    workflowMcpServers: ids('workflowMcpServers'),
  }
}

interface ForkWorkspaceModalProps {
  sourceWorkspaceId: string
  sourceWorkspaceName: string
  /** Whether the viewer is under their workspace cap; at the cap, Fork sends them to upgrade. */
  canFork: boolean
  onUpgrade: () => void
  onClose: () => void
}

/**
 * Names and creates a fork of the workspace, copying every resource unless the viewer narrows a
 * kind or picks individual items; references to what is left out are cleared in the fork. The copy
 * runs in the background and lands in Activity; the toast opens the new fork.
 */
export function ForkWorkspaceModal({
  sourceWorkspaceId,
  sourceWorkspaceName,
  canFork,
  onUpgrade,
  onClose,
}: ForkWorkspaceModalProps) {
  const router = useRouter()
  const search = useSearchParams()
  const forkWorkspace = useForkWorkspace()
  const resources = useForkResources(sourceWorkspaceId)
  const [name, setName] = useState(`${sourceWorkspaceName} (fork)`)
  /** Absent until the viewer narrows it: every resource is selected by default. */
  const [narrowed, setNarrowed] = useState<ResourceSelection | null>(null)
  const data = resources.data
  const selection = narrowed ?? (data ? fullSelection(data) : null)
  const availableKinds = data ? RESOURCE_KINDS.filter((kind) => data[kind.key].length > 0) : []
  const hasDeselection =
    data !== undefined &&
    selection !== null &&
    availableKinds.some((kind) => selection[kind.key].size < data[kind.key].length)

  const toggle = (key: ResourceKey, ids: string[], checked: boolean) => {
    if (!data) return
    setNarrowed((previous) => {
      const base = previous ?? fullSelection(data)
      const next = new Set(base[key])
      for (const id of ids) {
        if (checked) next.add(id)
        else next.delete(id)
      }
      return { ...base, [key]: next }
    })
  }

  async function submit() {
    if (!canFork) {
      onUpgrade()
      return
    }
    const trimmed = name.trim()
    if (!trimmed || !selection) return false
    const copy = Object.fromEntries(
      RESOURCE_KINDS.map((kind) => [kind.key, Array.from(selection[kind.key])])
    )
    const result = await forkWorkspace.mutateAsync({
      workspaceId: sourceWorkspaceId,
      body: { name: trimmed, copy },
    })
    toast.success(`Forked into "${result.workspace.name}"`, {
      action: {
        label: 'Open fork',
        onClick: () => router.push(platformHref(workspaceEntry(result.workspace.id), search)),
      },
    })
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title='Fork workspace'
      confirmLabel='Fork'
      confirmDisabled={canFork && (!name.trim() || !data)}
      onConfirm={submit}
    >
      <TextField
        label='Forking from'
        placeholder='Workspace'
        value={sourceWorkspaceName}
        viewOnly
      />
      <TextField
        label='Name'
        placeholder='Workspace name'
        value={name}
        onChange={setName}
        maxLength={100}
        autoComplete='off'
        required
      />
      {data && selection && availableKinds.length > 0 && (
        <FieldFrame label='Copy resources'>
          <div className={styles.group}>
            {availableKinds.map((kind) => (
              <CheckboxTree
                key={kind.key}
                nodes={[copyKindNode(kind.key, kind.label, data[kind.key], kind.key === 'files')]}
                isSelected={(id) => selection[kind.key].has(id)}
                onToggle={(ids, checked) => toggle(kind.key, ids, checked)}
                groupActionLabel={(label) => `Copy all in ${label}`}
              />
            ))}
          </div>
        </FieldFrame>
      )}
      {hasDeselection && (
        <InlineNotice
          intent='warning'
          message='Some resources are not selected — references to them in your workflows will be cleared in the fork.'
        />
      )}
      {data && data.deployedWorkflowCount === 0 && (
        <InlineNotice message='No deployed workflows to copy — your fork will start with a blank workflow.' />
      )}
    </Modal>
  )
}
