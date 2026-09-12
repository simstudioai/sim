import { isIP } from 'node:net'
import { z } from 'zod'
import type { AppConfigSnapshot } from '@/lib/core/config/appconfig'
import { env } from '@/lib/core/config/env'
import { gatewayPublicMetadataSchema } from '@/lib/core/network/gateway-metadata'
import {
  type OutboundRoutingConfig,
  OutboundRoutingError,
  parseOutboundJson,
  parseOutboundRoutingConfig,
  selectOutboundRoute,
} from '@/lib/core/network/routing'

const MAX_STALE_MS = 300_000
const keySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/)
const gatewaySchema = z.strictObject({
  url: z.string().url().max(2048),
  servername: z
    .string()
    .min(1)
    .max(253)
    .regex(/^[a-zA-Z0-9.-]+$/)
    .optional(),
  credentialId: keySchema,
  generation: keySchema,
  ...gatewayPublicMetadataSchema.partial().shape,
})
const gatewaysSchema = z
  .record(keySchema, gatewaySchema)
  .refine((value) => Object.keys(value).length <= 100)
const credentialSchema = z.strictObject({
  token: z
    .string()
    .min(32)
    .max(4096)
    .regex(/^[a-zA-Z0-9_=-]+$/),
  ca: z.string().min(1).max(65_536).optional(),
})
const credentialsSchema = z
  .record(keySchema, credentialSchema)
  .refine((value) => Object.keys(value).length <= 100)

export interface OutboundGateway {
  readonly id: string
  readonly url: string
  readonly servername: string
  readonly generation: string
  readonly token: string
  readonly ca?: string
  readonly publicIps?: readonly string[]
}

export type ResolvedOutboundRoute =
  | { readonly kind: 'direct' }
  | {
      readonly kind: 'gateway'
      readonly gateway: OutboundGateway
      readonly revision: string
      readonly scopeKey: string | null
    }

interface OutboundConfigurationOptions {
  source?: string
  configuration?: string
  gateways?: string
  credentials?: string
}

interface OutboundConfigurationDependencies {
  readSnapshot(
    parse: (value: unknown) => OutboundRoutingConfig
  ): Promise<AppConfigSnapshot<OutboundRoutingConfig>>
  now(): number
}

/** A configured reader is immutable; failures cannot switch it to deployment defaults. */
export function createOutboundRoutingReader(
  options: OutboundConfigurationOptions,
  dependencies: OutboundConfigurationDependencies
): {
  enabled: boolean
  resolve(organizationId: string | null | undefined): Promise<ResolvedOutboundRoute>
} {
  if (options.source === undefined) {
    if (
      options.configuration !== undefined ||
      options.gateways !== undefined ||
      options.credentials !== undefined
    ) {
      throw new OutboundRoutingError('INVALID_CONFIGURATION')
    }
    return { enabled: false, resolve: async () => ({ kind: 'direct' }) }
  }
  if (options.source !== 'env' && options.source !== 'appconfig') {
    throw new OutboundRoutingError('INVALID_CONFIGURATION')
  }
  const parsedGateways = gatewaysSchema.safeParse(parseOutboundJson(options.gateways ?? '{}'))
  const parsedCredentials = credentialsSchema.safeParse(
    parseOutboundJson(options.credentials ?? '{}')
  )
  if (!parsedGateways.success || !parsedCredentials.success) {
    throw new OutboundRoutingError('INVALID_CONFIGURATION')
  }
  const gateways = new Map<string, OutboundGateway>()
  for (const [id, entry] of Object.entries(parsedGateways.data)) {
    const url = new URL(entry.url)
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new OutboundRoutingError('INVALID_CONFIGURATION')
    }
    const servername = entry.servername ?? hostname
    if (
      isIP(servername) ||
      !servername ||
      !Object.hasOwn(parsedCredentials.data, entry.credentialId)
    ) {
      throw new OutboundRoutingError('INVALID_CONFIGURATION')
    }
    const credential = parsedCredentials.data[entry.credentialId]
    gateways.set(
      id,
      Object.freeze({
        id,
        url: url.href,
        servername,
        generation: entry.generation,
        ...credential,
        ...(entry.publicIps ? { publicIps: Object.freeze([...new Set(entry.publicIps)]) } : {}),
      })
    )
  }
  const parse = (value: unknown): OutboundRoutingConfig => {
    const config = parseOutboundRoutingConfig(value)
    for (const route of [config.defaultRoute, ...Object.values(config.organizations)]) {
      if (route.kind === 'gateway' && !gateways.has(route.gatewayId)) {
        throw new OutboundRoutingError('INVALID_CONFIGURATION')
      }
    }
    return config
  }
  const staticConfig =
    options.source === 'env' ? parse(parseOutboundJson(options.configuration ?? '')) : null
  if (options.source === 'appconfig' && options.configuration !== undefined) {
    throw new OutboundRoutingError('INVALID_CONFIGURATION')
  }
  return {
    enabled: true,
    async resolve(organizationId) {
      if (organizationId === undefined) throw new OutboundRoutingError('MISSING_SCOPE')
      let config = staticConfig
      if (!config) {
        const snapshot = await dependencies.readSnapshot(parse)
        const age =
          snapshot.validatedAt === null
            ? Number.POSITIVE_INFINITY
            : dependencies.now() - snapshot.validatedAt
        if (!snapshot.value || age < 0 || age >= MAX_STALE_MS) {
          throw new OutboundRoutingError('CONFIGURATION_UNAVAILABLE')
        }
        config = snapshot.value
      }
      const route = selectOutboundRoute(config, organizationId)
      if (route.kind === 'direct') return { kind: 'direct' }
      if (route.kind === 'blocked') throw new OutboundRoutingError('ROUTE_BLOCKED')
      const gateway = gateways.get(route.gatewayId)
      if (!gateway) throw new OutboundRoutingError('INVALID_CONFIGURATION')
      return {
        kind: 'gateway',
        gateway,
        revision: config.revision,
        scopeKey: organizationId,
      }
    },
  }
}

let reader: ReturnType<typeof createOutboundRoutingReader> | undefined

function getReader() {
  reader ??= createOutboundRoutingReader(
    {
      source: env.OUTBOUND_ROUTING_SOURCE,
      configuration: env.OUTBOUND_ROUTING_CONFIG,
      gateways: env.OUTBOUND_GATEWAYS,
      credentials: env.OUTBOUND_GATEWAY_CREDENTIALS,
    },
    {
      now: Date.now,
      async readSnapshot(parse) {
        if (!env.APPCONFIG_APPLICATION || !env.APPCONFIG_ENVIRONMENT) {
          throw new OutboundRoutingError('CONFIGURATION_UNAVAILABLE')
        }
        const { fetchAppConfigSnapshot } = await import('@/lib/core/config/appconfig')
        return fetchAppConfigSnapshot(
          {
            application: env.APPCONFIG_APPLICATION,
            environment: env.APPCONFIG_ENVIRONMENT,
            profile: 'outbound-routing',
          },
          parse
        )
      },
    }
  )
  return reader
}

/** True only for deployments with explicitly configured managed routing. */
export function isOutboundRoutingEnabled(): boolean {
  return getReader().enabled
}

/** Credentials remain inside the transport layer; never serialize the result. */
export function resolveOutboundRoute(organizationId: string | null | undefined) {
  return getReader().resolve(organizationId)
}
