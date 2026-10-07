/** Generates public reference pages and legacy redirects from platform-owned catalogs. */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import integrations from '@sim/deployment-config/integrations.json'
import { createLogger } from '@sim/logger'
import { compareStrings, slugify } from '@sim/utils/string'
import { PROVIDER_DEFINITIONS } from '@/providers/models'

const logger = createLogger('ReferenceDocs')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const check = process.argv.includes('--check')
const output = new Map<string, string>()
const redirects: { source: string; destination: string; permanent: boolean }[] = []
const prefixes: Record<string, string> = { 'azure-openai': 'azure/' }
const providers = Object.values(PROVIDER_DEFINITIONS).sort((a, b) => compareStrings(a.id, b.id))
const docsRoot = 'apps/docs/content/docs/models'

function redirect(source: string, destination = `https://docs.sim.ai${source}`) {
  redirects.push({ source, destination, permanent: true })
}

function page(file: string, title: string, description: string, body: string) {
  output.set(
    file,
    `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}\n`
  )
}

redirect('/models')
page(
  `${docsRoot}/index.mdx`,
  'Models',
  'Model and provider reference generated from the Sim platform catalog.',
  `This reference is generated from the platform’s model definitions. Prices are in USD per million tokens unless the model's pricing metadata specifies another unit. These are catalog values, not a billing quote.\n\n${providers.map((p) => `- [${p.name}](/models/${slugify(p.id)}): ${p.description}`).join('\n')}`
)
for (const provider of providers) {
  const providerPath = `/models/${slugify(provider.id)}`
  redirect(providerPath)
  const links: string[] = []
  for (const model of provider.models) {
    const prefix = prefixes[provider.id] ?? `${provider.id}/`
    const shortId = model.id.startsWith(prefix) ? model.id.slice(prefix.length) : model.id
    const modelPath = `${providerPath}/${slugify(shortId)}`
    redirect(modelPath)
    links.push(`- [${model.id}](${modelPath})`)
    page(
      `apps/docs/content/docs${modelPath}.mdx`,
      model.id,
      `Sim model reference for ${model.id} on ${provider.name}.`,
      `[${provider.name}](${providerPath})\n\nModel ID: \`${model.id}\`\n\nContext window: ${model.contextWindow ?? 'Not published'} tokens.\n\nLifecycle: ${model.sunset?.status ?? 'Current'}.\n\n## Pricing\n\nCatalog metadata, including units, tiers, and last verification date:\n\n\`\`\`json\n${JSON.stringify(model.pricing, null, 2)}\n\`\`\`\n\n## Capabilities\n\nProvider defaults with model overrides:\n\n\`\`\`json\n${JSON.stringify({ ...provider.capabilities, ...model.capabilities }, null, 2)}\n\`\`\`\n\nSelect this model in an [Agent block](/agents). Credentials and availability depend on your deployment.`
    )
  }
  page(
    `apps/docs/content/docs${providerPath}/index.mdx`,
    provider.name,
    provider.description,
    `${provider.description}\n\n${provider.defaultModel ? `Default model: \`${provider.defaultModel}\`.\n\n` : ''}${links.length ? links.join('\n') : 'This provider loads its model catalog dynamically from your configured endpoint.'}`
  )
}
redirect('/integrations')
const aliases: Record<string, string> = {
  incidentio: 'incident-io',
  'sap-s-4hana': 'sap-s4hana',
  calcom: 'cal-com',
}
for (const integration of integrations.integrations) {
  const destination = integration.docsUrl.replace(/\/$/, '')
  redirect(`/integrations/${integration.slug}`, destination)
  for (const [old, current] of Object.entries(aliases)) {
    if (current === integration.slug) redirect(`/integrations/${old}`, destination)
  }
}
output.set(
  'apps/sim/lib/navigation/reference-redirects.json',
  `${JSON.stringify(
    redirects.sort((a, b) => compareStrings(a.source, b.source)),
    null,
    2
  )}\n`
)
const seen = new Set<string>()
for (const item of redirects) {
  if (seen.has(item.source)) throw new Error(`Duplicate reference URL: ${item.source}`)
  seen.add(item.source)
}
mkdirSync(path.join(root, docsRoot), { recursive: true })
const stale: string[] = []
for (const file of readdirSync(path.join(root, docsRoot), {
  recursive: true,
  withFileTypes: true,
})) {
  if (!file.isFile()) continue
  const relative = path.relative(root, path.join(file.parentPath, file.name))
  if (!output.has(relative)) {
    if (check) stale.push(relative)
    else rmSync(path.join(root, relative))
  }
}
for (const [file, content] of output) {
  const absolute = path.join(root, file)
  if (check) {
    try {
      if (readFileSync(absolute, 'utf8') !== content) stale.push(file)
    } catch {
      stale.push(file)
    }
  } else {
    mkdirSync(path.dirname(absolute), { recursive: true })
    writeFileSync(absolute, content)
  }
}
if (stale.length)
  throw new Error(`Run bun run reference-docs:generate. Stale files: ${stale.join(', ')}`)
logger.info(`${check ? 'Verified' : 'Generated'} ${output.size} reference artifacts`)
