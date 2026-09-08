'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Chip, ChipDropdown, ChipLink, cn } from '@sim/emcn'
import { ArrowLeft, Plus } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { HEADER_ACTION_CLUSTER, PAGE_HEADER_BAR } from '@/components/page-header-bar'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import {
  blockTypeToIconMap,
  type Integration,
  resolveCredentialDisplay,
  resolveOAuthServiceForIntegration,
} from '@/lib/integrations'
import { credentialProviderMatchesService } from '@/lib/oauth'
import { ConnectOAuthModal } from '@/app/workspace/[workspaceId]/components/connect-oauth-modal'
import { RESOURCE_TILE_BASE } from '@/app/workspace/[workspaceId]/components/resource-tile'
import { IntegrationSkillsSection } from '@/app/workspace/[workspaceId]/integrations/[block]/integration-skills-section'
import { connectParam } from '@/app/workspace/[workspaceId]/integrations/[block]/search-params'
import { ConnectPersonalTokenModal } from '@/app/workspace/[workspaceId]/integrations/components/connect-personal-token-modal'
import {
  ConnectServiceAccountModal,
  useServiceAccountConnectTarget,
} from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal'
import { IntegrationSection } from '@/app/workspace/[workspaceId]/integrations/components/integration-section'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import {
  CONNECT_MODE,
  resolveAvailableConnectMode,
} from '@/app/workspace/[workspaceId]/integrations/connect-route'
import { useScrollRestoration } from '@/app/workspace/[workspaceId]/integrations/hooks/use-scroll-restoration'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { getTileIconColorClass } from '@/blocks/icon-color'
import { storeCuratedPrompt } from '@/blocks/integration-matcher'
import {
  getSuggestedSkillsForBlock,
  getTemplatesForBlock,
  type ScopedBlockTemplate,
} from '@/blocks/registry'
import { useWorkspaceCredentials } from '@/hooks/queries/credentials'
import { useOAuthReturnRouter } from '@/hooks/use-oauth-return'
import { usePermissionConfig } from '@/hooks/use-permission-config'

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
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  useOAuthReturnRouter()
  const router = useRouter()
  const [connectMode, setConnectMode] = useQueryState(connectParam.key, connectParam.parser)
  const Icon = blockTypeToIconMap[integration.type]
  const matchingTemplates = getTemplatesForBlock(integration.type)
  const suggestedSkills = getSuggestedSkillsForBlock(integration.type)
  const oauthService = resolveOAuthServiceForIntegration(integration)
  const { integrationAvailability, isLoading: permissionConfigLoading } = usePermissionConfig()
  const { chatEnabled } = useDeploymentShape()
  const availability = integrationAvailability.get(integration.type.toLowerCase())
  const oauthAvailable = Boolean(oauthService) && (availability?.oauthAvailable ?? true)
  const [oauthOpen, setOAuthOpen] = useState(false)
  const [personalTokenOpen, setPersonalTokenOpen] = useState(false)
  const personalTokenAvailable =
    integration.type === 'gitlab' &&
    (availability?.state === 'ready' || availability?.state === 'limited')

  const { data: credentials = [], isPending: credentialsLoading } = useWorkspaceCredentials({
    workspaceId,
    enabled: Boolean(workspaceId),
  })

  useScrollRestoration(scrollContainerRef, { ready: !credentialsLoading })

  /**
   * Matches on the service's own id *or* its service-account id, so a family
   * credential lists on every product it powers. Comparing resolved
   * `providerId`s instead hides it from all of them.
   */
  const connectedCredentials = useMemo(() => {
    if (integration.type === 'gitlab')
      return credentials.filter((c) => c.type === 'personal_token' && c.providerId === 'gitlab')
    if (!oauthService) return []
    return credentials.filter(
      (c) =>
        (c.type === 'oauth' || c.type === 'service_account') &&
        c.providerId &&
        credentialProviderMatchesService(c.providerId, oauthService)
    )
  }, [credentials, oauthService, integration.type])
  const [serviceAccountOpen, setServiceAccountOpen] = useState(false)
  const serviceAccountTarget = useServiceAccountConnectTarget({
    serviceAccountProviderId: oauthService?.serviceAccountProviderId,
    serviceName: oauthService?.serviceName,
    serviceIcon: oauthService?.serviceIcon,
  })
  const serviceAccountDeploymentAvailable =
    availability?.state === 'ready' || availability?.state === 'limited'
  const hasServiceAccount =
    serviceAccountDeploymentAvailable &&
    Boolean(serviceAccountTarget) &&
    !serviceAccountTarget?.hidden
  const serviceAccountConnectLabel = serviceAccountTarget?.label ?? 'Add service account'
  const hasHandledConnectQueryRef = useRef(false)

  useEffect(() => {
    if (hasHandledConnectQueryRef.current || !connectMode || permissionConfigLoading) return

    const availableConnectMode = resolveAvailableConnectMode(connectMode, {
      oauth: Boolean(oauthService) && oauthAvailable,
      serviceAccount: hasServiceAccount,
      personalToken: personalTokenAvailable,
    })
    if (!availableConnectMode) return

    if (availableConnectMode === CONNECT_MODE.oauth) {
      setOAuthOpen(true)
    } else if (availableConnectMode === CONNECT_MODE.personalToken) {
      setPersonalTokenOpen(true)
    } else {
      setServiceAccountOpen(true)
    }

    hasHandledConnectQueryRef.current = true
    void setConnectMode(null, { history: 'replace', scroll: false })
  }, [
    connectMode,
    oauthService,
    oauthAvailable,
    hasServiceAccount,
    personalTokenAvailable,
    permissionConfigLoading,
    setConnectMode,
  ])

  const connectOptions = oauthService
    ? [
        ...(oauthAvailable
          ? [
              {
                value: CONNECT_MODE.oauth,
                label: 'Connect with OAuth',
                icon: oauthService.serviceIcon,
              },
            ]
          : []),
        ...(hasServiceAccount
          ? [
              {
                value: CONNECT_MODE.serviceAccount,
                label: serviceAccountConnectLabel,
                icon: serviceAccountTarget?.serviceIcon ?? oauthService.serviceIcon,
              },
            ]
          : []),
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
      <div className={PAGE_HEADER_BAR}>
        <ChipLink href={`/workspace/${workspaceId}/integrations`} leftIcon={ArrowLeft}>
          Integrations
        </ChipLink>
        <div className={cn('ml-auto', HEADER_ACTION_CLUSTER)}>
          {personalTokenAvailable ? (
            <Chip variant='primary' leftIcon={Plus} onClick={() => setPersonalTokenOpen(true)}>
              Add personal token
            </Chip>
          ) : oauthService ? (
            connectOptions.length > 1 ? (
              <ChipDropdown
                variant='primary'
                leftIcon={Plus}
                placeholder='Add to Sim'
                showSelectedCheck={false}
                options={connectOptions}
                onChange={handleSelectConnectOption}
                matchTriggerWidth={false}
              />
            ) : oauthAvailable ? (
              <Chip variant='primary' leftIcon={Plus} onClick={() => setOAuthOpen(true)}>
                Add to Sim
              </Chip>
            ) : hasServiceAccount ? (
              <Chip variant='primary' leftIcon={Plus} onClick={() => setServiceAccountOpen(true)}>
                {serviceAccountConnectLabel}
              </Chip>
            ) : (
              <Chip disabled>Unavailable</Chip>
            )
          ) : chatEnabled ? (
            <Chip variant='primary' leftIcon={Plus} onClick={handleAddInChat}>
              Add to Sim
            </Chip>
          ) : null}
        </div>
      </div>
      {personalTokenAvailable && (
        <ConnectPersonalTokenModal
          open={personalTokenOpen}
          onOpenChange={setPersonalTokenOpen}
          workspaceId={workspaceId}
        />
      )}
      {oauthService && oauthAvailable && (
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
          requireDataverseEnvironment={integration.type === 'microsoft_dynamics_365'}
        />
      )}
      {hasServiceAccount && serviceAccountTarget && (
        <ConnectServiceAccountModal
          open={serviceAccountOpen}
          onOpenChange={setServiceAccountOpen}
          workspaceId={workspaceId}
          serviceAccountProviderId={serviceAccountTarget.serviceAccountProviderId}
          atlassianProduct={oauthService?.providerId === 'confluence' ? 'confluence' : 'jira'}
          serviceName={serviceAccountTarget.serviceName}
          serviceIcon={serviceAccountTarget.serviceIcon}
        />
      )}
      <div
        ref={scrollContainerRef}
        className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'
      >
        <div className='mx-auto flex max-w-[48rem] flex-col gap-7 pb-3'>
          <div className='flex flex-col gap-3'>
            {Icon ? (
              <IntegrationTile blockType={integration.type} icon={Icon} />
            ) : (
              <div
                className={cn(RESOURCE_TILE_BASE, getTileIconColorClass(integration.bgColor))}
                style={{ background: integration.bgColor }}
              >
                {integration.name.charAt(0)}
              </div>
            )}
            <div className='flex flex-col gap-1'>
              <h1 className='text-[var(--text-body)] text-lg'>{integration.name}</h1>
              <p className='text-[var(--text-muted)] text-md'>{integration.description}</p>
            </div>
          </div>

          {connectedCredentials.length > 0 && (
            <IntegrationSection label='Connected'>
              {connectedCredentials.map((credential) => (
                <SettingsResourceRow
                  key={credential.id}
                  iconVariant='custom'
                  icon={Icon && <IntegrationTile blockType={integration.type} icon={Icon} />}
                  title={credential.displayName}
                  description={
                    credential.description || resolveCredentialDisplay(credential).subtitle
                  }
                  href={`/workspace/${workspaceId}/integrations/connected/${credential.id}`}
                  clickLabel={`Open ${credential.displayName}`}
                  navigable
                />
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

          {/* Every template hands its prompt to Chat, so the section has no
              destination without it. */}
          {chatEnabled && matchingTemplates.length > 0 && (
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
    <SettingsSection label='Templates'>
      <div className={RESOURCE_LIST_STACK}>
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
    </SettingsSection>
  )
}

interface TemplateRowProps {
  blockTypes: string[]
  title: string
  prompt: string
  onSelect: (prompt: string) => void
}

/**
 * Template row. Click seeds the home page chat with `prompt` and navigates to the
 * workspace home, matching the `ShowcaseWithExplore` flow — so it activates rather
 * than links, and its leading visual is an overlapping block cluster.
 */
function TemplateRow({ blockTypes, title, prompt, onSelect }: TemplateRowProps) {
  return (
    <SettingsResourceRow
      iconVariant='custom'
      icon={<TemplateIcons blockTypes={blockTypes} />}
      title={title}
      description={prompt}
      onClick={() => onSelect(prompt)}
      clickLabel={`Use template ${title}`}
      navigable
    />
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
