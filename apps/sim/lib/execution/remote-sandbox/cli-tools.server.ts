import {
  canonicalizeSandboxCliTools,
  SANDBOX_CLI_TOOLS,
  type SandboxCliToolId,
} from '@/lib/execution/remote-sandbox/cli-tools'

type SandboxProvider = 'e2b' | 'daytona'
type SandboxProviderCompatibility = readonly [SandboxProvider, ...SandboxProvider[]]

interface SandboxCliToolRecipe<Id extends SandboxCliToolId = SandboxCliToolId> {
  id: Id
  label: string
  description: string
  executables: readonly string[]
  version: string
  revision: number
  artifactUrl: string
  sha256: string
  installCommand: string
  cleanupCommand: string
  verificationCommands: readonly string[]
  pathEntries: readonly string[]
  supportedProviders: SandboxProviderCompatibility
}

interface RecipePaths {
  root: string
  bin: string
  extract: string
  artifact: string
}

interface VerifiedRecipeDefinition {
  version: string
  artifactUrl: string
  artifactName: string
  sha256: string
  executables: readonly string[]
  verificationCommands: readonly string[]
  installCommands: (paths: RecipePaths) => readonly string[]
  pathEntries?: (paths: RecipePaths) => readonly string[]
  supportedProviders?: SandboxProviderCompatibility
  revision?: number
}

interface ExtractedRecipeDefinition
  extends Omit<VerifiedRecipeDefinition, 'installCommands' | 'pathEntries'> {
  binaries: Readonly<Record<string, string>>
}

/** Base PATH used by root-run Function shell commands. */
export const SANDBOX_SYSTEM_PATH =
  '/usr/local/sbin:/usr/local/bin:/usr/local/games:/usr/sbin:/usr/bin:/usr/games:/sbin:/bin:/root/.local/bin'

const SIM_CLI_ROOT = '/opt/sim-cli'
const DEFAULT_SUPPORTED_PROVIDERS = ['e2b', 'daytona'] as const

function defineVerifiedRecipe<const Id extends SandboxCliToolId>(
  id: Id,
  definition: VerifiedRecipeDefinition
): SandboxCliToolRecipe<Id> {
  const toolName = id.slice(0, id.indexOf('@'))
  const root = `${SIM_CLI_ROOT}/${toolName}`
  const paths: RecipePaths = {
    root,
    bin: `${root}/bin`,
    extract: `${root}/extract`,
    artifact: `/tmp/sim-cli-${toolName}-${definition.artifactName}`,
  }
  const installCommand = [
    `mkdir -p '${paths.bin}' '${paths.extract}'`,
    `curl -fsSL --retry 3 --retry-all-errors '${definition.artifactUrl}' -o '${paths.artifact}'`,
    `echo '${definition.sha256}  ${paths.artifact}' | sha256sum -c -`,
    ...definition.installCommands(paths),
    `rm -f '${paths.artifact}'`,
  ].join(' && ')

  return {
    ...SANDBOX_CLI_TOOLS[id],
    id,
    executables: definition.executables,
    version: definition.version,
    revision: definition.revision ?? 1,
    artifactUrl: definition.artifactUrl,
    sha256: definition.sha256,
    installCommand,
    cleanupCommand: `rm -rf '${paths.extract}' && rm -f '${paths.artifact}'`,
    verificationCommands: definition.verificationCommands,
    pathEntries: definition.pathEntries?.(paths) ?? [paths.bin],
    supportedProviders: definition.supportedProviders ?? DEFAULT_SUPPORTED_PROVIDERS,
  }
}

function installExtractedBinaries(
  paths: RecipePaths,
  binaries: Readonly<Record<string, string>>
): string[] {
  return Object.entries(binaries).map(
    ([executable, archivePath]) =>
      `install -m 0755 '${paths.extract}/${archivePath}' '${paths.bin}/${executable}'`
  )
}

function defineTarGzipRecipe<const Id extends SandboxCliToolId>(
  id: Id,
  definition: ExtractedRecipeDefinition
): SandboxCliToolRecipe<Id> {
  return defineVerifiedRecipe(id, {
    ...definition,
    installCommands: (paths) => [
      `tar -xzf '${paths.artifact}' -C '${paths.extract}'`,
      ...installExtractedBinaries(paths, definition.binaries),
    ],
  })
}

