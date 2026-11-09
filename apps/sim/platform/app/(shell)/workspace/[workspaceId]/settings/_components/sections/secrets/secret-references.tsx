'use client'

import { ActivityRow } from '@sim/emcn/activity-row'
import { EmptyState } from '@sim/emcn/empty-state'
import { Icon } from '@sim/emcn/icon'
import { SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { useSearchParams } from 'next/navigation'
import {
  Muted,
  ResourceList,
  SectionStack,
} from '@/platform/app/(shell)/_components/settings-parts/settings-parts'
import {
  customToolIdParam,
  focusBlockParam,
  mcpServerIdParam,
  type SecretReferenceResourcePayload,
  useSecretReferences,
} from '@/platform/lib/data/secrets'
import { platformHref } from '@/platform/lib/navigation'
import { workspacePath } from '@/platform/lib/workspace-navigation'

/**
 * A capped scan that listed nothing is not "not referenced": it stopped early, so silence would
 * invite deleting a key that blocks past the cap still depend on.
 */
const TRUNCATED_NOTE = 'This secret is referenced in more places than can be listed here.'

/** A custom tool or an MCP server can carry the key more than once, so `id` alone is not a key. */
function resourceKey(resource: SecretReferenceResourcePayload) {
  return `${resource.kind}:${resource.id}:${resource.field}`
}

interface SecretReferencesProps {
  workspaceId: string
  secretName: string
  /**
   * A personal secret overridden by a same-named workspace variable: every `{{name}}` resolves to
   * that variable, whose reference map is admin-gated, so this explains instead of asking.
   */
  shadowed: boolean
}

/**
 * Where one secret is wired in: the blocks that name it as `{{KEY}}`, grouped under their
 * workflow, then the custom tools and MCP servers whose own bodies carry it. Each row opens its
 * owner, a block landing on the canvas at that block.
 */
export function SecretReferences({ workspaceId, secretName, shadowed }: SecretReferencesProps) {
  const search = useSearchParams()
  const { data, isPending, isError, isFetching, refetch } = useSecretReferences(
    { workspaceId, name: secretName },
    !shadowed
  )

  if (shadowed)
    return (
      <EmptyState
        title='Overridden by a workspace variable'
        description='Every reference to this name resolves to that variable instead.'
      />
    )
  if (isError)
    return (
      <FailureNotice
        message='Could not load references.'
        retrying={isFetching}
        onRetry={() => void refetch()}
      />
    )
  if (isPending) return null
  if (data.workflows.length === 0 && data.resources.length === 0)
    return (
      <EmptyState
        title={data.truncated ? TRUNCATED_NOTE : 'This secret is not referenced in any workflow.'}
      />
    )

  const linkTo = (section: string, key: string, value: string) => {
    const href = platformHref(workspacePath(workspaceId, section), search)
    return `${href}${href.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`
  }
  const blockHref = (workflowId: string, blockId: string) =>
    linkTo(`workflows/${workflowId}`, focusBlockParam.key, blockId)
  const resourceHref = (resource: SecretReferenceResourcePayload) =>
    resource.kind === 'mcp-server'
      ? linkTo('settings/mcp', mcpServerIdParam.key, resource.id)
      : linkTo('settings/custom-tools', customToolIdParam.key, resource.id)

  return (
    <SectionStack>
      {data.workflows.map((workflow) => (
        <SettingsSection key={workflow.workflowId} title={workflow.workflowName}>
          <ResourceList>
            {workflow.blocks.map((block) => (
              <ActivityRow
                key={block.blockId}
                leading={<Icon providerId={block.blockType} />}
                title={block.blockName}
                detail={block.field}
                href={blockHref(workflow.workflowId, block.blockId)}
              />
            ))}
          </ResourceList>
        </SettingsSection>
      ))}
      {data.resources.length > 0 && (
        <SettingsSection title='Custom tools and MCP servers'>
          <ResourceList>
            {data.resources.map((resource) => (
              <ActivityRow
                key={resourceKey(resource)}
                leading={<Icon name={resource.kind === 'mcp-server' ? 'I126' : 'I127'} />}
                title={resource.name}
                detail={resource.field}
                href={resourceHref(resource)}
              />
            ))}
          </ResourceList>
        </SettingsSection>
      )}
      {data.truncated && <Muted>{TRUNCATED_NOTE}</Muted>}
    </SectionStack>
  )
}
