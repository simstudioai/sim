/**
 * Stable identifiers for the curated CLI tools a workspace sandbox may install.
 * The persisted value is an id, never an arbitrary install command.
 *
 * Add a CLI by appending its versioned id here, its client-safe metadata below,
 * and its verified server recipe in `cli-tools.server.ts`.
 */
export const SANDBOX_CLI_TOOL_IDS = [
  'google-cloud-cli@577.0.0-r1',
  'aws-cli@2.36.15-r1',
  'azure-cli@2.89.0-r1',
  'doctl@1.166.0-r1',
  'github-cli@2.97.0-r1',
  'gitlab-cli@1.111.0-r1',
  'kubectl@1.36.3-r1',
  'helm@4.2.3-r1',
  'kustomize@5.8.1-r1',
  'argocd@3.4.6-r1',
  'terraform@1.15.8-r1',
  'pulumi@3.255.0-r1',
  'supabase-cli@2.111.0-r1',
  'firebase-cli@15.25.1-r1',
  'flyctl@0.4.78-r1',
  'railway-cli@5.30.4-r1',
  'stripe-cli@1.45.0-r1',
  'duckdb@1.5.5-r1',
  'rclone@1.75.0-r1',
  'restic@0.19.1-r1',
  'minio-mc@RELEASE.2025-08-13T08-35-41Z-r1',
  'mongosh@2.9.2-r1',
  'sops@3.13.3-r1',
  'age@1.3.1-r1',
] as const

export type SandboxCliToolId = (typeof SANDBOX_CLI_TOOL_IDS)[number]

/** Upper bound enforced at both the HTTP boundary and the domain boundary. */
export const MAX_SANDBOX_CLI_TOOLS = 10

export const SANDBOX_CLI_TOOL_CATEGORIES = [
  'Cloud',
  'Kubernetes',
  'Infrastructure',
  'Deployment',
  'Data & storage',
  'Security',
] as const

type SandboxCliToolCategory = (typeof SANDBOX_CLI_TOOL_CATEGORIES)[number]

interface SandboxCliToolMetadata {
  id: SandboxCliToolId
  label: string
  description: string
  category: SandboxCliToolCategory
  /** Client-safe executable names and aliases used only for catalog search. */
  searchTerms?: readonly string[]
}

type SandboxCliToolMetadataRegistry = {
  readonly [Id in SandboxCliToolId]: Omit<SandboxCliToolMetadata, 'id'> & { readonly id: Id }
}

