import type { InterfaceModuleSeed, ResourceSource } from '@/resources'

/**
 * The server-resolved payload behind one module of a **shared** interface, or
 * `null` in workspace scope (where a module resolves its own resource by id).
 */
export function interfaceModuleSeed(
  source: ResourceSource<'interface'>,
  moduleId: string
): InterfaceModuleSeed | null {
  if (source.via !== 'share') return null
  return source.seed.modules[moduleId] ?? null
}