function defineZipRecipe<const Id extends SandboxCliToolId>(
  id: Id,
  definition: ExtractedRecipeDefinition
): SandboxCliToolRecipe<Id> {
  return defineVerifiedRecipe(id, {
    ...definition,
    installCommands: (paths) => [
      `unzip -q '${paths.artifact}' -d '${paths.extract}'`,
      ...installExtractedBinaries(paths, definition.binaries),
    ],
  })
}

function defineBinaryRecipe<const Id extends SandboxCliToolId>(
  id: Id,
  definition: Omit<VerifiedRecipeDefinition, 'installCommands' | 'pathEntries'> & {
    binaryName: string
  }
): SandboxCliToolRecipe<Id> {
  return defineVerifiedRecipe(id, {
    ...definition,
    installCommands: (paths) => [
      `install -m 0755 '${paths.artifact}' '${paths.bin}/${definition.binaryName}'`,
    ],
  })
}

const GOOGLE_CLOUD_CLI_VERSION = '577.0.0'
const GOOGLE_CLOUD_CLI_ARCHIVE = `google-cloud-cli-${GOOGLE_CLOUD_CLI_VERSION}-linux-x86_64.tar.gz`
const GOOGLE_CLOUD_CLI_SHA256 = '0b32d330446ce7b0f57f253e7efab4636c18fb1f87a3ac31c6c3f2a2a697525e'
const GOOGLE_CLOUD_CLI_URL = `https://storage.googleapis.com/cloud-sdk-release/${GOOGLE_CLOUD_CLI_ARCHIVE}`

type SandboxCliToolRecipeRegistry = {
  readonly [Id in SandboxCliToolId]: SandboxCliToolRecipe<Id>
}

