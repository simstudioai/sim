'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Plus } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { Chip, ChipDropdown, ChipLink } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import {
  blockTypeToIconMap,
  type Integration,
  resolveOAuthServiceForIntegration,
} from '@/lib/integrations'
import { getServiceConfigByProviderId } from '@/lib/oauth'
import { ConnectOAuthModal } from '@/app/workspace/[workspaceId]/components/connect-oauth-modal'
import { IntegrationSkillsSection } from '@/app/workspace/[workspaceId]/integrations/[block]/integration-skills-section'
import { connectParam } from '@/app/workspace/[workspaceId]/integrations/[block]/search-params'
import { ConnectServiceAccountModal } from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal'
import { IntegrationSection } from '@/app/workspace/[workspaceId]/integrations/components/integration-section'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import { CONNECT_MODE } from '@/app/workspace/[workspaceId]/integrations/connect-route'
import { storeCuratedPrompt } from '@/blocks/integration-matcher'
import {
  getSuggestedSkillsForBlock,
  getTemplatesForBlock,
  type ScopedBlockTemplate,
} from '@/blocks/manifest'
import { useWorkspaceCredentials } from '@/hooks/queries/credentials'
import { useOAuthReturnRouter } from '@/hooks/use-oauth-return'

/** Maximum number of overlapping icon tiles rendered per template row. */
const TEMPLATE_CLUSTER_MAX = 3 as const

/**
 * Z-index per cluster position so the primary tile reads on top and trailing
 * tiles cascade behind it.
 */
const TEMPLATE_TILE_Z = ['z-30', 'z-20', 'z-10'] as const

interface IntegrationBlockDetailProps {
  integration: Integration
  workspaceId: string
}

