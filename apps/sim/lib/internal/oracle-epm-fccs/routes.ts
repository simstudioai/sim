import { defineOracleEpmRouteSpace } from '@/lib/internal/oracle-epm'

/** FCCS uses the shared Cloud EPM API context, not Fusion Financials or a Data Integration route. */
export const fccsRoutes = defineOracleEpmRouteSpace({
  context: ['HyperionPlanning', 'rest'],
  allowedVersions: ['v3'],
})

/** Documented repository-file versions; no migration or environment administration endpoints. */
export const fccsFileRoutes = defineOracleEpmRouteSpace({
  context: ['interop', 'rest'],
  allowedVersions: ['11.1.2.3.600', 'v2', 'v3'],
})
