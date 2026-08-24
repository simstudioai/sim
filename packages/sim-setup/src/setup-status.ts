import {
  type EnvCapabilityValues,
  hasEnvCapabilityValue,
} from '@sim/deployment-config/env-capabilities'
import {
  type IntegrationAvailability,
  resolveIntegrationAvailability,
} from '@sim/deployment-config/integration-availability'
import { SETUP_FEATURES } from './capability-config'
import {
  buildEnvCapabilityStatus,
  type EnvCapabilityFeatureStatuses,
  type SetupStatusFeatureId,
} from './capability-status'
import { REQUIRED_APP_KEYS } from './checks'
import { type ConfigurationSource, discoverConfigurationSources } from './configuration-sources'
import { isPlaceholder, isUsableSecret } from './env-files'
import { glyph, theme } from './theme'

type FeatureStatus = EnvCapabilityFeatureStatuses[keyof EnvCapabilityFeatureStatuses]

interface CoreConfigurationIssue {
  key: (typeof REQUIRED_APP_KEYS)[number]
  reason: 'missing' | 'placeholder' | 'invalid secret' | 'invalid URL'
}

export type SetupStatusSource = Omit<ConfigurationSource, 'values'>

export interface SetupStatusReport {
  source: SetupStatusSource
  environmentAvailable: boolean
  coreIssues: readonly CoreConfigurationIssue[]
  capabilityStatus: ReturnType<typeof buildEnvCapabilityStatus> | null
  integrationAvailability: readonly IntegrationAvailability[] | null
  failed: boolean
}

const SECRET_KEYS = new Set(['BETTER_AUTH_SECRET', 'ENCRYPTION_KEY', 'INTERNAL_API_SECRET'])
const URL_KEYS = new Set(['DATABASE_URL', 'BETTER_AUTH_URL', 'NEXT_PUBLIC_APP_URL'])
const FEATURE_ORDER: readonly SetupStatusFeatureId[] = SETUP_FEATURES.flatMap((feature) =>
  feature.id === 'chat' || feature.id === 'integration' ? [] : [feature.id]
)

function readString(values: EnvCapabilityValues, key: string): string | undefined {
  const value =
    values instanceof Map ? values.get(key) : (values as Readonly<Record<string, unknown>>)[key]
  return value === undefined || value === null ? undefined : String(value)
}

function inspectCoreConfiguration(values: EnvCapabilityValues): CoreConfigurationIssue[] {
  const issues: CoreConfigurationIssue[] = []
  for (const key of REQUIRED_APP_KEYS) {
    const value = readString(values, key)
    if (!hasEnvCapabilityValue(values, key)) {
      issues.push({ key, reason: 'missing' })
    } else if (value && isPlaceholder(value)) {
      issues.push({ key, reason: 'placeholder' })
    } else if (value && SECRET_KEYS.has(key) && !isUsableSecret(key, value)) {
      issues.push({ key, reason: 'invalid secret' })
    } else if (value && URL_KEYS.has(key)) {
      try {
        new URL(value)
      } catch {
        issues.push({ key, reason: 'invalid URL' })
      }
    }
  }
  return issues
}

