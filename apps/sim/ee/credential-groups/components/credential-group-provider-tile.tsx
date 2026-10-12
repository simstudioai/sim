import type { ComponentType } from 'react'
import { getIntegrationTypesForOAuthServiceId } from '@sim/deployment-config/integration-availability'
import { INTEGRATION_METADATA } from '@sim/deployment-config/integration-metadata'
import {
  getManagedMcpConnectorBgColor,
  type ManagedMcpConnectorId,
} from '@/lib/credential-groups/managed-mcp-connectors'
import type { CredentialGroupProvider } from '@/lib/credential-groups/providers'
import { blockTypeToIconMap } from '@/lib/integrations/icon-mapping'
import { BrandTile } from '@/app/workspace/[workspaceId]/components/resource-tile'

const INTEGRATION_BY_TYPE = new Map(INTEGRATION_METADATA.map((entry) => [entry.type, entry]))

interface CredentialGroupProviderTileProps {
  provider: CredentialGroupProvider | ManagedMcpConnectorId
  icon: ComponentType<{ className?: string }>
}

export function CredentialGroupProviderTile({ provider, icon }: CredentialGroupProviderTileProps) {
  const blockType = getIntegrationTypesForOAuthServiceId(provider)[0] ?? provider
  return (
    <BrandTile
      icon={blockTypeToIconMap[blockType] ?? icon}
      background={
        INTEGRATION_BY_TYPE.get(blockType)?.bgColor ?? getManagedMcpConnectorBgColor(provider)
      }
    />
  )
}