const SANDBOX_CLI_TOOL_RECIPES = {
  'google-cloud-cli@577.0.0-r1': defineVerifiedRecipe('google-cloud-cli@577.0.0-r1', {
    version: GOOGLE_CLOUD_CLI_VERSION,
    artifactUrl: GOOGLE_CLOUD_CLI_URL,
    artifactName: GOOGLE_CLOUD_CLI_ARCHIVE,
    sha256: GOOGLE_CLOUD_CLI_SHA256,
    executables: ['gcloud', 'bq', 'gsutil'],
    verificationCommands: ['gcloud --version', 'bq version', 'gsutil version'],
    installCommands: (paths) => [`tar -xzf '${paths.artifact}' -C '${paths.root}'`],
    pathEntries: (paths) => [`${paths.root}/google-cloud-sdk/bin`],
  }),
  'aws-cli@2.36.15-r1': defineVerifiedRecipe('aws-cli@2.36.15-r1', {
    version: '2.36.15',
    artifactUrl: 'https://awscli.amazonaws.com/awscli-exe-linux-x86_64-2.36.15.zip',
    artifactName: 'awscli-exe-linux-x86_64-2.36.15.zip',
    sha256: '02a8eb2fe985be8ebcc284aaa5bae206ee8668872d6369e66a5c7d49d8671a08',
    executables: ['aws'],
    verificationCommands: ['aws --version'],
    installCommands: (paths) => [
      `unzip -q '${paths.artifact}' -d '${paths.extract}'`,
      `'${paths.extract}/aws/install' --install-dir '${paths.root}/aws-cli' --bin-dir '${paths.bin}' --update`,
    ],
  }),
  'azure-cli@2.89.0-r1': defineVerifiedRecipe('azure-cli@2.89.0-r1', {
    version: '2.89.0',
    artifactUrl:
      'https://packages.microsoft.com/repos/azure-cli/pool/main/a/azure-cli/azure-cli_2.89.0-1~bookworm_amd64.deb',
    artifactName: 'azure-cli_2.89.0-1~bookworm_amd64.deb',
    sha256: 'f7d54ed02a0fa7e5ceb08e5aee706299c071f9c6369eca34834b3b7ebc41f0de',
    executables: ['az'],
    verificationCommands: ['export AZURE_CORE_COLLECT_TELEMETRY=no', 'az version'],
    installCommands: (paths) => [
      `dpkg-deb -x '${paths.artifact}' '${paths.extract}'`,
      `cp -a '${paths.extract}/opt/az/.' '${paths.root}/'`,
      `mkdir -p '${paths.root}/usr/bin' '${paths.root}/opt'`,
      `install -m 0755 '${paths.extract}/usr/bin/az' '${paths.root}/usr/bin/az'`,
      `ln -s '${paths.root}' '${paths.root}/opt/az'`,
    ],
    pathEntries: (paths) => [`${paths.root}/usr/bin`],
  }),
  'doctl@1.166.0-r1': defineTarGzipRecipe('doctl@1.166.0-r1', {
    version: '1.166.0',
    artifactUrl:
      'https://github.com/digitalocean/doctl/releases/download/v1.166.0/doctl-1.166.0-linux-amd64.tar.gz',
    artifactName: 'doctl-1.166.0-linux-amd64.tar.gz',
    sha256: '1596424b64091a7939bde561daf2402ca8a141966429928e688d20d17091ec89',
    executables: ['doctl'],
    verificationCommands: [
      "export HTTPS_PROXY=http://127.0.0.1:9 https_proxy=http://127.0.0.1:9 NO_PROXY='' no_proxy=''",
      'doctl version',
    ],
    binaries: { doctl: 'doctl' },
  }),
  'github-cli@2.97.0-r1': defineTarGzipRecipe('github-cli@2.97.0-r1', {
    version: '2.97.0',
    artifactUrl:
      'https://github.com/cli/cli/releases/download/v2.97.0/gh_2.97.0_linux_amd64.tar.gz',
    artifactName: 'gh_2.97.0_linux_amd64.tar.gz',
    sha256: 'a2c9b8497e1f85b1ad0dfcb78b5a622e098801b8e461e459e88e1ee12f018112',
    executables: ['gh'],
    verificationCommands: ['export GH_NO_UPDATE_NOTIFIER=1 GH_TELEMETRY=0', 'gh --version'],
    binaries: { gh: 'gh_2.97.0_linux_amd64/bin/gh' },
  }),
  'gitlab-cli@1.111.0-r1': defineTarGzipRecipe('gitlab-cli@1.111.0-r1', {
    version: '1.111.0',
    artifactUrl:
      'https://gitlab.com/gitlab-org/cli/-/releases/v1.111.0/downloads/glab_1.111.0_linux_amd64.tar.gz',
    artifactName: 'glab_1.111.0_linux_amd64.tar.gz',
    sha256: 'd3aa186428ce6668455e2e35184c6f60b013840d759c7ea4cf02bac68d2a1827',
    executables: ['glab'],
    verificationCommands: [
      'export GLAB_CHECK_UPDATE=false GLAB_SEND_TELEMETRY=false',
      'glab version',
    ],
    binaries: { glab: 'bin/glab' },
  }),
  'kubectl@1.36.3-r1': defineBinaryRecipe('kubectl@1.36.3-r1', {
    version: '1.36.3',
    artifactUrl: 'https://dl.k8s.io/release/v1.36.3/bin/linux/amd64/kubectl',
    artifactName: 'kubectl-v1.36.3-linux-amd64',
    sha256: 'ebbd080e7c2e275093b55915722043257eb24004363e20acb3c4d71919f88336',
    executables: ['kubectl'],
    verificationCommands: ['kubectl version --client'],
    binaryName: 'kubectl',
  }),
  'helm@4.2.3-r1': defineTarGzipRecipe('helm@4.2.3-r1', {
    version: '4.2.3',
    artifactUrl: 'https://get.helm.sh/helm-v4.2.3-linux-amd64.tar.gz',
    artifactName: 'helm-v4.2.3-linux-amd64.tar.gz',
    sha256: 'e9b88b4ee95b18c706839c28d3a0220e5bc470e9cd9262410c90793c45ff8b7c',
    executables: ['helm'],
    verificationCommands: ['helm version'],
    binaries: { helm: 'linux-amd64/helm' },
  }),
  'kustomize@5.8.1-r1': defineTarGzipRecipe('kustomize@5.8.1-r1', {
    version: '5.8.1',
    artifactUrl:
      'https://github.com/kubernetes-sigs/kustomize/releases/download/kustomize%2Fv5.8.1/kustomize_v5.8.1_linux_amd64.tar.gz',
    artifactName: 'kustomize_v5.8.1_linux_amd64.tar.gz',
    sha256: '029a7f0f4e1932c52a0476cf02a0fd855c0bb85694b82c338fc648dcb53a819d',
    executables: ['kustomize'],
    verificationCommands: ['kustomize version'],
    binaries: { kustomize: 'kustomize' },
  }),
  'argocd@3.4.6-r1': defineBinaryRecipe('argocd@3.4.6-r1', {
    version: '3.4.6',
    artifactUrl: 'https://github.com/argoproj/argo-cd/releases/download/v3.4.6/argocd-linux-amd64',
    artifactName: 'argocd-v3.4.6-linux-amd64',
    sha256: 'af05f97444a140591a12c136f2be6ffafd95aed03b34a500957ff8aedb998181',
    executables: ['argocd'],
    verificationCommands: ['argocd version --client'],
    binaryName: 'argocd',
  }),
  'terraform@1.15.8-r1': defineZipRecipe('terraform@1.15.8-r1', {
    version: '1.15.8',
    artifactUrl: 'https://releases.hashicorp.com/terraform/1.15.8/terraform_1.15.8_linux_amd64.zip',
    artifactName: 'terraform_1.15.8_linux_amd64.zip',
    sha256: 'd25ce7b6902013ad905db3d2eab0be4cd905887fe88b81a6171b8d5503c31f3d',
    executables: ['terraform'],
    verificationCommands: ['export CHECKPOINT_DISABLE=1', 'terraform version'],
    binaries: { terraform: 'terraform' },
  }),
  'pulumi@3.255.0-r1': defineVerifiedRecipe('pulumi@3.255.0-r1', {
    version: '3.255.0',
    artifactUrl: 'https://get.pulumi.com/releases/sdk/pulumi-v3.255.0-linux-x64.tar.gz',
    artifactName: 'pulumi-v3.255.0-linux-x64.tar.gz',
    sha256: 'cf559568e2c32f7fae56ea3de8ae5fa48973ba8c5aa9dd2b3dc0c8898fe50dba',
    executables: ['pulumi'],
    verificationCommands: ['export PULUMI_SKIP_UPDATE_CHECK=true', 'pulumi version'],
    installCommands: (paths) => [`tar -xzf '${paths.artifact}' -C '${paths.root}'`],
    pathEntries: (paths) => [`${paths.root}/pulumi`],
  }),
  'supabase-cli@2.111.0-r1': defineTarGzipRecipe('supabase-cli@2.111.0-r1', {
    version: '2.111.0',
    artifactUrl:
      'https://github.com/supabase/cli/releases/download/v2.111.0/supabase_linux_amd64.tar.gz',
    artifactName: 'supabase-v2.111.0-linux-amd64.tar.gz',
    sha256: '31ee8a152e9c8c8eddae072c6bc7c9119748a96c8cdaf21a6d31c9ce7e62cc18',
    executables: ['supabase', 'supabase-go'],
    verificationCommands: ['supabase --version', 'supabase-go --version'],
    binaries: { supabase: 'supabase', 'supabase-go': 'supabase-go' },
  }),
  'firebase-cli@15.25.1-r1': defineBinaryRecipe('firebase-cli@15.25.1-r1', {
    version: '15.25.1',
    artifactUrl:
      'https://github.com/firebase/firebase-tools/releases/download/v15.25.1/firebase-tools-linux',
    artifactName: 'firebase-tools-v15.25.1-linux',
    sha256: '2448a6244524d5fdc870bef134f3df7621faeff79fa7b0d36fab8624105779bd',
    executables: ['firebase'],
    verificationCommands: ['firebase --version'],
    binaryName: 'firebase',
  }),
  'flyctl@0.4.78-r1': defineTarGzipRecipe('flyctl@0.4.78-r1', {
    version: '0.4.78',
    artifactUrl:
      'https://github.com/superfly/flyctl/releases/download/v0.4.78/flyctl_0.4.78_Linux_x86_64.tar.gz',
    artifactName: 'flyctl_0.4.78_Linux_x86_64.tar.gz',
    sha256: 'ab94c89d1520e277714f6c860e061fd3abf78ca20f82956f1bc792dc24df1a8d',
    executables: ['flyctl'],
    verificationCommands: ['flyctl version'],
    binaries: { flyctl: 'flyctl' },
  }),
  'railway-cli@5.30.4-r1': defineTarGzipRecipe('railway-cli@5.30.4-r1', {
    version: '5.30.4',
    artifactUrl:
      'https://github.com/railwayapp/cli/releases/download/v5.30.4/railway-v5.30.4-x86_64-unknown-linux-gnu.tar.gz',
    artifactName: 'railway-v5.30.4-x86_64-unknown-linux-gnu.tar.gz',
    sha256: '33addd7729e99291f329ac671b02e9fe14fec8b7d9cdc11be77569739dae5c0e',
    executables: ['railway'],
    verificationCommands: ['railway --version'],
    binaries: { railway: 'railway' },
  }),
  'stripe-cli@1.45.0-r1': defineTarGzipRecipe('stripe-cli@1.45.0-r1', {
    version: '1.45.0',
    artifactUrl:
      'https://github.com/stripe/stripe-cli/releases/download/v1.45.0/stripe_1.45.0_linux_x86_64.tar.gz',
    artifactName: 'stripe_1.45.0_linux_x86_64.tar.gz',
    sha256: 'c3145c65dc6a0e1951bdf918b44dfa19555d0f6b616a6b142862e66e1520def9',
    executables: ['stripe'],
    verificationCommands: ['stripe --version'],
    binaries: { stripe: 'stripe' },
  }),
  'duckdb@1.5.5-r1': defineZipRecipe('duckdb@1.5.5-r1', {
    version: '1.5.5',
    artifactUrl:
      'https://github.com/duckdb/duckdb/releases/download/v1.5.5/duckdb_cli-linux-amd64.zip',
    artifactName: 'duckdb_cli-v1.5.5-linux-amd64.zip',
    sha256: '08c0ca117111fcede14239d0093792352befdc174218c344d232c13279643d05',
    executables: ['duckdb'],
    verificationCommands: ['duckdb --version'],
    binaries: { duckdb: 'duckdb' },
  }),
  'rclone@1.75.0-r1': defineZipRecipe('rclone@1.75.0-r1', {
    version: '1.75.0',
    artifactUrl: 'https://downloads.rclone.org/v1.75.0/rclone-v1.75.0-linux-amd64.zip',
    artifactName: 'rclone-v1.75.0-linux-amd64.zip',
    sha256: 'aa2804e08f48250e71009c727124b6341cd0288465804a9a09d14663cabafbaa',
    executables: ['rclone'],
    verificationCommands: ['rclone version'],
    binaries: { rclone: 'rclone-v1.75.0-linux-amd64/rclone' },
  }),
  'restic@0.19.1-r1': defineVerifiedRecipe('restic@0.19.1-r1', {
    version: '0.19.1',
    artifactUrl:
      'https://github.com/restic/restic/releases/download/v0.19.1/restic_0.19.1_linux_amd64.bz2',
    artifactName: 'restic_0.19.1_linux_amd64.bz2',
    sha256: 'f415415624dcc452f2a02b8c33641791a8c6d6d3b65bbb3543fcf9a25151585c',
    executables: ['restic'],
    verificationCommands: ['restic version'],
    installCommands: (paths) => [
      `bzip2 -dc '${paths.artifact}' > '${paths.bin}/restic'`,
      `chmod 0755 '${paths.bin}/restic'`,
    ],
  }),
  'minio-mc@RELEASE.2025-08-13T08-35-41Z-r1': defineBinaryRecipe(
    'minio-mc@RELEASE.2025-08-13T08-35-41Z-r1',
    {
      version: 'RELEASE.2025-08-13T08-35-41Z',
      artifactUrl:
        'https://dl.min.io/client/mc/release/linux-amd64/archive/mc.RELEASE.2025-08-13T08-35-41Z',
      artifactName: 'mc.RELEASE.2025-08-13T08-35-41Z',
      sha256: '01f866e9c5f9b87c2b09116fa5d7c06695b106242d829a8bb32990c00312e891',
      executables: ['mc'],
      verificationCommands: ['mc --version'],
      binaryName: 'mc',
    }
  ),
  'mongosh@2.9.2-r1': defineVerifiedRecipe('mongosh@2.9.2-r1', {
    version: '2.9.2',
    artifactUrl: 'https://downloads.mongodb.com/compass/mongosh-2.9.2-linux-x64-openssl3.tgz',
    artifactName: 'mongosh-2.9.2-linux-x64-openssl3.tgz',
    sha256: '36e13df6feac978c819c5902fe8ba279b34fef42acbc65e09d01aff9ee62e40c',
    executables: ['mongosh'],
    verificationCommands: ['mongosh --build-info'],
    installCommands: (paths) => [
      `tar -xzf '${paths.artifact}' -C '${paths.extract}'`,
      `cp -a '${paths.extract}/mongosh-2.9.2-linux-x64-openssl3/bin/.' '${paths.bin}/'`,
      `chmod 0755 '${paths.bin}/mongosh'`,
    ],
  }),
  'sops@3.13.3-r1': defineBinaryRecipe('sops@3.13.3-r1', {
    version: '3.13.3',
    artifactUrl:
      'https://github.com/getsops/sops/releases/download/v3.13.3/sops-v3.13.3.linux.amd64',
    artifactName: 'sops-v3.13.3.linux.amd64',
    sha256: 'e5bec3346a873ae91d871550f3e698c1aad962aff462a080e40f25fde17fef6b',
    executables: ['sops'],
    verificationCommands: ['sops --disable-version-check --version'],
    binaryName: 'sops',
  }),
  'age@1.3.1-r1': defineTarGzipRecipe('age@1.3.1-r1', {
    version: '1.3.1',
    artifactUrl:
      'https://github.com/FiloSottile/age/releases/download/v1.3.1/age-v1.3.1-linux-amd64.tar.gz',
    artifactName: 'age-v1.3.1-linux-amd64.tar.gz',
    sha256: 'bdc69c09cbdd6cf8b1f333d372a1f58247b3a33146406333e30c0f26e8f51377',
    executables: ['age', 'age-keygen'],
    verificationCommands: ['age --version', 'age-keygen --version'],
    binaries: {
      age: 'age/age',
      'age-keygen': 'age/age-keygen',
    },
  }),
} as const satisfies SandboxCliToolRecipeRegistry

