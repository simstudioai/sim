/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  canonicalizeSandboxCliTools,
  MAX_SANDBOX_CLI_TOOLS,
  SANDBOX_CLI_TOOL_CATEGORIES,
  SANDBOX_CLI_TOOL_IDS,
  SANDBOX_CLI_TOOLS,
  SANDBOX_SELECTABLE_CLI_TOOL_IDS,
} from '@/lib/execution/remote-sandbox/cli-tools'
import {
  assertSandboxCliToolsSupported,
  SANDBOX_SYSTEM_PATH,
  sandboxCliEnvironment,
  sandboxCliToolRecipes,
  sandboxCliVerificationCommand,
} from '@/lib/execution/remote-sandbox/cli-tools.server'

describe('sandbox CLI catalog', () => {
  const catalogRecipes = () => SANDBOX_CLI_TOOL_IDS.flatMap((id) => sandboxCliToolRecipes([id]))

  it('pins the corrected Google Cloud CLI artifact', () => {
    const [recipe] = sandboxCliToolRecipes(['google-cloud-cli@577.0.0-r1'])

    expect(recipe.version).toBe('577.0.0')
    expect(recipe.revision).toBe(1)
    expect(recipe.sha256).toBe('0b32d330446ce7b0f57f253e7efab4636c18fb1f87a3ac31c6c3f2a2a697525e')
    expect(recipe.installCommand).toContain(recipe.sha256)
    expect(recipe.verificationCommands).toEqual([
      'gcloud --version',
      'bq version',
      'gsutil version',
    ])
    expect(SANDBOX_SELECTABLE_CLI_TOOL_IDS).toContain(recipe.id)
  })

  it('contains one first-release recipe per usable managed CLI', () => {
    expect(SANDBOX_CLI_TOOL_IDS).toHaveLength(24)
    expect(SANDBOX_CLI_TOOL_IDS.every((id) => id.endsWith('-r1'))).toBe(true)
    expect(SANDBOX_CLI_TOOL_IDS.some((id) => id.startsWith('k9s@'))).toBe(false)
  })

  it('has one immutable integrity-checked recipe for every client-safe catalog entry', () => {
    const recipes = catalogRecipes()

    expect(recipes).toHaveLength(SANDBOX_CLI_TOOL_IDS.length)
    expect(recipes.length).toBeGreaterThanOrEqual(20)
    expect(Object.keys(SANDBOX_CLI_TOOLS)).toHaveLength(SANDBOX_CLI_TOOL_IDS.length)
    expect(recipes.map((recipe) => recipe.id)).toEqual(SANDBOX_CLI_TOOL_IDS)
    for (const [index, recipe] of recipes.entries()) {
      const catalogId = SANDBOX_CLI_TOOL_IDS[index]
      expect(recipe.id).toBe(catalogId)
      expect(SANDBOX_CLI_TOOLS[catalogId].id).toBe(catalogId)
      const toolName = recipe.id.slice(0, recipe.id.indexOf('@'))
      expect(recipe.id).toBe(`${toolName}@${recipe.version}-r${recipe.revision}`)
      expect(recipe.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(recipe.installCommand).toContain(recipe.sha256)
      expect(recipe.installCommand).toContain(recipe.artifactUrl)
      expect(recipe.installCommand).toContain('/opt/sim-cli')
      expect(recipe.cleanupCommand).not.toMatch(/[$*?`]/)
      for (const cleanupInstruction of recipe.cleanupCommand.split(' && ')) {
        expect(cleanupInstruction).toMatch(
          /^rm -(?:rf|f) '(?:\/opt\/sim-cli\/[a-z0-9-]+\/extract|\/tmp\/[A-Za-z0-9._+~-]+)'$/
        )
      }
      expect(recipe.artifactUrl).toMatch(/^https:\/\//)
      expect(recipe.artifactUrl.toLowerCase()).not.toContain('latest')
      expect(recipe.artifactUrl).toContain(recipe.version)
      expect(recipe.revision).toBeGreaterThan(0)
      expect(recipe.pathEntries.length).toBeGreaterThan(0)
      expect(recipe.pathEntries.every((entry) => entry.startsWith('/opt/sim-cli'))).toBe(true)
      expect(recipe.verificationCommands.length).toBeGreaterThan(0)
      for (const executable of recipe.executables) {
        expect(
          recipe.verificationCommands.some(
            (command) => command === executable || command.startsWith(`${executable} `)
          )
        ).toBe(true)
      }
    }
  })

  it('keeps every displayed catalog category populated', () => {
    const populatedCategories = new Set(
      SANDBOX_SELECTABLE_CLI_TOOL_IDS.map((id) => SANDBOX_CLI_TOOLS[id].category)
    )

    expect(populatedCategories).toEqual(new Set(SANDBOX_CLI_TOOL_CATEGORIES))
  })

  it('offers every catalog entry exactly once', () => {
    expect(SANDBOX_SELECTABLE_CLI_TOOL_IDS.length).toBeGreaterThan(0)
    expect(SANDBOX_SELECTABLE_CLI_TOOL_IDS).toEqual(SANDBOX_CLI_TOOL_IDS)
    expect(new Set(SANDBOX_SELECTABLE_CLI_TOOL_IDS).size).toBe(
      SANDBOX_SELECTABLE_CLI_TOOL_IDS.length
    )
    const selectableLabels = SANDBOX_SELECTABLE_CLI_TOOL_IDS.map(
      (id) => SANDBOX_CLI_TOOLS[id].label
    )
    expect(new Set(selectableLabels).size).toBe(selectableLabels.length)
    const selectableFamilies = SANDBOX_SELECTABLE_CLI_TOOL_IDS.map((id) => id.split('@')[0])
    expect(new Set(selectableFamilies).size).toBe(selectableFamilies.length)
    for (const id of SANDBOX_SELECTABLE_CLI_TOOL_IDS) {
      expect(SANDBOX_CLI_TOOLS[id].id).toBe(id)
    }
  })

  it.each([
    ['google-cloud-cli@577.0.0-r1', ['bq', 'gcloud']],
    ['github-cli@2.97.0-r1', ['gh']],
    ['azure-cli@2.89.0-r1', ['az']],
    ['minio-mc@RELEASE.2025-08-13T08-35-41Z-r1', ['mc']],
  ] as const)('advertises executable search aliases for %s', (id, aliases) => {
    expect(SANDBOX_CLI_TOOLS[id].searchTerms).toEqual(expect.arrayContaining([...aliases]))
  })

  it('uses only allowlisted official artifact hosts and never package-manager installers', () => {
    const officialHosts = new Set([
      'awscli.amazonaws.com',
      'dl.k8s.io',
      'dl.min.io',
      'downloads.mongodb.com',
      'downloads.rclone.org',
      'get.helm.sh',
      'get.pulumi.com',
      'github.com',
      'gitlab.com',
      'packages.microsoft.com',
      'releases.hashicorp.com',
      'storage.googleapis.com',
    ])

    for (const recipe of catalogRecipes()) {
      expect(officialHosts.has(new URL(recipe.artifactUrl).hostname)).toBe(true)
      expect(recipe.installCommand).not.toMatch(/curl[^&|]*\|\s*(?:ba)?sh/)
      expect(recipe.installCommand).not.toContain('npm install')
      expect(recipe.installCommand).not.toContain('pip install')
    }
  })

  it.each([
    ['azure-cli@2.89.0-r1', ['export AZURE_CORE_COLLECT_TELEMETRY=no', 'az version']],
    [
      'doctl@1.166.0-r1',
      [
        "export HTTPS_PROXY=http://127.0.0.1:9 https_proxy=http://127.0.0.1:9 NO_PROXY='' no_proxy=''",
        'doctl version',
      ],
    ],
    ['github-cli@2.97.0-r1', ['export GH_NO_UPDATE_NOTIFIER=1 GH_TELEMETRY=0', 'gh --version']],
    [
      'gitlab-cli@1.111.0-r1',
      ['export GLAB_CHECK_UPDATE=false GLAB_SEND_TELEMETRY=false', 'glab version'],
    ],
    ['terraform@1.15.8-r1', ['export CHECKPOINT_DISABLE=1', 'terraform version']],
    ['pulumi@3.255.0-r1', ['export PULUMI_SKIP_UPDATE_CHECK=true', 'pulumi version']],
    ['stripe-cli@1.45.0-r1', ['stripe --version']],
    ['sops@3.13.3-r1', ['sops --disable-version-check --version']],
  ] as const)('uses an offline, telemetry-free verifier for %s', (id, commands) => {
    const [recipe] = sandboxCliToolRecipes([id])

    expect(recipe.verificationCommands).toEqual(commands)
  })

  it('installs and verifies both executables required by the Supabase binary distribution', () => {
    const [recipe] = sandboxCliToolRecipes(['supabase-cli@2.111.0-r1'])

    expect(recipe.executables).toEqual(['supabase', 'supabase-go'])
    expect(recipe.verificationCommands).toEqual(['supabase --version', 'supabase-go --version'])
    expect(recipe.installCommand).toContain("'/opt/sim-cli/supabase-cli/bin/supabase-go'")
  })

  it('puts installed commands on PATH for Python subprocesses and Shell runs', () => {
    const path = sandboxCliEnvironment(['google-cloud-cli@577.0.0-r1']).PATH

    expect(path).toContain('/opt/sim-cli/google-cloud-cli/google-cloud-sdk/bin')
    expect(path).toContain('/usr/local/games')
    expect(path).toContain('/usr/games')
  })

  it('pins PATH inside each verification instruction', () => {
    const cliTools = ['kubectl@1.36.3-r1'] as const
    const [recipe] = sandboxCliToolRecipes(cliTools)

    expect(sandboxCliVerificationCommand(recipe, cliTools)).toBe(
      `export PATH='/opt/sim-cli/kubectl/bin:${SANDBOX_SYSTEM_PATH}' && kubectl version --client`
    )
  })

  it('rejects unknown persisted recipe ids', () => {
    expect(() => canonicalizeSandboxCliTools(['google-cloud-cli@latest'])).toThrow(
      /Unsupported sandbox CLI tool/
    )
  })

  it('enforces the domain-level maximum after canonicalization', () => {
    expect(() =>
      canonicalizeSandboxCliTools(SANDBOX_CLI_TOOL_IDS.slice(0, MAX_SANDBOX_CLI_TOOLS + 1))
    ).toThrow(`at most ${MAX_SANDBOX_CLI_TOOLS}`)
    expect(
      canonicalizeSandboxCliTools(Array(MAX_SANDBOX_CLI_TOOLS + 1).fill(SANDBOX_CLI_TOOL_IDS[0]))
    ).toEqual([SANDBOX_CLI_TOOL_IDS[0]])
  })

  it('supports per-recipe provider compatibility with both providers as the default', () => {
    const providers = ['e2b', 'daytona'] as const
    const recipes = catalogRecipes()
    expect(
      recipes.find((recipe) => recipe.id === 'aws-cli@2.36.15-r1')?.supportedProviders
    ).toEqual(providers)

    for (const recipe of recipes) {
      expect(recipe.supportedProviders.length).toBeGreaterThan(0)
      expect(new Set(recipe.supportedProviders).size).toBe(recipe.supportedProviders.length)
      for (const provider of providers) {
        const assertion = () => assertSandboxCliToolsSupported([recipe.id], provider)
        if (recipe.supportedProviders.includes(provider)) {
          expect(assertion).not.toThrow()
        } else {
          expect(assertion).toThrow(/not supported/)
        }
      }
    }
  })

  it('keeps provisioning recipes out of the client-safe catalog', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'lib/execution/remote-sandbox/cli-tools.ts'),
      'utf8'
    )
    expect(source).not.toContain('installCommand')
    expect(source).not.toContain('verificationCommands')
    expect(source).not.toContain('pathEntries')
    expect(source).not.toContain('SANDBOX_SYSTEM_PATH')
    expect(source).not.toContain('storage.googleapis.com')
    expect(source).not.toContain('sha256')
  })
})