function titleCase(value: string): string {
  if (value === 'openai') return 'OpenAI'
  return value
    .split(/[-_]/)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function featureDetail(feature: FeatureStatus): string {
  switch (feature.id) {
    case 'email':
      return feature.providerIds.length > 0
        ? feature.providerIds
            .map(
              (id) =>
                feature.providers.find((provider) => provider.id === id)?.label ?? titleCase(id)
            )
            .join(' → ')
        : 'Not configured'
    case 'storage':
      if (feature.providerId === 'local') return 'Local disk (default)'
      return (
        feature.providers.find((provider) => provider.id === feature.providerId)?.label ??
        (feature.providerId ? titleCase(feature.providerId) : 'Not configured')
      )
    case 'sandbox':
      if (feature.providerId === 'disabled') return 'Disabled (local JavaScript only)'
      return feature.providerId ? titleCase(feature.providerId) : 'Not configured'
    case 'jobs':
      return feature.providerId === 'database' ? 'Database queue (default)' : 'Trigger.dev'
    case 'cache':
      return feature.providerId === 'database' ? 'Postgres (default)' : 'Redis'
    case 'knowledge':
      if (feature.providerId === 'local') return 'Local parser (default)'
      if (feature.providerId === 'azure-mistral') return 'Azure Mistral OCR'
      return feature.providerId === 'mistral' ? 'Mistral OCR' : 'Not configured'
    case 'knowledge-embeddings':
      return feature.providerIds.length > 0
        ? feature.providerIds
            .map(
              (id) =>
                feature.providers.find((provider) => provider.id === id)?.label ?? titleCase(id)
            )
            .join(' → ')
        : 'Not configured'
    case 'llm': {
      const configured = Object.values(feature.pools)
        .filter((pool) => pool.state === 'configured')
        .map((pool) => `${titleCase(pool.id)} (${pool.effectiveKeyCount})`)
      return configured.length > 0 ? configured.join(', ') : 'No global key pools'
    }
  }
}

function featureGlyph(feature: FeatureStatus): string {
  if (feature.issue && (feature.state === 'configured' || feature.state === 'default')) {
    return glyph.warn
  }
  if (feature.issue || feature.state === 'partial' || feature.state === 'invalid') return glyph.fail
  if (feature.state === 'missing') return glyph.skip
  return glyph.pass
}

function withoutSetupCommand(message: string): string {
  return message.replace(/\s+Run npx sim-setup add [^.]*\.$/, '')
}

function setupHint(source: SetupStatusSource, command: string): string | null {
  if (source.managedByCurrentCheckout) return command
  if (source.kind === 'helm') return 'update the app Secret/values and upgrade this Helm release'
  if (source.kind === 'compose') return 'update this Compose project and recreate its app container'
  return null
}

function uniqueNames(integrations: readonly IntegrationAvailability[]): string[] {
  return [...new Set(integrations.map((integration) => integration.name))].sort((a, b) =>
    a.localeCompare(b)
  )
}

interface IntegrationGroup {
  setupCommand?: string
  missingFields: readonly string[]
  names: string[]
}

function groupIntegrations(
  integrations: readonly IntegrationAvailability[]
): readonly IntegrationGroup[] {
  const groups = new Map<string, IntegrationGroup>()
  for (const integration of integrations) {
    const missingFields = [...integration.missingFields].sort()
    const key = `${integration.setupCommand ?? 'clientless'}:${missingFields.join(',')}`
    const existing = groups.get(key)
    if (existing) {
      if (!existing.names.includes(integration.name)) existing.names.push(integration.name)
      continue
    }
    groups.set(key, {
      setupCommand: integration.setupCommand,
      missingFields,
      names: [integration.name],
    })
  }
  return [...groups.values()].map((group) => ({
    ...group,
    names: group.names.sort((left, right) => left.localeCompare(right)),
  }))
}

function renderIntegrationGroup(
  source: SetupStatusSource,
  marker: string,
  group: IntegrationGroup
): string[] {
  const missing =
    group.missingFields.length > 0 ? ` — missing ${group.missingFields.join(', ')}` : ''
  const lines = [` ${marker} ${group.names.join(', ')}${missing}`]
  if (group.setupCommand) {
    const hint = setupHint(source, group.setupCommand)
    if (hint) lines.push(`   ${theme.muted(`configure: ${hint}`)}`)
  }
  return lines
}

/** Builds a non-secret report for one effective deployment configuration. */
export function buildSetupStatusReport(source: ConfigurationSource): SetupStatusReport {
  const safeSource: SetupStatusSource = {
    kind: source.kind,
    label: source.label,
    location: source.location,
    managedByCurrentCheckout: source.managedByCurrentCheckout,
    ...(source.warning ? { warning: source.warning } : {}),
    ...(source.configurationIssues ? { configurationIssues: source.configurationIssues } : {}),
  }
  if (!source.values) {
    return {
      source: safeSource,
      environmentAvailable: false,
      coreIssues: [],
      capabilityStatus: null,
      integrationAvailability: null,
      failed: true,
    }
  }

  const coreIssues = inspectCoreConfiguration(source.values)
  const capabilityStatus = buildEnvCapabilityStatus(source.values)
  const integrationAvailability = resolveIntegrationAvailability(source.values)
  const brokenCapability = Object.values(capabilityStatus.features).some(
    (feature) =>
      feature.state === 'partial' ||
      feature.state === 'invalid' ||
      (feature.state === 'missing' && Boolean(feature.issue))
  )
  const brokenIntegration = integrationAvailability.some(
    (integration) => integration.state === 'misconfigured'
  )
  const brokenOAuthClient =
    capabilityStatus.oauthClients.partialCount > 0 || capabilityStatus.oauthClients.invalidCount > 0

  return {
    source: safeSource,
    environmentAvailable: true,
    coreIssues,
    capabilityStatus,
    integrationAvailability,
    failed:
      coreIssues.length > 0 ||
      Boolean(source.configurationIssues?.length) ||
      brokenCapability ||
      brokenIntegration ||
      brokenOAuthClient,
  }
}

/** Renders a report without including any configured environment values. */
export function renderSetupStatusReport(report: SetupStatusReport): string {
  const { source } = report
  const lines = [
    theme.heading(source.label),
    ` ${report.environmentAvailable ? glyph.pass : glyph.fail} ${source.location}`,
  ]
  if (source.warning) lines.push(` ${glyph.warn} ${source.warning}`)
  lines.push('')

  if (!report.environmentAvailable || !report.capabilityStatus || !report.integrationAvailability) {
    lines.push(theme.heading('Configuration'))
    lines.push(` ${glyph.fail} Effective environment is unavailable.`)
    return lines.join('\n')
  }

  lines.push(theme.heading('Core configuration'))
  if (report.coreIssues.length === 0 && !source.configurationIssues?.length) {
    lines.push(` ${glyph.pass} All ${REQUIRED_APP_KEYS.length} required app values are present`)
  } else {
    for (const coreIssue of report.coreIssues) {
      lines.push(` ${glyph.fail} ${coreIssue.key}: ${coreIssue.reason}`)
    }
    for (const configurationIssue of source.configurationIssues ?? []) {
      lines.push(` ${glyph.fail} ${configurationIssue}`)
    }
  }
  lines.push('')

  lines.push(theme.heading('Capabilities'))
  for (const id of FEATURE_ORDER) {
    const feature = report.capabilityStatus.features[id]
    lines.push(` ${featureGlyph(feature)} ${feature.label}: ${featureDetail(feature)}`)
    if (feature.issue) {
      lines.push(`   ${theme.muted(withoutSetupCommand(feature.issue.message))}`)
    }
    if (feature.state === 'missing' || feature.issue) {
      const hint = setupHint(source, feature.setupCommand)
      if (hint) lines.push(`   ${theme.muted(`configure: ${hint}`)}`)
    }
  }
  lines.push('')

  const deploymentIntegrations = report.integrationAvailability.filter(
    (integration) => integration.setupCommand || integration.serviceAccountAvailable
  )
  const ready = deploymentIntegrations.filter((integration) => integration.state === 'ready')
  const limited = deploymentIntegrations.filter((integration) => integration.state === 'limited')
  const unavailable = deploymentIntegrations.filter(
    (integration) => integration.state === 'unavailable'
  )
  const misconfigured = deploymentIntegrations.filter(
    (integration) => integration.state === 'misconfigured'
  )

  lines.push(theme.heading('OAuth integrations'))
  const readyNames = uniqueNames(ready)
  lines.push(
    readyNames.length > 0
      ? ` ${glyph.pass} OAuth ready (${readyNames.length}): ${readyNames.join(', ')}`
      : ` ${glyph.skip} OAuth ready: none`
  )
  const limitedNames = uniqueNames(limited)
  if (limitedNames.length > 0) {
    lines.push(
      ` ${glyph.warn} OAuth unavailable; workspace credential option exists (${limitedNames.length}): ${limitedNames.join(', ')}`
    )
    for (const group of groupIntegrations(limited)) {
      lines.push(...renderIntegrationGroup(source, glyph.warn, group))
    }
  }
  if (unavailable.length > 0) {
    lines.push(` ${glyph.skip} Unavailable (${uniqueNames(unavailable).length})`)
    for (const group of groupIntegrations(unavailable)) {
      lines.push(...renderIntegrationGroup(source, glyph.skip, group))
    }
  }
  if (misconfigured.length > 0) {
    lines.push(` ${glyph.fail} Misconfigured (${uniqueNames(misconfigured).length})`)
    for (const group of groupIntegrations(misconfigured)) {
      lines.push(...renderIntegrationGroup(source, glyph.fail, group))
    }
  }
  const representedOAuthClients = new Set(
    deploymentIntegrations.flatMap((integration) => {
      if (!integration.setupCommand) return []
      return [integration.setupCommand.replace('npx sim-setup add integration ', '')]
    })
  )
  const additionalOAuthClients = Object.values(report.capabilityStatus.oauthClients.clients).filter(
    (client) => !representedOAuthClients.has(client.id) && client.state !== 'absent'
  )
  for (const client of additionalOAuthClients) {
    const marker = client.state === 'ready' ? glyph.pass : glyph.fail
    const missing =
      client.missingFields.length > 0 ? ` — missing ${client.missingFields.join(', ')}` : ''
    lines.push(` ${marker} ${titleCase(client.id)} OAuth client: ${client.state}${missing}`)
    if (client.state !== 'ready') {
      const hint = setupHint(source, client.setupCommand)
      if (hint) lines.push(`   ${theme.muted(`configure: ${hint}`)}`)
    }
  }
  lines.push(
    `   ${theme.muted('API-key integrations are configured per workspace and are not listed.')}`
  )
  return lines.join('\n')
}

export async function runSetupStatus(): Promise<number> {
  const sources = await discoverConfigurationSources()
  console.log(`\n${theme.heading('◆ Sim setup status')}\n`)
  if (sources.length === 0) {
    console.log(` ${glyph.fail} No local-dev, Docker Compose, or Helm configuration detected.`)
    console.log(`   ${theme.muted('run: npx sim-setup')}`)
    return 1
  }

  const reports = sources.map(buildSetupStatusReport)
  console.log(reports.map(renderSetupStatusReport).join('\n\n'))
  return reports.some((report) => report.failed) ? 1 : 0
}