export function IntegrationBlockDetail({ integration, workspaceId }: IntegrationBlockDetailProps) {
  useOAuthReturnRouter()
  const router = useRouter()
  const [connectMode, setConnectMode] = useQueryState(connectParam.key, connectParam.parser)
  const Icon = blockTypeToIconMap[integration.type]
  const matchingTemplates = getTemplatesForBlock(integration.type)
  const suggestedSkills = getSuggestedSkillsForBlock(integration.type)
  const oauthService = resolveOAuthServiceForIntegration(integration)
  const [oauthOpen, setOAuthOpen] = useState(false)

  const { data: credentials = [] } = useWorkspaceCredentials({
    workspaceId,
    enabled: Boolean(workspaceId),
  })

  const connectedCredentials = useMemo(() => {
    if (!oauthService) return []
    return credentials.filter(
      (c) =>
        (c.type === 'oauth' || c.type === 'service_account') &&
        c.providerId &&
        getServiceConfigByProviderId(c.providerId)?.providerId === oauthService.providerId
    )
  }, [credentials, oauthService])
  const [serviceAccountOpen, setServiceAccountOpen] = useState(false)
  const hasServiceAccount = Boolean(oauthService?.serviceAccountProviderId)
  const hasHandledConnectQueryRef = useRef(false)

  useEffect(() => {
    if (hasHandledConnectQueryRef.current) return
    if (!connectMode) return

    let handled = false
    if (connectMode === CONNECT_MODE.oauth && oauthService) {
      setOAuthOpen(true)
      handled = true
    } else if (
      connectMode === CONNECT_MODE.serviceAccount &&
      oauthService?.serviceAccountProviderId
    ) {
      setServiceAccountOpen(true)
      handled = true
    }
    if (!handled) return

    hasHandledConnectQueryRef.current = true
    void setConnectMode(null, { history: 'replace', scroll: false })
  }, [connectMode, oauthService, setConnectMode])

  const connectOptions = oauthService
    ? [
        {
          value: CONNECT_MODE.oauth,
          label: 'Connect with OAuth',
          icon: oauthService.serviceIcon,
        },
        {
          value: CONNECT_MODE.serviceAccount,
          label: 'Add service account',
          icon: oauthService.serviceIcon,
        },
      ]
    : []

  const handleSelectConnectOption = (value: string) => {
    if (value === CONNECT_MODE.oauth) setOAuthOpen(true)
    else if (value === CONNECT_MODE.serviceAccount) setServiceAccountOpen(true)
  }

  const handleAddInChat = () => {
    storeCuratedPrompt(`Explore ${integration.name}. What can I do?`)
    router.push(`/workspace/${workspaceId}/home`)
  }

  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <div className='flex flex-shrink-0 items-center bg-[var(--bg)] px-[16px] pt-[8.5px] pb-[8.5px]'>
        <ChipLink href={`/workspace/${workspaceId}/integrations`} leftIcon={ArrowLeft}>
          Integrations
        </ChipLink>
        <div className='ml-auto flex items-center'>
          {oauthService ? (
            hasServiceAccount ? (
              <ChipDropdown
                variant='primary'
                leftIcon={Plus}
                placeholder='Add to Sim'
                showSelectedCheck={false}
                options={connectOptions}
                onChange={handleSelectConnectOption}
                matchTriggerWidth={false}
              />
            ) : (
              <Chip variant='primary' leftIcon={Plus} onClick={() => setOAuthOpen(true)}>
                Add to Sim
              </Chip>
            )
          ) : (
            <Chip variant='primary' leftIcon={Plus} onClick={handleAddInChat}>
              Add to Sim
            </Chip>
          )}
        </div>
      </div>
      {oauthService && (
        <ConnectOAuthModal
          mode='connect'
          origin='integrations'
          open={oauthOpen}
          onOpenChange={setOAuthOpen}
          workspaceId={workspaceId}
          providerId={oauthService.providerId}
          requiredScopes={oauthService.requiredScopes}
          serviceName={oauthService.serviceName}
          serviceIcon={oauthService.serviceIcon}
        />
      )}
      {oauthService?.serviceAccountProviderId && (
        <ConnectServiceAccountModal
          open={serviceAccountOpen}
          onOpenChange={setServiceAccountOpen}
          workspaceId={workspaceId}
          serviceAccountProviderId={oauthService.serviceAccountProviderId}
          serviceName={oauthService.serviceName}
          serviceIcon={oauthService.serviceIcon}
        />
      )}
      <div className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'>
        <div className='mx-auto flex max-w-[48rem] flex-col gap-7 pb-3'>
          <div className='flex flex-col gap-3'>
            {Icon ? (
              <IntegrationTile blockType={integration.type} icon={Icon} />
            ) : (
              <div
                className='flex size-9 flex-shrink-0 items-center justify-center rounded-xl border border-[var(--border-1)] text-white'
                style={{ background: integration.bgColor }}
              >
                {integration.name.charAt(0)}
              </div>
            )}
            <div className='flex flex-col gap-1'>
              <h1 className='font-medium text-[var(--text-body)] text-lg'>{integration.name}</h1>
              <p className='text-[var(--text-muted)] text-md'>{integration.description}</p>
            </div>
          </div>

          {connectedCredentials.length > 0 && (
            <IntegrationSection label='Connected'>
              {connectedCredentials.map((credential) => (
                <Link
                  key={credential.id}
                  href={`/workspace/${workspaceId}/integrations/connected/${credential.id}`}
                  className='flex items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover-hover:bg-[var(--surface-active)]'
                >
                  {Icon && <IntegrationTile blockType={integration.type} icon={Icon} />}
                  <div className='flex min-w-0 flex-1 flex-col'>
                    <span className='truncate text-[14px] text-[var(--text-body)]'>
                      {credential.displayName}
                    </span>
                    <span className='truncate text-[12px] text-[var(--text-muted)]'>
                      {credential.description || oauthService?.serviceName}
                    </span>
                  </div>
                  <ArrowRight className='size-4 flex-shrink-0 text-[var(--text-icon)]' />
                </Link>
              ))}
            </IntegrationSection>
          )}

          {suggestedSkills.length > 0 && (
            <IntegrationSkillsSection
              skills={suggestedSkills}
              workspaceId={workspaceId}
              integrationType={integration.type}
            />
          )}

          {matchingTemplates.length > 0 && (
            <TemplatesSection
              integration={integration}
              templates={matchingTemplates}
              workspaceId={workspaceId}
            />
          )}
        </div>
      </div>
    </div>
  )
}

