import { readFileSync } from 'node:fs'
import type { GeneratedContracts } from '#design-conformance/generated-contracts'
import { hash } from '#design-conformance/model'

export interface ComponentContract {
  slots?: string[]
  protected?: string[]
  iconSlots?: string[]
  slotOwnership?: Record<string, { protected: string[]; allowed: string[] }>
}
export interface CentralRecipeModule {
  exports: Record<string, { property: string; source: string }>
}
export interface Registry {
  artwork?: {
    libraries: string[]
    brandingFiles: string[]
    brandAssets?: Record<string, { source: string; reason: string }>
    permission: string
  }
  ownership?: Record<string, { scope: 'landing'; source: string; reason: string }>
  centralRecipes?: Record<string, CentralRecipeModule>
  transparentPrimitives?: Record<string, { target: string; slots: string[] }>
  version: string
  policy: string
  sources: string[]
  rules: Record<string, { properties: string[]; permission: string; source: string }>
  builtins: Record<string, string[]>
  branding: Record<string, string[] | string>
  limits: {
    summaryBytes?: number
    resolutionDepth: number
    sourceBytes: number
    factsCacheBytes: number
    systemCacheEntries: number
  }
}
const bytes = readFileSync(new URL('./contracts.json', import.meta.url), 'utf8')
export const registry: Registry = JSON.parse(bytes)
if (registry.version !== '2.0.0' || registry.policy !== 'design-conformance/2.0.0')
  throw new Error('Incompatible conformance contract registry')
export const contractsHash = hash(bytes)
/** Callers inspecting a snapshot must supply that snapshot's generated metadata. */
export function componentContract(
  target: string,
  metadata?: GeneratedContracts
): ComponentContract | undefined {
  if (!target.startsWith('@sim/emcn#') || !metadata) return undefined
  const item = metadata.exports[target.slice(10)]
  if (!item) return undefined
  return {
    slots: Object.keys(item.slots),
    slotOwnership: item.slots,
    iconSlots: Object.keys(item.slots).filter((s) => /icon/i.test(s)),
  }
}
export const isRegistry = (file: string) =>
  file === 'scripts/design-conformance/contracts.json' ||
  /(?:^|\/)token-lint\/contracts\.json$/.test(file)
/** Fixed authoring inventory; application usage does not create authority. */
export function centralFile(file: string): boolean {
  return (
    !!registry.centralRecipes?.[file] ||
    (/^(?:apps\/sim\/app\/_styles\/.*\.css|apps\/sim\/(?:tailwind|postcss)\.config\.[cm]?[jt]s|apps\/sim\/lib\/postcss\/.*\.[cm]?[jt]s|packages\/emcn\/src\/(?:components|lib)\/.*\.(?:[cm]?[jt]sx?|css)|packages\/emcn\/src\/index\.ts)$/.test(
      file
    ) &&
      !/\.(?:test|spec|generated|d)\.|(?:^|\/)icons?\//.test(file))
  )
}
export const centralInventory = (file: string) =>
  centralFile(file) ||
  registry.sources.includes(file) ||
  (/^packages\/emcn\/src\/.*\.[cm]?[jt]sx?$/.test(file) &&
    !/\.(?:test|spec|generated|d)\./.test(file))