/** Client-safe catalog. Provisioning recipes live in `cli-tools.server.ts`. */
export const SANDBOX_CLI_TOOLS = {
  'google-cloud-cli@577.0.0-r1': {
    id: 'google-cloud-cli@577.0.0-r1',
    label: 'Google Cloud CLI',
    description: 'Adds gcloud, bq, and gsutil.',
    category: 'Cloud',
    searchTerms: ['gcloud', 'bq', 'gsutil', 'google cloud', 'gcp'],
  },
  'aws-cli@2.36.15-r1': {
    id: 'aws-cli@2.36.15-r1',
    label: 'AWS CLI',
    description: 'Manage Amazon Web Services resources with aws.',
    category: 'Cloud',
    searchTerms: ['aws', 'amazon web services'],
  },
  'azure-cli@2.89.0-r1': {
    id: 'azure-cli@2.89.0-r1',
    label: 'Azure CLI',
    description: 'Manage Microsoft Azure resources with az.',
    category: 'Cloud',
    searchTerms: ['az', 'microsoft azure'],
  },
  'doctl@1.166.0-r1': {
    id: 'doctl@1.166.0-r1',
    label: 'DigitalOcean CLI',
    description: 'Manage DigitalOcean resources with doctl.',
    category: 'Cloud',
    searchTerms: ['doctl', 'digitalocean'],
  },
  'github-cli@2.97.0-r1': {
    id: 'github-cli@2.97.0-r1',
    label: 'GitHub CLI',
    description: 'Manage GitHub repositories, pull requests, and workflows.',
    category: 'Deployment',
    searchTerms: ['gh', 'github'],
  },
  'gitlab-cli@1.111.0-r1': {
    id: 'gitlab-cli@1.111.0-r1',
    label: 'GitLab CLI',
    description: 'Manage GitLab projects, merge requests, and pipelines.',
    category: 'Deployment',
    searchTerms: ['glab', 'gitlab'],
  },
  'kubectl@1.36.3-r1': {
    id: 'kubectl@1.36.3-r1',
    label: 'kubectl',
    description: 'Control Kubernetes clusters.',
    category: 'Kubernetes',
    searchTerms: ['kubectl', 'kubernetes', 'k8s'],
  },
  'helm@4.2.3-r1': {
    id: 'helm@4.2.3-r1',
    label: 'Helm',
    description: 'Install and manage Kubernetes charts.',
    category: 'Kubernetes',
    searchTerms: ['helm', 'kubernetes charts'],
  },
  'kustomize@5.8.1-r1': {
    id: 'kustomize@5.8.1-r1',
    label: 'Kustomize',
    description: 'Build and customize Kubernetes manifests.',
    category: 'Kubernetes',
    searchTerms: ['kustomize', 'kubernetes manifests'],
  },
  'argocd@3.4.6-r1': {
    id: 'argocd@3.4.6-r1',
    label: 'Argo CD CLI',
    description: 'Manage Argo CD applications and deployments.',
    category: 'Kubernetes',
    searchTerms: ['argocd', 'argo cd'],
  },
  'terraform@1.15.8-r1': {
    id: 'terraform@1.15.8-r1',
    label: 'Terraform',
    description: 'Provision infrastructure with Terraform.',
    category: 'Infrastructure',
    searchTerms: ['terraform', 'tf'],
  },
  'pulumi@3.255.0-r1': {
    id: 'pulumi@3.255.0-r1',
    label: 'Pulumi',
    description: 'Provision infrastructure with Pulumi.',
    category: 'Infrastructure',
    searchTerms: ['pulumi'],
  },
  'supabase-cli@2.111.0-r1': {
    id: 'supabase-cli@2.111.0-r1',
    label: 'Supabase CLI',
    description: 'Manage Supabase projects and database workflows.',
    category: 'Deployment',
    searchTerms: ['supabase'],
  },
  'firebase-cli@15.25.1-r1': {
    id: 'firebase-cli@15.25.1-r1',
    label: 'Firebase CLI',
    description: 'Manage and deploy Firebase projects.',
    category: 'Deployment',
    searchTerms: ['firebase'],
  },
  'flyctl@0.4.78-r1': {
    id: 'flyctl@0.4.78-r1',
    label: 'Fly.io CLI',
    description: 'Deploy and manage applications on Fly.io.',
    category: 'Deployment',
    searchTerms: ['flyctl', 'fly', 'fly.io'],
  },
  'railway-cli@5.30.4-r1': {
    id: 'railway-cli@5.30.4-r1',
    label: 'Railway CLI',
    description: 'Deploy and manage applications on Railway.',
    category: 'Deployment',
    searchTerms: ['railway'],
  },
  'stripe-cli@1.45.0-r1': {
    id: 'stripe-cli@1.45.0-r1',
    label: 'Stripe CLI',
    description: 'Develop, test, and manage Stripe integrations.',
    category: 'Deployment',
    searchTerms: ['stripe'],
  },
  'duckdb@1.5.5-r1': {
    id: 'duckdb@1.5.5-r1',
    label: 'DuckDB CLI',
    description: 'Query local and remote data with DuckDB.',
    category: 'Data & storage',
    searchTerms: ['duckdb'],
  },
  'rclone@1.75.0-r1': {
    id: 'rclone@1.75.0-r1',
    label: 'rclone',
    description: 'Copy and synchronize data across cloud storage providers.',
    category: 'Data & storage',
    searchTerms: ['rclone'],
  },
  'restic@0.19.1-r1': {
    id: 'restic@0.19.1-r1',
    label: 'restic',
    description: 'Create encrypted backups across storage backends.',
    category: 'Data & storage',
    searchTerms: ['restic'],
  },
  'minio-mc@RELEASE.2025-08-13T08-35-41Z-r1': {
    id: 'minio-mc@RELEASE.2025-08-13T08-35-41Z-r1',
    label: 'MinIO Client',
    description: 'Manage S3-compatible object storage with mc.',
    category: 'Data & storage',
    searchTerms: ['mc', 'minio', 's3'],
  },
  'mongosh@2.9.2-r1': {
    id: 'mongosh@2.9.2-r1',
    label: 'MongoDB Shell',
    description: 'Query and administer MongoDB with mongosh.',
    category: 'Data & storage',
    searchTerms: ['mongosh', 'mongo', 'mongodb'],
  },
  'sops@3.13.3-r1': {
    id: 'sops@3.13.3-r1',
    label: 'SOPS',
    description: 'Encrypt and decrypt structured configuration files.',
    category: 'Security',
    searchTerms: ['sops'],
  },
  'age@1.3.1-r1': {
    id: 'age@1.3.1-r1',
    label: 'age',
    description: 'Encrypt files with age and manage keys with age-keygen.',
    category: 'Security',
    searchTerms: ['age', 'age-keygen'],
  },
} as const satisfies SandboxCliToolMetadataRegistry

/** Every catalog entry is available for new sandbox selections. */
export const SANDBOX_SELECTABLE_CLI_TOOL_IDS = SANDBOX_CLI_TOOL_IDS

const SANDBOX_CLI_TOOL_ID_SET: ReadonlySet<string> = new Set(SANDBOX_CLI_TOOL_IDS)

/** Returns a stable, duplicate-free list and rejects unknown ids. */
export function canonicalizeSandboxCliTools(
  cliTools: readonly string[] | null | undefined
): SandboxCliToolId[] {
  for (const cliTool of cliTools ?? []) {
    if (!SANDBOX_CLI_TOOL_ID_SET.has(cliTool)) {
      throw new Error(`Unsupported sandbox CLI tool: ${cliTool}`)
    }
  }
  const canonical = [...new Set((cliTools ?? []) as readonly SandboxCliToolId[])].sort()
  if (canonical.length > MAX_SANDBOX_CLI_TOOLS) {
    throw new Error(`A sandbox can install at most ${MAX_SANDBOX_CLI_TOOLS} CLI tools`)
  }
  return canonical
}
