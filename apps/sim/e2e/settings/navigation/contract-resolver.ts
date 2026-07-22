import type { Locator, Page } from '@playwright/test'
import type { ScenarioManifest } from '../../fixtures/e2e-world'
import type { AuthenticatedDriver, DynamicResourceBinding, SemanticReadiness } from './contracts'

const DYNAMIC_SEGMENTS = {
  organization: '{organizationId}',
  workspace: '{workspaceId}',
} as const

export function resolveContractPath(
  manifest: ScenarioManifest,
  pathTemplate: string,
  driver?: AuthenticatedDriver
): string {
  const binding = driver?.binding
  const requiresOrganization = pathTemplate.includes(DYNAMIC_SEGMENTS.organization)
  const requiresWorkspace = pathTemplate.includes(DYNAMIC_SEGMENTS.workspace)

  if (!requiresOrganization && !requiresWorkspace) {
    if (binding) {
      throw new Error(`Static contract path must not declare a dynamic binding: ${pathTemplate}`)
    }
    return pathTemplate
  }
  if (!binding) throw new Error(`Dynamic contract path is missing a binding: ${pathTemplate}`)

  const expectedKind = requiresOrganization ? 'organization' : 'workspace'
  if (binding.resourceKind !== expectedKind) {
    throw new Error(
      `Contract path expects ${expectedKind}, received ${binding.resourceKind}: ${pathTemplate}`
    )
  }

  const resourceId = resolveBoundResourceId(manifest, binding)
  return pathTemplate.replace(
    DYNAMIC_SEGMENTS[binding.resourceKind],
    encodeURIComponent(resourceId)
  )
}

export function resolveBoundResourceId(
  manifest: ScenarioManifest,
  binding: DynamicResourceBinding
): string {
  const world = manifest.worlds[binding.worldKey]
  if (!world) throw new Error(`Unknown contract world: ${binding.worldKey}`)
  const resources =
    binding.resourceKind === 'organization' ? world.organizationIds : world.workspaceIds
  const resourceId = resources[binding.resourceKey]
  if (!resourceId) {
    throw new Error(
      `Unknown ${binding.resourceKind} contract resource "${binding.resourceKey}" in world "${binding.worldKey}"`
    )
  }
  return resourceId
}

export function readinessLocator(page: Page, readiness: SemanticReadiness): Locator {
  switch (readiness.kind) {
    case 'button':
      return page.getByRole('button', { name: readiness.name, exact: true })
    case 'link':
      return page.getByRole('link', { name: readiness.name, exact: true })
    case 'textbox':
      return page.getByRole('textbox', { name: readiness.name, exact: true })
    case 'switch':
      return page.getByRole('switch', { name: readiness.name, exact: true })
    case 'tab':
      return page.getByRole('tab', { name: readiness.name, exact: true })
    case 'text':
      return page.getByText(readiness.value, { exact: true })
  }
}

export function requiredBaseUrl(): string {
  const value = process.env.E2E_BASE_URL
  if (!value) throw new Error('Missing navigation contract environment value: E2E_BASE_URL')
  return value
}

export function absoluteE2eUrl(pathname: string): string {
  return new URL(pathname, requiredBaseUrl()).toString()
}
