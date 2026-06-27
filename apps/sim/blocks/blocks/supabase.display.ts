import { SupabaseIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

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

export const SupabaseBlockMeta = {
  tags: ['cloud', 'data-warehouse', 'vector-search'],
  url: 'https://supabase.com',
  templates: [
    {
      icon: SupabaseIcon,
      title: 'Supabase user provisioning',
      prompt:
        'Build a workflow that listens for Stripe new-customer events, provisions a Supabase user with the correct role and metadata, and emails the welcome login link.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'automation'],
      alsoIntegrations: ['stripe', 'gmail'],
    },
    {
      icon: SupabaseIcon,
      title: 'Supabase nightly export to S3',
      prompt:
        'Create a scheduled workflow that runs each night, exports key Supabase tables to compressed JSON in S3 with date partitions, and writes the manifest to an audit table.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'sync'],
      alsoIntegrations: ['s3'],
    },
    {
      icon: SupabaseIcon,
      title: 'Supabase row-level audit log',
      prompt:
        'Build a scheduled workflow that polls Supabase sensitive tables for recently changed rows, captures the diff against the last snapshot into an audit log table, and pings Slack on unusual write patterns.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SupabaseIcon,
      title: 'Supabase high-priority row alerter',
      prompt:
        'Create a scheduled workflow that polls Supabase frequently for high-priority rows — new orders, fraud flags — and posts a Slack alert with context for each new row it finds.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'communication'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SupabaseIcon,
      title: 'Supabase storage cleanup',
      prompt:
        'Build a scheduled workflow that finds Supabase storage objects older than the retention policy or unreferenced in the database, deletes them, and writes a cleanup report.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'automation'],
    },
    {
      icon: SupabaseIcon,
      title: 'Supabase analytics digest',
      prompt:
        'Create a scheduled daily workflow that queries Supabase for new signups, active users, and key feature usage, and posts a digest to Slack with week-over-week trend.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['product', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SupabaseIcon,
      title: 'Supabase + Algolia search sync',
      prompt:
        'Build a scheduled workflow that mirrors Supabase tables into an Algolia index, propagates new and changed rows on each run, and writes sync lag to a tables-based monitor.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'sync'],
      alsoIntegrations: ['algolia'],
    },
  ],
  skills: [
    {
      name: 'query-table-rows',
      description:
        'Read rows from a Supabase table with PostgREST filters, ordering, and pagination.',
      content:
        '# Query Supabase Table Rows\n\nFetch records from a Supabase table using PostgREST filters so downstream steps work with exactly the rows they need.\n\n## Steps\n1. Use the Get Many Rows operation with the project ID, service role secret, and target table.\n2. Set Select Columns to the fields you need (for example id,name,email) instead of returning every column.\n3. Add a PostgREST Filter such as status=eq.active or created_at=gte.2024-01-01 to narrow the result set.\n4. Set Order By (for example created_at DESC) plus Limit and Offset for predictable pagination.\n5. For a single record use Get a Row with a filter like id=eq.123.\n\n## Output\nReturn the matched rows as structured JSON. Note how many rows came back and surface the key fields each consumer needs.',
    },
    {
      name: 'upsert-record',
      description:
        'Insert a new Supabase row or update it if it already exists in one idempotent call.',
      content:
        '# Upsert a Supabase Record\n\nWrite a record without first checking whether it exists, so repeated runs stay idempotent.\n\n## Steps\n1. Choose the Upsert a Row operation with the project ID, service role secret, and table.\n2. Provide the Data as a JSON object whose keys match the table columns, including the conflict key (such as id or email).\n3. Supabase inserts the row when the conflict key is new and updates the existing row otherwise.\n4. For a guaranteed new row use Create a Row instead; for a known existing row use Update a Row with a filter like id=eq.123.\n\n## Output\nConfirm whether the row was inserted or updated and report the resulting record fields back to the caller.',
    },
    {
      name: 'semantic-vector-search',
      description:
        'Run pgvector similarity search against a Supabase table to retrieve the closest embeddings.',
      content:
        '# Semantic Vector Search in Supabase\n\nFind the most relevant rows by embedding similarity, the retrieval step for a RAG agent.\n\n## Steps\n1. Generate an embedding for the query text with your model and capture it as a numeric array.\n2. Use the Vector Search operation, pointing Function Name at your pgvector match function (for example match_documents).\n3. Pass the embedding into Query Embedding as a JSON array like [0.1, 0.2, 0.3].\n4. Tune Match Threshold (for example 0.78) and Match Count (for example 10) to balance precision and recall.\n\n## Output\nReturn the matched rows with their similarity scores, ordered by closeness, ready to feed an answer-generation step.',
    },
    {
      name: 'upload-file-to-storage',
      description: 'Upload a file to a Supabase Storage bucket and return a public or signed URL.',
      content:
        '# Upload a File to Supabase Storage\n\nStore a generated or received file in a bucket and hand back a shareable link.\n\n## Steps\n1. Use Storage: Upload File with the bucket name, file name, and the file reference from a previous block.\n2. Set an optional Folder Path and Content Type, and enable Upsert if you want to overwrite an existing object.\n3. For a permanent link on a public bucket use Storage: Get Public URL with the file path.\n4. For private buckets use Storage: Create Signed URL with an Expires In value such as 3600 seconds.\n\n## Output\nReturn the stored object path plus the public or signed URL so later steps can reference or share the file.',
    },
    {
      name: 'invoke-edge-function',
      description: 'Call a deployed Supabase Edge Function over HTTP and use its JSON response.',
      content:
        '# Invoke a Supabase Edge Function\n\nRun server-side logic deployed as a Supabase Edge Function and feed its result into the workflow.\n\n## Steps\n1. Use the Invoke Edge Function operation with the project ID, service role secret, and the function name (for example hello-world).\n2. Choose the HTTP Method (defaults to POST) and provide a JSON Request Body the function expects.\n3. Add optional custom Headers as a JSON object when the function reads specific headers.\n4. This is different from Call RPC Function, which runs a PostgreSQL function inside the database rather than deployed function code.\n\n## Output\nReturn the function response body as JSON so downstream steps can branch on or transform the result.',
    },
  ],
} as const satisfies BlockMeta
