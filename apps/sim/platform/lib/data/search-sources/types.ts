import type { ConnectorAccessMode } from '@/lib/api/contracts/knowledge/connectors'
import type { SearchIntegrationStatus } from '@/lib/api/contracts/knowledge/search-integrations'
import type { ResourceScope } from '@/lib/core/resource-scope'
import type { Credential } from '@/lib/oauth/types'
import type { SourceSelectionLabel, SourceSelectionLabels } from '@/lib/sim-search/source-identity'
import type { ConnectorConfigField, ConnectorMeta } from '@/connectors/types'
import type {
  ConfigFieldMap,
  ConfigFieldValue,
} from '@/hooks/kb/connectors/use-connector-config-fields'

/** The access a connector is configured with, as the connector forms edit it. */
export interface ConnectorAccessSelection {
  accessMode: ConnectorAccessMode
}

/** What a connector form hands the configuration fields it renders. */
export interface ConnectorConfigFieldsProps {
  scope?: ResourceScope
  accessMode?: ConnectorAccessMode
  /** Registry definition whose `configFields` drive the rendered rows. */
  connectorConfig: ConnectorMeta
  /** Current values keyed by field ID. */
  sourceConfig: ConfigFieldMap
  selectionLabels?: SourceSelectionLabels
  /** OAuth credential backing selector fields, when available. */
  credentialId: string | null
  credentialType?: Credential['type']
  /** Canonical-pair groups keyed by `canonicalParamId`. */
  canonicalGroups: Map<string, ConnectorConfigField[]>
  /** Active mode per canonical pair. */
  canonicalModes: Record<string, 'basic' | 'advanced'>
  /** Visibility predicate honoring `condition` / canonical mode. */
  isFieldVisible: (field: ConnectorConfigField) => boolean
  /** Field value change handler. */
  onFieldChange: (
    fieldId: string,
    value: ConfigFieldValue,
    selectedOptions?: SourceSelectionLabel[]
  ) => void
  /** Swaps a canonical pair between selector and manual input. */
  onToggleCanonicalMode: (canonicalId: string) => void
  /** Disables configuration fields during submission. */
  disabled: boolean
}

/** An integration's Search approval and policy, as the policy dialog edits it. */
export type SearchIntegrationApproval = Pick<
  SearchIntegrationStatus,
  'connectorType' | 'approved' | 'policy'
>
