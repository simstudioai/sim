import { vi } from 'vitest'

interface MockConnectorConfigField {
  id: string
  type?: string
  required?: boolean
}

interface MockConnectorMeta {
  id?: string
  search?: boolean
  auth?: { mode?: string }
  permissionScopedListing?: { capFieldIds?: readonly string[] }
  configFields?: readonly MockConnectorConfigField[]
  searchDefaultSourceConfig?: Record<string, string>
}

function canConnectPersonally(meta: MockConnectorMeta): boolean {
  return (
    meta.search === true &&
    meta.auth?.mode === 'oauth' &&
    meta.permissionScopedListing !== undefined
  )
}

function personalSetupFields(meta: MockConnectorMeta): MockConnectorConfigField[] {
  const capFieldIds = new Set(meta.permissionScopedListing?.capFieldIds ?? [])
  return (meta.configFields ?? []).filter(
    (field) => field.required && field.type !== 'selector' && !capFieldIds.has(field.id)
  )
}

/**
 * Controllable mock functions for `@/lib/sim-search/connectors`.
 *
 * Defaults (faithful ports of the real pure logic, reading only the `meta` passed in):
 * - `mockCanConnectPersonally`: `search === true`, OAuth auth, and a `permissionScopedListing`.
 * - `mockPersonalSetupFields`: required, non-selector config fields that are not listing caps.
 * - `mockCanConnectWithDefaults`: connects personally, is not `slack`, and has no setup fields.
 * - `mockPersonalSourceConfigFieldIds`: setup-field ids plus `searchDefaultSourceConfig` keys.
 * - `mockWithSearchSourceDefaults`: defaults overlaid by supplied values; a blank value keeps its default.
 * - `mockMissingSetupFields`: setup fields whose `sourceConfig` value is missing or blank.
 *
 * Registry-backed defaults mirror the mock's EMPTY connector registry:
 * - `mockConnectorDisplayName` returns the connector type unchanged.
 * - `mockSearchMemberAccountProvider` returns `null`.
 *
 * `mockGetConnectorAccessAvailability` and `mockIsSearchConnectorAvailable` are bare.
 *
 * @example
 * ```ts
 * import { simSearchConnectorsMockFns } from '@sim/testing/mocks/sim-search-connectors.mock'
 *
 * simSearchConnectorsMockFns.mockGetConnectorAccessAvailability.mockReturnValue({
 *   admin: false,
 *   members: true,
 * })
 * ```
 */
export const simSearchConnectorsMockFns = {
  mockSearchMemberAccountProvider: vi.fn((_connectorType: string): unknown => null),
  mockCanConnectPersonally: vi.fn(canConnectPersonally),
  mockPersonalSetupFields: vi.fn(personalSetupFields),
  mockCanConnectWithDefaults: vi.fn(
    (meta: MockConnectorMeta): boolean =>
      canConnectPersonally(meta) && meta.id !== 'slack' && personalSetupFields(meta).length === 0
  ),
  mockPersonalSourceConfigFieldIds: vi.fn(
    (meta: MockConnectorMeta): Set<string> =>
      new Set([
        ...personalSetupFields(meta).map((field) => field.id),
        ...Object.keys(meta.searchDefaultSourceConfig ?? {}),
      ])
  ),
  mockWithSearchSourceDefaults: vi.fn(
    (
      meta: Pick<MockConnectorMeta, 'searchDefaultSourceConfig'>,
      sourceConfig: Record<string, string> = {}
    ): Record<string, string> => {
      const merged: Record<string, string> = { ...(meta.searchDefaultSourceConfig ?? {}) }
      for (const [field, value] of Object.entries(sourceConfig)) {
        if (typeof value === 'string' && value.trim() === '' && field in merged) continue
        merged[field] = value
      }
      return merged
    }
  ),
  mockMissingSetupFields: vi.fn(
    (meta: MockConnectorMeta, sourceConfig: Record<string, string>): MockConnectorConfigField[] =>
      personalSetupFields(meta).filter((field) => !sourceConfig[field.id]?.trim())
  ),
  mockConnectorDisplayName: vi.fn((connectorType: string): string => connectorType),
  mockGetConnectorAccessAvailability: vi.fn(),
  mockIsSearchConnectorAvailable: vi.fn(),
}

/**
 * Static mock module for `@/lib/sim-search/connectors`. `SIM_SEARCH_KNOWLEDGE_BASE_NAME` carries the
 * real value; `SEARCH_CONNECTORS` and `SEARCH_SOURCE_TYPES` are empty (the real ones derive from the
 * connector registry). A file that needs connectors spreads the mock and supplies its own list.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/sim-search/connectors', () => simSearchConnectorsMock)
 * vi.mock('@/lib/sim-search/connectors', () => ({
 *   ...simSearchConnectorsMock,
 *   SEARCH_CONNECTORS: [{ type: 'slack', providerId: 'slack' }],
 * }))
 * ```
 */
export const simSearchConnectorsMock = {
  SIM_SEARCH_KNOWLEDGE_BASE_NAME: 'Sim Search',
  SEARCH_CONNECTORS: [] as readonly unknown[],
  SEARCH_SOURCE_TYPES: [] as readonly (readonly [string, unknown])[],
  searchMemberAccountProvider: simSearchConnectorsMockFns.mockSearchMemberAccountProvider,
  canConnectPersonally: simSearchConnectorsMockFns.mockCanConnectPersonally,
  personalSetupFields: simSearchConnectorsMockFns.mockPersonalSetupFields,
  canConnectWithDefaults: simSearchConnectorsMockFns.mockCanConnectWithDefaults,
  personalSourceConfigFieldIds: simSearchConnectorsMockFns.mockPersonalSourceConfigFieldIds,
  withSearchSourceDefaults: simSearchConnectorsMockFns.mockWithSearchSourceDefaults,
  missingSetupFields: simSearchConnectorsMockFns.mockMissingSetupFields,
  connectorDisplayName: simSearchConnectorsMockFns.mockConnectorDisplayName,
  getConnectorAccessAvailability: simSearchConnectorsMockFns.mockGetConnectorAccessAvailability,
  isSearchConnectorAvailable: simSearchConnectorsMockFns.mockIsSearchConnectorAvailable,
}
