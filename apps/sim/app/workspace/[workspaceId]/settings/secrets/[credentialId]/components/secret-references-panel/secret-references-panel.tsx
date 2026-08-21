'use client'

import { Wrench } from '@sim/emcn/icons'
import { McpIcon } from '@/components/icons'
import type { SecretReferenceResourcePayload } from '@/lib/api/contracts'
import { DetailSection } from '@/app/workspace/[workspaceId]/components/credential-detail'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import {
  customToolIdParam,
  mcpServerIdParam,
} from '@/app/workspace/[workspaceId]/settings/[section]/search-params'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { getBlock } from '@/blocks/registry'
import { useSecretReferences } from '@/hooks/queries/credentials'

interface SecretReferencesPanelProps {
  workspaceId: string
  secretName: string
}

/**
 * Shown when a capped scan produced nothing to list. Distinct from "not referenced": the scan
 * stopped early, so silence here is absence of evidence, and saying otherwise would invite
 * deleting a key that four blocks past the cap still depend on.
 */
const TRUNCATED_NOTE = 'This secret is referenced in more places than can be listed here.'

/** A custom tool and an MCP server can each carry the key more than once, so `id` alone is not a key. */
function resourceKey(resource: SecretReferenceResourcePayload): string {
  return `${resource.kind}:${resource.id}:${resource.field}`
}

/**
 * The settings page that owns the resource, deep-linked to its detail through the same param
 * that page reads — so a cascade row navigates like a block row instead of dead-ending.
 */
function resourceHref(workspaceId: string, resource: SecretReferenceResourcePayload): string {
  const settings = `/workspace/${workspaceId}/settings`
  return resource.kind === 'mcp-server'
    ? `${settings}/mcp?${mcpServerIdParam.key}=${encodeURIComponent(resource.id)}`
    : `${settings}/custom-tools?${customToolIdParam.key}=${encodeURIComponent(resource.id)}`
}

/**
 * Where one secret is wired in: the blocks that name it as `{{KEY}}`, grouped under their
 * workflow, then the custom tools and MCP servers whose own bodies carry it.
 *
 * The companion to the Logs tab, and the half of the question runs cannot answer — a secret
 * four blocks depend on but nothing has executed yet has an empty trail and a full list here.
 */
export function SecretReferencesPanel({ workspaceId, secretName }: SecretReferencesPanelProps) {
  const { data, isPending, isError } = useSecretReferences({ workspaceId, name: secretName })

  if (isError) {
    return (
      <SettingsEmptyState variant='inline' tone='error'>
        Could not load references.
      </SettingsEmptyState>
    )
  }

  if (isPending) {
    return <SettingsEmptyState variant='inline'>Loading…</SettingsEmptyState>
  }

  if (data.workflows.length === 0 && data.resources.length === 0) {
    return (
      <SettingsEmptyState variant='inline'>
        {data.truncated ? TRUNCATED_NOTE : 'This secret is not referenced in any workflow.'}
      </SettingsEmptyState>
    )
  }

  return (
    <div className='flex flex-col gap-7'>
      {data.workflows.map((workflow) => (
        <DetailSection key={workflow.workflowId} title={workflow.workflowName}>
          <div className={RESOURCE_LIST_STACK}>
            {workflow.blocks.map((block) => {
              const BlockIcon = getBlock(block.blockType)?.icon
              return (
                <SettingsResourceRow
                  key={block.blockId}
                  iconVariant='custom'
                  /**
                   * The brand-tinted block tile, so a block reads here exactly as it does on an
                   * integrations row. A block icon is a brand mark, not a glyph: the tile owns
                   * its fill and picks the contrasting icon colour, which is why it is never a
                   * bare icon under `--text-icon`. An unregistered type has no tile, and the
                   * row drops the whole slot for a nullish icon.
                   */
                  icon={
                    BlockIcon ? (
                      <IntegrationTile blockType={block.blockType} icon={BlockIcon} />
                    ) : undefined
                  }
                  title={block.blockName}
                  description={block.field}
                  href={`/workspace/${workspaceId}/w/${workflow.workflowId}`}
                  clickLabel={`Open ${workflow.workflowName}`}
                  navigable
                />
              )
            })}
          </div>
        </DetailSection>
      ))}

      {data.resources.length > 0 && (
        <DetailSection title='Custom tools and MCP servers'>
          <div className={RESOURCE_LIST_STACK}>
            {data.resources.map((resource) => (
              <SettingsResourceRow
                key={resourceKey(resource)}
                icon={
                  resource.kind === 'mcp-server' ? (
                    <McpIcon className='text-[var(--text-icon)]' />
                  ) : (
                    <Wrench className='text-[var(--text-icon)]' />
                  )
                }
                iconFilled
                title={resource.name}
                description={resource.field}
                href={resourceHref(workspaceId, resource)}
                clickLabel={`Open ${resource.name}`}
                navigable
              />
            ))}
          </div>
        </DetailSection>
      )}

      {data.truncated && <p className='text-[var(--text-muted)] text-caption'>{TRUNCATED_NOTE}</p>}
    </div>
  )
}
