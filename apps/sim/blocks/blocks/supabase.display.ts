import { SupabaseIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const SupabaseBlockDisplay = {
  type: 'supabase',
  name: 'Supabase',
  description: 'Use Supabase database',
  category: 'tools',
  bgColor: '#1C1C1C',
  icon: SupabaseIcon,
  longDescription:
    'Integrate Supabase into the workflow. Supports database operations (query, insert, update, delete, upsert), full-text search, RPC functions, Edge Function invocation, row counting, vector search, and complete storage management (upload, download, list, move, copy, delete files and buckets).',
  docsLink: 'https://docs.sim.ai/integrations/supabase',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay
