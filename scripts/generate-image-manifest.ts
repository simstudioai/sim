#!/usr/bin/env bun
/**
 * Generates the container image inventory for the Sim Helm chart.
 *
 * An operator mirroring Sim into a disconnected registry needs the complete set
 * of images an install pulls, and reading `values.yaml` by hand does not give it.
 * An image can be referenced from a template rather than named by an obvious
 * values key, and a hand-built list is then wrong in exactly the case that is
 * hardest to notice: the mirror succeeds, and one pod still pulls from the
 * internet at install time.
 *
 * The inventory is therefore derived from the rendered chart rather than from
 * values, and checked in so a chart change that adds an image has to update it.
 * Tags stay unresolved here: digests belong to a release, not to the chart, and
 * pinning them in a checked-in file would drift on every upstream rebuild. The
 * chart's `sim.image` helper already accepts a per-image `digest`, so an operator
 * pins at install time against the digests their own mirror resolved.
 *
 * Usage:
 *   bun run scripts/generate-image-manifest.ts
 *   bun run scripts/generate-image-manifest.ts --check
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const CHART_DIR = resolve(ROOT, 'helm/sim')
const OUTPUT_PATH = resolve(CHART_DIR, 'images.yaml')
const CHECK_MODE = process.argv.includes('--check')

/**
 * Render arguments.
 *
 * `ci/full-values.yaml` is the chart's own "every optional component enabled"
 * profile, but it leaves `ollama.gpu.enabled` off, and the device plugin renders
 * only under that key. Enabling it here is what makes this an inventory of every
 * image the chart can pull rather than of one popular configuration.
 */
const RENDER_ARGS = [
  'template',
  'sim',
  CHART_DIR,
  '--namespace',
  'sim',
  '--values',
  resolve(CHART_DIR, 'ci/full-values.yaml'),
  '--set',
  'ollama.gpu.enabled=true',
] as const

/**
 * Sentinel registry used for the second render.
 *
 * The path an operator must mirror TO is not derivable from the pullable
 * reference: `global.imageRegistry` defaults to `ghcr.io`, so a Sim image reads
 * `ghcr.io/simstudioai/app` but redirects to `<registry>/simstudioai/app` — the
 * `ghcr.io/` is the default registry, not part of the repository. The NVIDIA
 * plugin is the reverse: `nvcr.io/` IS in its repository and survives the
 * rewrite. Rendering a second time with a known registry and stripping it back
 * off yields the real destination for every image without encoding that rule
 * twice.
 */
const MIRROR_SENTINEL = 'mirror.invalid'

const MIRROR_RENDER_ARGS = [
  ...RENDER_ARGS,
  '--set',
  `global.imageRegistry=${MIRROR_SENTINEL}`,
  '--set',
  'global.useRegistryForAllImages=true',
] as const

/** Pod-spec keys whose entries carry an image reference. */
const CONTAINER_KEYS = new Set(['containers', 'initContainers', 'ephemeralContainers'])

/**
 * Collects every image reference in a set of rendered Kubernetes documents.
 *
 * Walks for container arrays by key rather than matching on workload kind, so a
 * chart that grows a Job, DaemonSet, or bare Pod is covered without changing
 * this: every workload nests its containers under the same three keys.
 */
export function collectImages(documents: readonly unknown[]): string[] {
  const images = new Set<string>()

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry)
      return
    }
    if (node === null || typeof node !== 'object') return

    for (const [key, value] of Object.entries(node)) {
      if (CONTAINER_KEYS.has(key) && Array.isArray(value)) {
        for (const container of value) {
          if (container === null || typeof container !== 'object') continue
          const image = (container as { image?: unknown }).image
          if (typeof image === 'string' && image.length > 0) images.add(image)
        }
      }
      visit(value)
    }
  }

  visit(documents)
  return [...images].sort()
}

/** Renders the checked-in manifest. */
export interface ImageEntry {
  /** The reference to pull from today. */
  source: string
  /** The path the chart pulls once redirected, relative to your registry. */
  mirror: string
}

/**
 * Pairs each pullable reference with the repository path the chart resolves to
 * under a mirror, by stripping the sentinel registry off the second render.
 */
