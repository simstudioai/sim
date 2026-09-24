import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  IntegrationCatalogRequest,
  IntegrationCatalogResponse,
} from '@/lib/mothership/generated/integration-catalog'

export const readIntegrationCatalogContract = defineRouteContract({
  method: 'POST',
  path: '/api/mothership/integrations/catalog',
  body: IntegrationCatalogRequest,
  response: { mode: 'json', schema: IntegrationCatalogResponse },
})
