/** Public workspace catalog content, projected at generation time without executable tools. */
export interface IntegrationCatalogEntry {
  id: string
  type: string
  slug: string
  name: string
  description: string
  category: string
  docsUrl: string
  authType: 'oauth' | 'api-key' | 'none'
  connections: readonly CredentialConnection[]
  example: string
  skills: readonly { name: string; description: string; content: string }[]
  templates: readonly {
    title: string
    prompt: string
    integrations: readonly { id: string; name: string }[]
  }[]
}

import type { CredentialConnection } from '@/platform/lib/integrations/credential-model'
