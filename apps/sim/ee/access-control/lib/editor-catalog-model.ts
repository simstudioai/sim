/**
 * What the permission group editor needs from the block and provider registries, read on the server
 * so the editor's client bundle does not carry them.
 */
export interface PermissionGroupEditorCatalog {
  /** The allowlist universe. `hidden` decides drawing only; a hidden row stays part of every save. */
  blocks: {
    type: string
    name: string
    description: string
    category: string
    hidden: boolean
    sourceWorkspaceName: string | null
    tools: { id: string; label: string }[]
  }[]
  /** Every provider a group can govern, before the deployment's blacklist. */
  providerIds: string[]
  dynamicProviderIds: string[]
  /** Every provider definition, since a model's owner may be one the group cannot govern. */
  providers: {
    id: string
    name: string
    namespaced: boolean
    modelPatterns: { source: string; flags: string }[]
    models: { id: string; inStaticCatalog: boolean; sunset: 'legacy' | 'deprecated' | null }[]
  }[]
  knowledgeConnectors: { value: string; label: string }[]
}