export function pairSources(sources: readonly string[], mirrored: readonly string[]): ImageEntry[] {
  if (sources.length !== mirrored.length) {
    throw new Error(
      `The two renders disagree: ${sources.length} images by default, ${mirrored.length} under a mirror`
    )
  }

  const byTag = new Map<string, string>()
  for (const ref of mirrored) {
    const stripped = ref.startsWith(`${MIRROR_SENTINEL}/`)
      ? ref.slice(MIRROR_SENTINEL.length + 1)
      : ref
    const key = stripped.slice(stripped.lastIndexOf('/') + 1)
    // Two images sharing a name:tag would pair last-write-wins and hand one of
    // them the other's mirror path — the silent kind of wrong this file exists
    // to prevent.
    if (byTag.has(key)) {
      throw new Error(
        `Two images share the name and tag ${key}; the mirror pairing would be ambiguous`
      )
    }
    byTag.set(key, stripped)
  }

  return sources.map((source) => {
    const key = source.slice(source.lastIndexOf('/') + 1)
    const mirror = byTag.get(key)
    if (!mirror) {
      throw new Error(`No mirrored path rendered for ${source}; the two renders disagree`)
    }
    return { source, mirror }
  })
}

export function renderManifest(input: {
  appVersion: string
  images: readonly ImageEntry[]
}): string {
  const entries = input.images
    .map((image) => `  - source: ${image.source}\n    mirror: ${image.mirror}`)
    .join('\n')

  return `# Generated by \`bun run images:generate\`. Do not edit this file directly.
#
# Every container image this chart can render with all optional components
# enabled — mirror them into a disconnected registry before installing. Two
# entries are not part of an ordinary install: \`busybox\` renders only from the
# \`helm test\` hook, and \`simstudioai/copilot\` requires enterprise registry
# access. Skip either if you do not use it.
#
# To redirect them, set \`global.imageRegistry\` to your registry AND
# \`global.useRegistryForAllImages: true\` — on its own, \`imageRegistry\` only
# rewrites the \`simstudioai/*\` images, leaving the third-party ones pointing at
# their public registries. Pin each image's \`digest\` to what your mirror
# resolved.
#
# Each entry pairs the reference to pull FROM with the path the chart resolves
# to once redirected. Copy \`source\` to \`<your-registry>/<mirror>\` — they differ:
# \`ghcr.io/\` is the default registry and is replaced, while the device plugin's
# \`nvcr.io/\` is part of its repository and is kept. If your registry cannot nest
# that path, override that one image:
# \`ollama.gpu.devicePlugin.image.repository=<your-registry>/nvidia/k8s-device-plugin\`
# with global rewriting left on, since the override is used verbatim.
appVersion: ${input.appVersion}
images:
${entries}
`
}

/** Reads a scalar field from Chart.yaml without pulling in a YAML dependency for one scalar. */
function readChartField(chart: string, field: string): string {
  const match = chart.match(new RegExp(`^${field}:\\s*"?([^"\\n]+)"?\\s*$`, 'm'))
  if (!match) throw new Error(`Chart.yaml is missing a \`${field}\` field`)
  return match[1].trim()
}

function renderChart(args: readonly string[] = RENDER_ARGS): unknown[] {
  let rendered: ReturnType<typeof Bun.spawnSync>
  try {
    rendered = Bun.spawnSync(['helm', ...args], { cwd: ROOT })
  } catch {
    throw new Error('Could not run `helm`. Install the Helm CLI to regenerate the image inventory.')
  }

  if (!rendered.success) {
    throw new Error(`helm template failed:\n${rendered.stderr.toString().trim()}`)
  }

  const documents = Bun.YAML.parse(rendered.stdout.toString())
  return Array.isArray(documents) ? documents : [documents]
}

async function main(): Promise<void> {
  const chart = await readFile(resolve(CHART_DIR, 'Chart.yaml'), 'utf8')
  const manifest = renderManifest({
    appVersion: readChartField(chart, 'appVersion'),
    images: pairSources(
      collectImages(renderChart()),
      collectImages(renderChart(MIRROR_RENDER_ARGS))
    ),
  })

  if (!CHECK_MODE) {
    await writeFile(OUTPUT_PATH, manifest)
    console.log(`Wrote ${OUTPUT_PATH}`)
    return
  }

  const current = await readFile(OUTPUT_PATH, 'utf8').catch(() => '')
  if (current !== manifest) {
    const before = new Set(current.split('\n'))
    const after = new Set(manifest.split('\n'))
    for (const line of after) if (!before.has(line)) console.error(`+ ${line}`)
    for (const line of before) if (!after.has(line)) console.error(`- ${line}`)
    console.error(
      `\n${OUTPUT_PATH} is out of date. Run \`bun run images:generate\` and commit the result.`
    )
    process.exit(1)
  }
  console.log('Image inventory is up to date.')
}

if (import.meta.main) await main()