export function sandboxCliToolRecipes(
  cliTools: readonly string[] | null | undefined
): readonly SandboxCliToolRecipe[] {
  return canonicalizeSandboxCliTools(cliTools).map((id) => SANDBOX_CLI_TOOL_RECIPES[id])
}

export function assertSandboxCliToolsSupported(
  cliTools: readonly string[] | null | undefined,
  provider: SandboxProvider
): void {
  for (const recipe of sandboxCliToolRecipes(cliTools)) {
    if (!recipe.supportedProviders.includes(provider)) {
      throw new Error(`${recipe.label} is not supported by the ${provider} sandbox provider`)
    }
  }
}

/** Environment shared by code and shell runs so installed CLIs are discoverable. */
export function sandboxCliEnvironment(
  cliTools: readonly string[] | null | undefined
): Record<string, string> {
  const pathEntries = sandboxCliToolRecipes(cliTools).flatMap((recipe) => recipe.pathEntries)
  return { PATH: [...new Set(pathEntries), SANDBOX_SYSTEM_PATH].join(':') }
}

/**
 * Runs a recipe verifier with its complete PATH in the same shell instruction.
 * Image builders may reset PATH while switching build users, so an earlier ENV
 * layer alone is not sufficient evidence that the installed executable resolves.
 */
export function sandboxCliVerificationCommand(
  recipe: SandboxCliToolRecipe,
  cliTools: readonly string[] | null | undefined
): string {
  const path = sandboxCliEnvironment(cliTools).PATH
  return `export PATH='${path}' && ${recipe.verificationCommands.join(' && ')}`
}
