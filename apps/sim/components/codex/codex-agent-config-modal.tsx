'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalFooter,
  ChipModalHeader,
  ChipModalTabs,
} from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { isEqual } from 'es-toolkit'
import { CodexConfigEditor } from '@/components/codex/codex-config-editor'
import {
  CODEX_CONFIG_VERSION,
  type CodexConfigPatch,
  type CodexWorkflowConfig,
  parseCodexConfigPatch,
  resolveCodexConfig,
} from '@/lib/codex/config'
import {
  useUpdateWorkflowCodexConfig,
  useWorkflowCodexConfig,
  useWorkspaceCodexConfig,
} from '@/hooks/queries/codex-config'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

interface CodexAgentConfigModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  workflowId: string
  agentId: string
  agentLabel: string
  agentBlockIds: string[]
  embeddedConfig?: unknown
  canEdit: boolean
}

type ConfigTab = 'agent' | 'workflow'

function emptyWorkflowConfig(): CodexWorkflowConfig {
  return { version: CODEX_CONFIG_VERSION, defaults: {}, agents: {} }
}

/** Edits workflow and Agent sparse overlays without putting stable config on every step. */
export function CodexAgentConfigModal({
  open,
  onOpenChange,
  workspaceId,
  workflowId,
  agentId,
  agentLabel,
  agentBlockIds,
  embeddedConfig,
  canEdit,
}: CodexAgentConfigModalProps) {
  const workspaceQuery = useWorkspaceCodexConfig(open ? workspaceId : undefined)
  const workflowQuery = useWorkflowCodexConfig(open ? workflowId : undefined)
  const updateWorkflow = useUpdateWorkflowCodexConfig()
  const { collaborativeBatchSetSubblockValues } = useCollaborativeWorkflow()
  const [tab, setTab] = useState<ConfigTab>('agent')
  const [draft, setDraft] = useState<CodexWorkflowConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const embeddedPatch = useMemo(() => {
    try {
      return parseCodexConfigPatch(embeddedConfig)
    } catch {
      return {}
    }
  }, [embeddedConfig])

  useEffect(() => {
    if (!open) {
      setDraft(null)
      setError(null)
      setTab('agent')
      return
    }
    if (!draft && workflowQuery.data) {
      const loaded = workflowQuery.data.config
      const shouldRestoreMirror =
        !Object.hasOwn(loaded.agents, agentId) && Object.keys(embeddedPatch).length > 0
      setDraft(
        shouldRestoreMirror
          ? { ...loaded, agents: { ...loaded.agents, [agentId]: embeddedPatch } }
          : loaded
      )
    }
  }, [agentId, draft, embeddedPatch, open, workflowQuery.data])

  const workspacePatch = workspaceQuery.data?.config ?? {}
  const workflowInherited = useMemo(
    () => resolveCodexConfig({ workspace: workspacePatch }),
    [workspacePatch]
  )
  const agentInherited = useMemo(
    () => resolveCodexConfig({ workspace: workspacePatch, workflow: draft?.defaults ?? {} }),
    [draft?.defaults, workspacePatch]
  )

  const updateCurrentPatch = (patch: CodexConfigPatch) => {
    setDraft((current) => {
      const next = current ?? emptyWorkflowConfig()
      if (tab === 'workflow') return { ...next, defaults: patch }
      return { ...next, agents: { ...next.agents, [agentId]: patch } }
    })
  }

  const handleSave = async () => {
    if (!draft) return
    setError(null)
    try {
      await updateWorkflow.mutateAsync({ workflowId, config: draft })
      const mirror = draft.agents[agentId] ?? {}
      const mirrorValue = Object.keys(mirror).length > 0 ? mirror : null
      const subBlockStore = useSubBlockStore.getState()
      const updates = agentBlockIds.flatMap((blockId) => {
        const expectedValue = subBlockStore.getValue(blockId, 'agentConfig') ?? null
        return isEqual(expectedValue, mirrorValue)
          ? []
          : [{ blockId, subblockId: 'agentConfig', value: mirrorValue, expectedValue }]
      })
      if (updates.length > 0) collaborativeBatchSetSubblockValues(updates)
      onOpenChange(false)
    } catch (caught) {
      setError(getErrorMessage(caught, 'Failed to save Codex configuration'))
    }
  }

  const loading = workspaceQuery.isLoading || workflowQuery.isLoading || !draft
  const queryError = workspaceQuery.error ?? workflowQuery.error
  const currentPatch = tab === 'workflow' ? (draft?.defaults ?? {}) : (draft?.agents[agentId] ?? {})

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle='Codex configuration' size='lg'>
      <ChipModalHeader onClose={() => onOpenChange(false)}>Configure {agentLabel}</ChipModalHeader>
      <ChipModalBody>
        <ChipModalTabs
          aria-label='Codex configuration layer'
          tabs={[
            { value: 'agent', label: agentLabel },
            { value: 'workflow', label: 'Workflow defaults' },
          ]}
          value={tab}
          onChange={(value) => setTab(value as ConfigTab)}
        />

        <div className='rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[var(--text-muted)] text-xs'>
          {tab === 'agent'
            ? 'This sparse patch is shared by every step using this Agent. Missing fields inherit from the workflow, then the workspace.'
            : 'These defaults apply to every Codex Agent in this workflow. Missing fields inherit from the workspace.'}
        </div>

        {loading ? (
          <div className='py-6 text-center text-[var(--text-muted)] text-sm'>
            Loading configuration…
          </div>
        ) : (
          <CodexConfigEditor
            value={currentPatch}
            inherited={tab === 'agent' ? agentInherited : workflowInherited}
            onChange={updateCurrentPatch}
            disabled={!canEdit || updateWorkflow.isPending}
          />
        )}

        <p className='text-[var(--text-muted)] text-xs'>
          Workspace defaults are managed in{' '}
          <a
            className='text-[var(--text-primary)] underline underline-offset-2'
            href={`/workspace/${workspaceId}/settings/codex`}
          >
            Settings → Codex
          </a>
          . Reasoning effort can still be overridden on an individual step.
        </p>
        <ChipModalError>
          {error ??
            (queryError ? getErrorMessage(queryError, 'Failed to load configuration') : null)}
        </ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => onOpenChange(false)}
        cancelDisabled={updateWorkflow.isPending}
        primaryAction={{
          label: updateWorkflow.isPending ? 'Saving…' : 'Save overlays',
          onClick: () => void handleSave(),
          disabled: !canEdit || loading || updateWorkflow.isPending || Boolean(queryError),
        }}
      />
    </ChipModal>
  )
}