interface TemplatesSectionProps {
  integration: Integration
  templates: readonly ScopedBlockTemplate[]
  workspaceId: string
}

function TemplatesSection({ integration, templates, workspaceId }: TemplatesSectionProps) {
  const router = useRouter()

  const handleSelect = (prompt: string) => {
    storeCuratedPrompt(prompt)
    router.push(`/workspace/${workspaceId}/home`)
  }

  return (
    <section className='flex flex-col'>
      <span className='pl-0.5 text-[var(--text-muted)] text-small'>Templates</span>
      <div className='mt-[9px] mb-3 h-px bg-[var(--border)]' />
      <div className='-mx-2 flex flex-col gap-y-0.5'>
        {templates.map((template) => {
          const blockTypes = [integration.type, ...template.otherBlockTypes].slice(
            0,
            TEMPLATE_CLUSTER_MAX
          )
          return (
            <TemplateRow
              key={template.title}
              blockTypes={blockTypes}
              title={template.title}
              prompt={template.prompt}
              onSelect={handleSelect}
            />
          )
        })}
      </div>
    </section>
  )
}

interface TemplateRowProps {
  blockTypes: string[]
  title: string
  prompt: string
  onSelect: (prompt: string) => void
}

/**
 * Template row that mirrors `IntegrationItem` from the integrations index
 * byte-for-byte (icon cluster · title · description · trailing `ArrowRight`).
 * Renders as a `<button>` because click seeds the home page chat with `prompt`
 * and navigates to the workspace home, matching the `ShowcaseWithExplore` flow.
 */
function TemplateRow({ blockTypes, title, prompt, onSelect }: TemplateRowProps) {
  return (
    <button
      type='button'
      onClick={() => onSelect(prompt)}
      className='group flex items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover-hover:bg-[var(--surface-active)]'
    >
      <TemplateIcons blockTypes={blockTypes} />
      <div className='flex min-w-0 flex-1 flex-col'>
        <span className='truncate text-[14px] text-[var(--text-body)]'>{title}</span>
        <span className='truncate text-[12px] text-[var(--text-muted)]'>{prompt}</span>
      </div>
      <ArrowRight className='size-4 flex-shrink-0 text-[var(--text-icon)]' />
    </button>
  )
}

interface TemplateIconsProps {
  blockTypes: string[]
}

/**
 * Horizontal overlapping icon cluster. Primary integration (idx === 0) sits
 * left and on top, rendered identically to a bare `IntegrationTile` so it
 * matches `IntegrationItem` outside the templates list with no halo. Trailing
 * tiles cascade behind with negative margin and carry a non-layout-affecting
 * outline whose color tracks the row background exactly — `--bg` at rest and
 * `--surface-active` on row hover via the parent `group`. The outline is
 * visually invisible in both states yet cleanly cuts each silhouette from the
 * tile behind it. `outline` is preferred over `ring` here because it has no
 * `box-shadow` specificity collisions and lets us transition just the
 * `outline-color` token rather than the full shadow stack.
 */
function TemplateIcons({ blockTypes }: TemplateIconsProps) {
  return (
    <span aria-hidden className='flex items-center'>
      {blockTypes.map((bt, idx) => {
        const ToolIcon = blockTypeToIconMap[bt]
        if (!ToolIcon) return null
        const z = TEMPLATE_TILE_Z[idx]
        if (!z) return null
        const isTrailing = idx > 0
        return (
          <span
            key={bt}
            className={cn(
              '[&:not(:first-child)]:-ml-2 relative rounded-xl first:ml-0',
              z,
              isTrailing &&
                'outline outline-2 outline-[var(--bg)] transition-[outline-color] duration-150 group-hover:outline-[var(--surface-active)]'
            )}
          >
            <IntegrationTile blockType={bt} icon={ToolIcon} />
          </span>
        )
      })}
    </span>
  )
}
