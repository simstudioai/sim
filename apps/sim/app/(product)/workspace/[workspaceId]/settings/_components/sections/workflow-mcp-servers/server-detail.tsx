'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { CopyButton } from '@sim/emcn/button/copy-button'
import { useFeedbackExpiry } from '@sim/emcn/feedback/use-feedback-expiry'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { Select } from '@sim/emcn/picker/select'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice, InlineNotice } from '@sim/emcn/status'
import { ContentTabs } from '@sim/emcn/tabs/content-tabs'
import { getErrorMessage } from '@sim/utils/errors'
import {
  ActionRow,
  DetailHeader,
  FieldStack,
  Muted,
  Preformatted,
  SectionStack,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { MetadataFields } from '@/app/(product)/_components/workspace/metadata-fields/metadata-fields'
import { CreateApiKeyModal } from '@/app/(product)/workspace/[workspaceId]/_components/create-api-key-modal/create-api-key-modal'
import {
  getConfigSnippet,
  getCursorInstallUrl,
  MCP_CLIENTS,
  type McpClient,
} from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/workflow-mcp-servers/client-config'
import {
  AddWorkflowModal,
  EditServerModal,
  EditToolModal,
} from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/workflow-mcp-servers/server-modals'
import { useApiKeys } from '@/platform/lib/data/api-keys'
import {
  getBaseUrl,
  useCreateMcpServer,
  useDeleteWorkflowMcpTool,
  useDeployedWorkflows,
  useMcpServerTabParam,
  useWorkflowMcpServer,
  type WorkflowMcpServer,
  type WorkflowMcpTool,
} from '@/platform/lib/data/mcp'

interface ServerDetailProps {
  workspaceId: string
  /** The list's row, which names the server while its details load. */
  server: WorkflowMcpServer
  canManage: boolean
  canChangeVisibility: boolean
  deleting: boolean
  onBack: () => void
  onDelete: () => void
}

type Dialog =
  | { kind: 'edit-server' }
  | { kind: 'add-workflow' }
  | { kind: 'edit-tool'; tool: WorkflowMcpTool }
  | { kind: 'remove-tool'; tool: WorkflowMcpTool }
  | { kind: 'create-api-key' }

/** A workflow MCP server: how clients connect to it, and the workflows it serves as tools. */
export function ServerDetail({
  workspaceId,
  server: listed,
  canManage,
  canChangeVisibility,
  deleting,
  onBack,
  onDelete,
}: ServerDetailProps) {
  const detail = useWorkflowMcpServer(workspaceId, listed.id)
  const deployed = useDeployedWorkflows(workspaceId)
  const apiKeys = useApiKeys(workspaceId, 'workspace')
  const deleteTool = useDeleteWorkflowMcpTool()
  const addToWorkspace = useCreateMcpServer()
  const [tab, setTab] = useMcpServerTabParam()
  const [client, setClient] = useState<McpClient>('cursor')
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [addedAt, setAddedAt] = useState<number | null>(null)
  useFeedbackExpiry(addedAt, () => setAddedAt(null))

  const serverUrl = `${getBaseUrl()}/api/mcp/serve/${listed.id}`
  const tools = detail.data?.tools ?? []
  const deployedWorkflows = deployed.data ?? []
  const added = new Set(tools.map((tool) => tool.workflowId))
  const availableWorkflows = deployedWorkflows.filter((workflow) => !added.has(workflow.id))
  const closeDialog = () => setDialog(null)

  const header = (
    <DetailHeader
      backLabel='MCP servers'
      onBack={onBack}
      title={detail.data?.server.name ?? listed.name}
    >
      {canManage && detail.data && (
        <>
          <Button size='compact' onClick={() => setDialog({ kind: 'edit-server' })}>
            Edit server
          </Button>
          <Button
            size='compact'
            variant='primary'
            icon='I074'
            disabled={availableWorkflows.length === 0}
            disabledReason={
              availableWorkflows.length === 0 && deployedWorkflows.length > 0
                ? 'All deployed workflows have been added to this server.'
                : undefined
            }
            onClick={() => setDialog({ kind: 'add-workflow' })}
          >
            Add workflows
          </Button>
          <Button size='compact' variant='quiet' destructive disabled={deleting} onClick={onDelete}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </>
      )}
    </DetailHeader>
  )

  if (detail.isPending) return <SectionStack>{header}</SectionStack>
  if (!detail.data) {
    return (
      <SectionStack>
        {header}
        <FailureNotice
          message={getErrorMessage(detail.error, 'Failed to load server details')}
          retrying={detail.isFetching}
          onRetry={() => void detail.refetch()}
        />
      </SectionStack>
    )
  }

  const { server } = detail.data
  const snippet = getConfigSnippet(client, serverUrl, server.isPublic, server.name)

  const description = server.description?.trim()
  const addServerToWorkspace = () =>
    addToWorkspace.mutate(
      {
        workspaceId,
        config: {
          name: server.name,
          transport: 'streamable-http',
          url: serverUrl,
          timeout: 30000,
          headers: server.isPublic ? {} : { 'X-API-Key': '{{SIM_API_KEY}}' },
          enabled: true,
        },
      },
      { onSuccess: () => setAddedAt(Date.now()) }
    )

  const details = (
    <SectionStack>
      <SettingsSection title='Server'>
        <FieldStack>
          <MetadataFields
            label='Server details'
            fields={[
              { id: 'name', label: 'Server name', value: server.name },
              { id: 'transport', label: 'Transport', value: 'Streamable-HTTP' },
              { id: 'access', label: 'Access', value: server.isPublic ? 'Public' : 'Private' },
              ...(description
                ? [{ id: 'description', label: 'Description', value: description }]
                : []),
              { id: 'url', label: 'URL', value: serverUrl, copyable: true },
            ]}
          />
        </FieldStack>
      </SettingsSection>
      <SettingsSection title='Connect'>
        <SettingsRow label='MCP client' description='Select the client to set up' field>
          <Select
            label='MCP client'
            value={client}
            options={MCP_CLIENTS}
            onValueChange={(value) => {
              const choice = MCP_CLIENTS.find((option) => option.value === value)
              if (choice) setClient(choice.value)
            }}
          />
        </SettingsRow>
        {client === 'sim' ? (
          <>
            <SettingsRow
              label='Add to workspace'
              description='Use this server’s tools in other workflows through the MCP block'
            >
              <Button
                size='compact'
                variant='primary'
                disabled={addToWorkspace.isPending || addedAt !== null}
                onClick={addServerToWorkspace}
              >
                {addToWorkspace.isPending
                  ? 'Adding…'
                  : addedAt
                    ? 'Added to workspace'
                    : 'Add to workspace'}
              </Button>
            </SettingsRow>
            {addToWorkspace.isError && (
              <FieldStack>
                <InlineNotice
                  intent='danger'
                  message={getErrorMessage(addToWorkspace.error, 'Failed to add server')}
                />
              </FieldStack>
            )}
          </>
        ) : (
          <>
            <SettingsRow
              label='Configuration'
              description={
                client === 'codex' && server.isPublic
                  ? 'Add this to ~/.codex/config.toml.'
                  : undefined
              }
            >
              <ActionRow>
                {client === 'cursor' && (
                  <Button
                    size='compact'
                    render={
                      <a href={getCursorInstallUrl(serverUrl, server.isPublic, server.name)}>
                        Add to Cursor
                      </a>
                    }
                  >
                    Add to Cursor
                  </Button>
                )}
                <CopyButton label='Copy configuration' text={snippet} />
              </ActionRow>
            </SettingsRow>
            <FieldStack>
              <Preformatted>{snippet}</Preformatted>
            </FieldStack>
            {!server.isPublic && (
              <SettingsRow
                label='API key'
                description={
                  client === 'codex'
                    ? 'Add this to ~/.codex/config.toml and set the SIM_API_KEY environment variable with an existing API key.'
                    : 'Replace $SIM_API_KEY with your API key.'
                }
              >
                {canManage && (
                  <Button size='compact' onClick={() => setDialog({ kind: 'create-api-key' })}>
                    Create API key
                  </Button>
                )}
              </SettingsRow>
            )}
          </>
        )}
      </SettingsSection>
    </SectionStack>
  )

  const workflows = (
    <SettingsSection title={`Workflows (${tools.length})`}>
      {tools.length === 0 ? (
        <FieldStack>
          <Muted>No workflows added yet. Add a deployed workflow to serve it as a tool.</Muted>
        </FieldStack>
      ) : (
        tools.map((tool) => (
          <SettingsRow
            key={tool.id}
            label={tool.toolName}
            description={tool.toolDescription || 'No description'}
          >
            {canManage && (
              <ActionMenu
                label={`${tool.toolName} actions`}
                actions={[
                  {
                    id: 'edit',
                    label: 'Edit',
                    onSelect: () => setDialog({ kind: 'edit-tool', tool }),
                  },
                  {
                    id: 'remove',
                    label: 'Remove',
                    destructive: true,
                    disabled: deleteTool.isPending,
                    onSelect: () => setDialog({ kind: 'remove-tool', tool }),
                  },
                ]}
              />
            )}
          </SettingsRow>
        ))
      )}
      {deployed.isSuccess && deployedWorkflows.length === 0 && (
        <FieldStack>
          <Muted>Deploy a workflow first to add it to this server.</Muted>
        </FieldStack>
      )}
    </SettingsSection>
  )

  return (
    <SectionStack>
      {header}
      <ContentTabs
        label='Server views'
        current={tab}
        onSelect={(next) => void setTab(next === 'workflows' ? 'workflows' : 'details')}
        items={[
          { id: 'details', label: 'Details', content: details },
          { id: 'workflows', label: 'Workflows', content: workflows },
        ]}
      />
      {dialog?.kind === 'edit-server' && (
        <EditServerModal
          workspaceId={workspaceId}
          server={server}
          canChangeVisibility={canChangeVisibility}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'add-workflow' && (
        <AddWorkflowModal
          workspaceId={workspaceId}
          serverId={server.id}
          workflows={availableWorkflows.map((workflow) => ({
            value: workflow.id,
            label: workflow.name,
          }))}
          onAdded={() => void setTab('workflows')}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'edit-tool' && (
        <EditToolModal
          workspaceId={workspaceId}
          serverId={server.id}
          tool={dialog.tool}
          onClose={closeDialog}
        />
      )}
      <ConfirmDialog
        target={dialog?.kind === 'remove-tool' && dialog.tool}
        onClose={closeDialog}
        title='Remove workflow'
        description={(tool) =>
          `Are you sure you want to remove ${tool.toolName} from this server? The workflow will remain deployed and can be added back later.`
        }
        confirmLabel='Remove'
        pendingLabel='Removing…'
        onConfirm={(tool) =>
          deleteTool.mutateAsync({ workspaceId, serverId: server.id, toolId: tool.id })
        }
      />
      {dialog?.kind === 'create-api-key' && (
        <CreateApiKeyModal
          workspaceId={workspaceId}
          existingKeyNames={(apiKeys.data?.workspaceKeys ?? []).map((key) => key.name)}
          allowPersonalApiKeys={false}
          canManageWorkspaceKeys={canManage}
          defaultKeyType='workspace'
          source='settings'
          fullAccessOnly
          onClose={closeDialog}
        />
      )}
    </SectionStack>
  )
}
