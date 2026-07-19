'use client'

import { useMemo } from 'react'
import { ChipCombobox, type ComboboxOption } from '@sim/emcn'
import { ModuleChooser } from '@/components/resources/interface-view/components/module-chooser'
import { useTablesList } from '@/hooks/queries/tables'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'

/** The workspace resources a module can be bound to from inside the module. */
export type ModuleResourceKind = 'workflow' | 'table' | 'file'

interface ResourceCopy {
  /** Chooser header, in the same slot the module-type stack titles itself. */
  title: string
  placeholder: string
  searchPlaceholder: string
  emptyMessage: string
}

const RESOURCE_COPY: Record<ModuleResourceKind, ResourceCopy> = {
  workflow: {
    title: 'Workflow',
    placeholder: 'Select a workflow',
    searchPlaceholder: 'Search workflows...',
    emptyMessage: 'No workflows in this workspace',
  },
  table: {
    title: 'Table',
    placeholder: 'Select a table',
    searchPlaceholder: 'Search tables...',
    emptyMessage: 'No tables in this workspace',
  },
  file: {
    title: 'File',
    placeholder: 'Select a file',
    searchPlaceholder: 'Search files...',
    emptyMessage: 'No files in this workspace',
  },
}

/** The minimal shape every pickable workspace resource exposes. */
interface PickableResource {
  id: string
  name: string
}

interface PickerProps {
  kind: ModuleResourceKind
  items: readonly PickableResource[] | undefined
  isLoading: boolean
  onSelect: (id: string) => void
}

/**
 * The picker itself, once its list has been resolved. Kept separate from the
 * three query wrappers below so the control, its copy, and its chrome are
 * declared exactly once.
 */
function Picker({ kind, items, isLoading, onSelect }: PickerProps) {
  const copy = RESOURCE_COPY[kind]
  const options = useMemo<ComboboxOption[]>(
    () => (items ?? []).map((item) => ({ label: item.name, value: item.id })),
    [items]
  )

  return (
    <ModuleChooser title={copy.title}>
      <ChipCombobox
        options={options}
        value=''
        onChange={onSelect}
        placeholder={copy.placeholder}
        searchable
        searchPlaceholder={copy.searchPlaceholder}
        emptyMessage={copy.emptyMessage}
        isLoading={isLoading}
        align='start'
        dropdownWidth='trigger'
        maxHeight={240}
        aria-label={copy.placeholder}
      />
    </ModuleChooser>
  )
}

interface ScopedPickerProps {
  workspaceId: string
  onSelect: (id: string) => void
}

function WorkflowPicker({ workspaceId, onSelect }: ScopedPickerProps) {
  const workflows = useWorkflows(workspaceId)
  return (
    <Picker
      kind='workflow'
      items={workflows.data}
      isLoading={workflows.isLoading}
      onSelect={onSelect}
    />
  )
}

function TablePicker({ workspaceId, onSelect }: ScopedPickerProps) {
  const tables = useTablesList(workspaceId)
  return (
    <Picker kind='table' items={tables.data} isLoading={tables.isLoading} onSelect={onSelect} />
  )
}

function FilePicker({ workspaceId, onSelect }: ScopedPickerProps) {
  const files = useWorkspaceFiles(workspaceId)
  return <Picker kind='file' items={files.data} isLoading={files.isLoading} onSelect={onSelect} />
}

export interface ModuleResourcePickerProps {
  kind: ModuleResourceKind
  /** Always workspace scope — a share carries no unconfigured modules to bind. */
  workspaceId: string
  onSelect: (id: string) => void
}

/**
 * Binds an unconfigured module to a workspace resource without leaving the
 * canvas, so wiring a module reads like the module-type stack that preceded it
 * rather than sending the builder to the inspector for the first edit.
 *
 * Exactly one branch mounts, and each branch owns its own list query, so
 * picking a table never fetches workflows and a module that is already
 * configured issues no list request at all.
 */
export function ModuleResourcePicker({ kind, workspaceId, onSelect }: ModuleResourcePickerProps) {
  switch (kind) {
    case 'workflow':
      return <WorkflowPicker workspaceId={workspaceId} onSelect={onSelect} />
    case 'table':
      return <TablePicker workspaceId={workspaceId} onSelect={onSelect} />
    case 'file':
      return <FilePicker workspaceId={workspaceId} onSelect={onSelect} />
  }
}
