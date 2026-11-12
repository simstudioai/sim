import type { ToolConfig } from '@/tools/types'

interface CredentialRegion {
  /** The origin the vendor's API answers on in this region. */
  origin: string
  /** The connect-modal dropdown label, naming the address users recognize the region by. */
  label: string
}

interface CredentialRegionsConfig<Id extends string> {
  /** Service name used in errors and the hidden tool param's description. */
  service: string
  /** What the vendor calls a region: `region`, `instance`, or `environment`. */
  noun: string
  regions: Record<Id, CredentialRegion>
  /** The region every credential and tool used before one could be chosen. */
  defaultRegion: NoInfer<Id>
  /** Path appended to a region's origin to form its API base, such as `/api/v2`. */
  basePath?: string
}

export interface CredentialRegions<Id extends string> {
  defaultRegion: Id
  options: ReadonlyArray<{ value: Id; label: string }>
  has(value: string): value is Id
  /**
   * The API base of a region. Absent means the default region, so tools run without a saved
   * credential keep their host; an unknown region is refused rather than sent to a host its token
   * was not issued for.
   */
  apiBase(region?: string): string
  /** The hidden tool param that carries the region; only a saved credential fills it. */
  param: ToolConfig['params'][string]
}

function listInWords(values: readonly string[]): string {
  if (values.length < 3) return values.join(' or ')
  return `${values.slice(0, -1).join(', ')}, or ${values[values.length - 1]}`
}

/**
 * Defines a vendor's fixed set of regional API hosts for a saved credential's region field: the
 * one place its ids, hosts, dropdown labels, default, and tool param come from, so none can drift
 * from another.
 */
export function defineCredentialRegions<Id extends string>(
  config: CredentialRegionsConfig<Id>
): CredentialRegions<Id> {
  const has = (value: string): value is Id => Object.hasOwn(config.regions, value)
  const ids = Object.keys(config.regions).filter(has)
  return {
    defaultRegion: config.defaultRegion,
    options: ids.map((id) => ({ value: id, label: config.regions[id].label })),
    has,
    apiBase(region) {
      const id = region ?? config.defaultRegion
      if (!has(id)) throw new Error(`Unknown ${config.service} ${config.noun}: ${id}`)
      return `${config.regions[id].origin}${config.basePath ?? ''}`
    },
    param: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: `${config.service} ${config.noun} of the selected credential: ${listInWords(ids)}`,
    },
  }
}
