'use client'

import { Button } from '@sim/emcn/button'
import { Disclosure } from '@sim/emcn/disclosure'
import { PropertyList } from '@sim/emcn/property-list'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice, StatusTag } from '@sim/emcn/status'
import { Tooltip } from '@sim/emcn/tooltip'
import { getErrorMessage } from '@sim/utils/errors'
import {
  DetailHeader,
  FieldStack,
  Muted,
  SectionStack,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { MetadataFields } from '@/app/(product)/_components/workspace/metadata-fields/metadata-fields'
import styles from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/mcp/mcp-server-detail.module.css'
import {
  formatTransportLabel,
  getServerToolsLabel,
} from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/mcp/server-status'
import {
  getIssueBadgeLabel,
  getIssueBadgeVariant,
  getMcpToolIssue,
  type McpServer,
  type McpTool,
  type McpToolIssue,
  type StoredMcpTool,
} from '@/platform/lib/data/mcp'

interface McpServerDetailProps {
  server: McpServer
  /** Every server in the workspace, for the stored-tool checks. */
  servers: McpServer[]
  /** Every tool discovered in the workspace; this server's are filtered from it. */
  discoveredTools: McpTool[]
  /** Where workflows use a server's tools, to name the workflows a tool change breaks. */
  storedTools: StoredMcpTool[]
  /** This server's tool discovery: pending is not empty, and a failure is not "no tools". */
  toolsState?: { isLoading: boolean; isFetching: boolean; error: Error | null }
  onRetryTools: () => void
  canEdit: boolean
  authorizing: boolean
  deleting: boolean
  refresh: { label: string; disabled: boolean }
  onBack: () => void
  onRefresh: () => void
  onEdit: () => void
  onDelete: () => void
  onAuthorize: () => void
}

interface ToolIssue {
  issue: McpToolIssue
  workflowName: string
}

/** One MCP server: its connection, its authorization and the tools it offers. */
export function McpServerDetail({
  server,
  servers,
  discoveredTools,
  storedTools,
  toolsState,
  onRetryTools,
  canEdit,
  authorizing,
  deleting,
  refresh,
  onBack,
  onRefresh,
  onEdit,
  onDelete,
  onAuthorize,
}: McpServerDetailProps) {
  const name = server.name || 'Unnamed server'
  const manageable = canEdit && !server.managedConnectorId
  const tools = discoveredTools.filter((tool) => tool.serverId === server.id)
  const serverStates = servers.map((candidate) => ({
    id: candidate.id,
    url: candidate.url,
    connectionStatus: candidate.connectionStatus,
    lastError: candidate.lastError || undefined,
  }))

  const issuesFor = (toolName: string): ToolIssue[] =>
    storedTools.flatMap((stored) => {
      if (stored.serverId !== server.id || stored.toolName !== toolName) return []
      const issue = getMcpToolIssue(stored, serverStates, discoveredTools)
      return issue ? [{ issue, workflowName: stored.workflowName }] : []
    })

  return (
    <SectionStack>
      <DetailHeader backLabel='MCP tools' onBack={onBack} title={name}>
        {manageable && (
          <>
            <Button size='compact' disabled={refresh.disabled} onClick={onRefresh}>
              {refresh.label}
            </Button>
            <Button size='compact' onClick={onEdit}>
              Edit
            </Button>
          </>
        )}
      </DetailHeader>
      <SettingsSection title='Server'>
        <FieldStack>
          <MetadataFields
            label='Server details'
            fields={[
              {
                id: 'transport',
                label: 'Transport',
                value: formatTransportLabel(server.transport),
              },
              ...(server.url
                ? [{ id: 'url', label: 'URL', value: server.url, copyable: true }]
                : []),
              ...(server.managedConnectorId
                ? [{ id: 'managed-by', label: 'Managed by', value: 'Connected accounts' }]
                : []),
            ]}
          />
        </FieldStack>
        {server.connectionStatus !== 'connected' && (
          <SettingsRow
            label='Status'
            description={getServerToolsLabel(
              [],
              server.connectionStatus,
              server.lastError,
              server.authType
            )}
          >
            <StatusTag
              label={server.connectionStatus === 'error' ? 'Error' : 'Not connected'}
              intent='danger'
            />
          </SettingsRow>
        )}
        {manageable && server.authType === 'oauth' && server.connectionStatus !== 'connected' && (
          <SettingsRow label='Authentication' description='Sign in to this server to use its tools'>
            <Button size='compact' variant='primary' onClick={onAuthorize}>
              {authorizing ? 'Reopen authorization' : 'Authorize'}
            </Button>
          </SettingsRow>
        )}
      </SettingsSection>
      <SettingsSection title='Tools'>
        {tools.length === 0 && toolsState?.isLoading ? null : tools.length === 0 &&
          toolsState?.error ? (
          <FieldStack>
            <FailureNotice
              message={getErrorMessage(toolsState.error, 'Failed to load tools')}
              retrying={toolsState.isFetching}
              onRetry={onRetryTools}
            />
          </FieldStack>
        ) : tools.length === 0 ? (
          <FieldStack>
            <Muted>No tools available</Muted>
          </FieldStack>
        ) : (
          tools.map((tool) => (
            <ToolEntry key={tool.name} tool={tool} issues={issuesFor(tool.name)} />
          ))
        )}
      </SettingsSection>
      {manageable && (
        <SettingsSection title='Manage server'>
          <SettingsRow
            label='Delete server'
            description='Remove this server and its tools from the workspace'
          >
            <Button variant='quiet' destructive disabled={deleting} onClick={onDelete}>
              Delete
            </Button>
          </SettingsRow>
        </SettingsSection>
      )}
    </SectionStack>
  )
}

interface ToolEntryProps {
  tool: McpTool
  issues: readonly ToolIssue[]
}

type ToolParameter = NonNullable<McpTool['inputSchema']['properties']>[string]

/** A parameter's type, whether it is required and its description, on one line. */
function describeParameter(parameter: ToolParameter, required: boolean): string {
  const type = Array.isArray(parameter.type) ? parameter.type.join(' | ') : parameter.type
  return [type || 'any', required ? 'required' : undefined, parameter.description]
    .filter(Boolean)
    .join(' · ')
}

/** A tool, the workflows its changes break, and its parameters on request. */
function ToolEntry({ tool, issues }: ToolEntryProps) {
  const parameters = Object.entries(tool.inputSchema.properties ?? {})
  const required = tool.inputSchema.required ?? []
  const [first] = issues
  return (
    <div className={styles.tool}>
      <SettingsRow label={tool.name} description={tool.description}>
        {first && (
          <Tooltip label={`Update in: ${issues.map((entry) => entry.workflowName).join(', ')}`}>
            <StatusTag
              label={getIssueBadgeLabel(first.issue)}
              intent={getIssueBadgeVariant(first.issue) === 'red' ? 'danger' : 'warning'}
            />
          </Tooltip>
        )}
      </SettingsRow>
      {parameters.length > 0 && (
        <div className={styles.parameters}>
          <Disclosure label='Parameters' chevron>
            <div className={styles.parameterList}>
              <PropertyList
                titleHidden
                title={`${tool.name} parameters`}
                properties={parameters.map(([parameterName, parameter]) => ({
                  id: parameterName,
                  label: parameterName,
                  kind: 'text',
                  value: describeParameter(parameter, required.includes(parameterName)),
                }))}
              />
            </div>
          </Disclosure>
        </div>
      )}
    </div>
  )
}
