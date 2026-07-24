'use client'

import { useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { ArrowRight, Plus, Wrench } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { canMutateWorkspaceSettingsSection } from '@/components/settings/navigation'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  customToolIdParam,
  customToolIdUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/[section]/search-params'
import { CustomToolDetail } from '@/app/workspace/[workspaceId]/settings/components/custom-tools/components/custom-tool-detail'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import type { SettingsAction } from '@/app/workspace/[workspaceId]/settings/components/settings-header/settings-header'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import { useCustomTools } from '@/hooks/queries/custom-tools'

export function CustomTools() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const workspacePermissions = useUserPermissionsContext()
  const canEdit = canMutateWorkspaceSettingsSection('custom-tools', workspacePermissions)

  const { data: tools = [], isLoading, error } = useCustomTools(workspaceId)

  const [searchTerm, setSearchTerm] = useSettingsSearch()
  const [selectedToolId, setSelectedToolId] = useQueryState(customToolIdParam.key, {
    ...customToolIdParam.parser,
    ...customToolIdUrlKeys,
  })
  /** The create flow has no entity id and is not deep-linkable — stays local. */
  const [isCreating, setIsCreating] = useState(false)

  const selectedTool = selectedToolId ? tools.find((t) => t.id === selectedToolId) : undefined

  const closeDetail = () => {
    setIsCreating(false)
    void setSelectedToolId(null, { history: 'replace' })
  }

  const filteredTools = tools.filter((tool) => {
    if (!searchTerm.trim()) return true
    const searchLower = searchTerm.toLowerCase()
    return (
      tool.title.toLowerCase().includes(searchLower) ||
      tool.schema?.function?.name?.toLowerCase().includes(searchLower) ||
      tool.schema?.function?.description?.toLowerCase().includes(searchLower)
    )
  })

  const showEmptyState = tools.length === 0
  const showNoResults = searchTerm.trim() && filteredTools.length === 0 && tools.length > 0

  const actions: SettingsAction[] = canEdit
    ? [
        {
          text: 'Add tool',
          icon: Plus,
          variant: 'primary',
          onSelect: () => setIsCreating(true),
          disabled: isLoading,
        },
      ]
    : []

  /**
   * Hold the first paint while a deep-linked id could still resolve — the tools
   * query and the workspace permissions context both gate the detail, so a valid
   * link never flashes the list before jumping to it. A dead id still falls back
   * to the list.
   */
  if (selectedToolId !== null && (isLoading || workspacePermissions.isLoading)) return null

  if ((isCreating && canEdit) || selectedTool) {
    return (
      <CustomToolDetail
        key={isCreating ? 'new' : selectedTool?.id}
        workspaceId={workspaceId}
        tool={isCreating ? null : (selectedTool ?? null)}
        readOnly={!canEdit}
        onBack={closeDetail}
        onCreated={(toolId) => {
          setIsCreating(false)
          void setSelectedToolId(toolId)
        }}
      />
    )
  }

  return (
    <SettingsPanel
      search={{
        value: searchTerm,
        onChange: setSearchTerm,
        placeholder: 'Search tools...',
        disabled: isLoading,
      }}
      actions={actions}
    >
      {error ? (
        <div className='flex h-full flex-col items-center justify-center gap-2'>
          <p className='text-[var(--text-error)] text-sm leading-tight'>
            {getErrorMessage(error, 'Failed to load tools')}
          </p>
        </div>
      ) : isLoading ? null : showEmptyState ? (
        <SettingsEmptyState>
          {canEdit ? 'Click "Add tool" above to get started' : 'No custom tools configured'}
        </SettingsEmptyState>
      ) : (
        <div className='-mx-2 flex flex-col gap-y-0.5'>
          {filteredTools.map((tool) => (
            <button
              key={tool.id}
              type='button'
              onClick={() => void setSelectedToolId(tool.id)}
              className='w-full cursor-pointer rounded-lg p-2 text-left transition-colors hover-hover:bg-[var(--surface-active)]'
            >
              <SettingsResourceRow
                icon={<Wrench />}
                title={tool.title || 'Unnamed Tool'}
                description={tool.schema?.function?.description || undefined}
                trailing={<ArrowRight className='size-4 text-[var(--text-icon)]' />}
              />
            </button>
          ))}
          {showNoResults && (
            <SettingsEmptyState variant='inline'>
              No tools found matching "{searchTerm}"
            </SettingsEmptyState>
          )}
        </div>
      )}
    </SettingsPanel>
  )
}
