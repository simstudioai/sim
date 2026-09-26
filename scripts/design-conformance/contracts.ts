import { readFileSync } from 'node:fs'
import { hash } from '#design-conformance/model'

export interface ComponentContract {
  slots?: string[]
  protected?: string[]
  iconSlots?: string[]
  extends?: string
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
  rendering?: Record<
    string,
    {
      slots: Record<string, string[]>
      source: string
      forwarding?: Record<string, { target: string; slot: string }[]>
    }
  >
  transparentPrimitives?: Record<string, { target: string; slots: string[] }>
  version: string
  policy: string
  sources: string[]
  rules: Record<string, { properties: string[]; permission: string; source: string }>
  builtins: Record<string, string[]>
  components: Record<string, ComponentContract>
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
if (registry.version !== '1.9.1' || registry.policy !== 'design-conformance/1.9.1')
  throw new Error('Incompatible conformance contract registry')
export const contractsHash = hash(bytes)
export function componentContract(target: string): ComponentContract | undefined {
  if (!target.startsWith('@sim/emcn#')) return undefined
  const item = registry.components[target.split('#')[1]]
  return item?.extends ? { ...registry.components[item.extends], ...item } : item
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
  centralFile(file) || registry.sources.includes(file)
