import { z } from 'zod'

const MAX_CONFIG_BYTES = 1_048_576
const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/)
const routeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('direct') }),
  z.strictObject({ kind: z.literal('gateway'), gatewayId: identifier }),
  z.strictObject({ kind: z.literal('blocked') }),
])
const configSchema = z.strictObject({
  schemaVersion: z.literal(1),
  revision: identifier,
  defaultRoute: routeSchema,
  organizations: z
    .record(identifier, routeSchema)
    .refine((value) => Object.keys(value).length <= 10_000),
})

export type OutboundRoute = Readonly<z.infer<typeof routeSchema>>
export interface OutboundRoutingConfig {
  readonly schemaVersion: 1
  readonly revision: string
  readonly defaultRoute: OutboundRoute
  readonly organizations: Readonly<Record<string, OutboundRoute>>
}

export type OutboundRoutingErrorCode =
  | 'CONFIGURATION_UNAVAILABLE'
  | 'INVALID_CONFIGURATION'
  | 'MISSING_SCOPE'
  | 'ROUTE_BLOCKED'
  | 'UNSUPPORTED_TRANSPORT'
  | 'GATEWAY_UNAVAILABLE'

/** Public error text never includes routing configuration, credentials or destination details. */
export class OutboundRoutingError extends Error {
  constructor(readonly code: OutboundRoutingErrorCode) {
    super(`Outbound routing failed: ${code}`)
    this.name = 'OutboundRoutingError'
  }
}

/** Bounds operator configuration before parsing and hides secret-bearing parser errors. */
export function parseOutboundJson(value: string): unknown {
  if (Buffer.byteLength(value, 'utf8') > MAX_CONFIG_BYTES) {
    throw new OutboundRoutingError('INVALID_CONFIGURATION')
  }
  try {
    return JSON.parse(value)
  } catch {
    throw new OutboundRoutingError('INVALID_CONFIGURATION')
  }
}

/** Produces an immutable routing snapshot without reading deployment state. */
export function parseOutboundRoutingConfig(value: unknown): OutboundRoutingConfig {
  const parsed = configSchema.safeParse(value)
  if (!parsed.success) throw new OutboundRoutingError('INVALID_CONFIGURATION')
  for (const route of Object.values(parsed.data.organizations)) Object.freeze(route)
  Object.freeze(parsed.data.defaultRoute)
  Object.freeze(parsed.data.organizations)
  return Object.freeze(parsed.data)
}

/** A null organization is a verified personal scope; undefined is never an implicit default. */
export function selectOutboundRoute(
  config: OutboundRoutingConfig,
  organizationId: string | null
): OutboundRoute {
  if (organizationId !== null && !identifier.safeParse(organizationId).success) {
    throw new OutboundRoutingError('MISSING_SCOPE')
  }
  const route =
    organizationId !== null && Object.hasOwn(config.organizations, organizationId)
      ? config.organizations[organizationId]
      : config.defaultRoute
  if (route.kind === 'blocked') throw new OutboundRoutingError('ROUTE_BLOCKED')
  return route
}
