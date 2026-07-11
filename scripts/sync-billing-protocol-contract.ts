import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatGeneratedSource } from './format-generated-source'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const DEFAULT_CONTRACT_PATH = resolve(
  ROOT,
  '../copilot/copilot/contracts/billing-protocol-v1.schema.json'
)
const OUTPUT_PATH = resolve(ROOT, 'apps/sim/lib/copilot/generated/billing-protocol-v1.ts')

type SchemaNode = Record<string, unknown>

interface NamedPair {
  name: string
  code: string
  message: string
}

function schemaDefinitions(schema: SchemaNode): Record<string, SchemaNode> {
  const value = schema.$defs
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('billing-protocol-v1.schema.json is missing $defs')
  }
  return value as Record<string, SchemaNode>
}

function schemaDefinition(definitions: Record<string, SchemaNode>, name: string): SchemaNode {
  const value = definitions[name]
  if (!value) {
    throw new Error(`billing-protocol-v1.schema.json is missing $defs.${name}`)
  }
  return value
}

function resolveNode(definitions: Record<string, SchemaNode>, node: SchemaNode): SchemaNode {
  const ref = node.$ref
  if (typeof ref !== 'string') return node
  const prefix = '#/$defs/'
  if (!ref.startsWith(prefix)) {
    throw new Error(`Unsupported billing protocol schema reference: ${ref}`)
  }
  return schemaDefinition(definitions, ref.slice(prefix.length))
}

function objectProperties(node: SchemaNode, context: string): Record<string, SchemaNode> {
  const properties = node.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    throw new Error(`${context} is missing object properties`)
  }
  return properties as Record<string, SchemaNode>
}

function stringEnum(node: SchemaNode, context: string): string[] {
  const values = node.enum
  if (!Array.isArray(values) || !values.every((value) => typeof value === 'string')) {
    throw new Error(`${context} must be a string enum`)
  }
  return values as string[]
}

function singletonString(
  definitions: Record<string, SchemaNode>,
  node: SchemaNode,
  context: string
): string {
  const values = stringEnum(resolveNode(definitions, node), context)
  if (values.length !== 1) {
    throw new Error(`${context} must contain exactly one value`)
  }
  return values[0]
}

function singletonNumber(
  definitions: Record<string, SchemaNode>,
  node: SchemaNode,
  context: string
): number {
  const resolved = resolveNode(definitions, node)
  const values = resolved.enum
  if (!Array.isArray(values) || values.length !== 1 || typeof values[0] !== 'number') {
    throw new Error(`${context} must contain exactly one numeric value`)
  }
  return values[0]
}

function namedPairs(definitions: Record<string, SchemaNode>, definitionName: string): NamedPair[] {
  const collection = schemaDefinition(definitions, definitionName)
  return Object.entries(objectProperties(collection, definitionName))
    .map(([name, pairNode]) => {
      const pair = resolveNode(definitions, pairNode)
      const properties = objectProperties(pair, `${definitionName}.${name}`)
      if (!properties.code || !properties.message) {
        throw new Error(`${definitionName}.${name} must contain code and message`)
      }
      return {
        name,
        code: singletonString(definitions, properties.code, `${definitionName}.${name}.code`),
        message: singletonString(
          definitions,
          properties.message,
          `${definitionName}.${name}.message`
        ),
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

function pascalCase(value: string): string {
  const parts = value.split(/[^A-Za-z0-9]+/).filter(Boolean)
  if (parts.length === 0) {
    throw new Error(`Cannot derive an identifier from ${JSON.stringify(value)}`)
  }
  const identifier = parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('')
  if (/^[0-9]/.test(identifier)) {
    throw new Error(`Derived identifier starts with a digit: ${identifier}`)
  }
  return identifier
}

function renderRecord(entries: Array<{ name: string; value: string }>, indent = '  '): string {
  return entries.map(({ name, value }) => `${indent}${name}: ${JSON.stringify(value)},`).join('\n')
}

function renderPairs(entries: NamedPair[]): string {
  return entries
    .map(
      ({ name, code, message }) => `  ${name}: {
    code: ${JSON.stringify(code)},
    message: ${JSON.stringify(message)},
  },`
    )
    .join('\n')
}

function render(schema: SchemaNode): string {
  const definitions = schemaDefinitions(schema)
  const headerProperties = objectProperties(
    schemaDefinition(definitions, 'BillingProtocolV1Headers'),
    'BillingProtocolV1Headers'
  )
  const headers = {
    attribution: singletonString(
      definitions,
      headerProperties.attribution,
      'BillingProtocolV1Headers.attribution'
    ),
    protocol: singletonString(
      definitions,
      headerProperties.protocol,
      'BillingProtocolV1Headers.protocol'
    ),
    requestId: singletonString(
      definitions,
      headerProperties.requestId,
      'BillingProtocolV1Headers.requestId'
    ),
  }

  const protocolValues = stringEnum(
    schemaDefinition(definitions, 'BillingProtocol'),
    'BillingProtocol'
  )
  const requiredProtocols = ['attribution-v1', 'direct-v1', 'legacy-v0'] as const
  for (const protocol of requiredProtocols) {
    if (!protocolValues.includes(protocol)) {
      throw new Error(`BillingProtocol is missing ${protocol}`)
    }
  }
  if (protocolValues.length !== requiredProtocols.length) {
    throw new Error(`BillingProtocol contains unsupported values: ${protocolValues.join(', ')}`)
  }

  const limitProperties = objectProperties(
    schemaDefinition(definitions, 'BillingProtocolV1Limits'),
    'BillingProtocolV1Limits'
  )
  const attributionHeaderMaxBytes = singletonNumber(
    definitions,
    limitProperties.attributionHeaderMaxBytes,
    'BillingProtocolV1Limits.attributionHeaderMaxBytes'
  )
  const callbackOutcomes = namedPairs(definitions, 'BillingProtocolV1CallbackOutcomes')
  const analyticsOutcomes = stringEnum(
    schemaDefinition(definitions, 'BillingAnalyticsOutcome'),
    'BillingAnalyticsOutcome'
  )
    .slice()
    .sort()

  return `/**
 * AUTO-GENERATED FILE. DO NOT EDIT.
 *
 * Source: copilot/copilot/contracts/billing-protocol-v1.schema.json
 * Regenerate with: bun run billing-protocol-contract:generate
 */

export const BILLING_PROTOCOL_HEADERS = {
${renderRecord([
  { name: 'attribution', value: headers.attribution },
  { name: 'protocol', value: headers.protocol },
  { name: 'requestId', value: headers.requestId },
])}
} as const;

export const BILLING_ATTRIBUTION_HEADER = BILLING_PROTOCOL_HEADERS.attribution;
export const COPILOT_BILLING_PROTOCOL_HEADER = BILLING_PROTOCOL_HEADERS.protocol;
export const BILLING_REQUEST_ID_HEADER = BILLING_PROTOCOL_HEADERS.requestId;

export const COPILOT_BILLING_PROTOCOL = {
  attributed: "attribution-v1",
  direct: "direct-v1",
  legacy: "legacy-v0",
} as const;

export type CopilotBillingProtocol =
  (typeof COPILOT_BILLING_PROTOCOL)[keyof typeof COPILOT_BILLING_PROTOCOL];

export const COPILOT_BILLING_PROTOCOL_VALUES = [
  COPILOT_BILLING_PROTOCOL.attributed,
  COPILOT_BILLING_PROTOCOL.direct,
  COPILOT_BILLING_PROTOCOL.legacy,
] as const;

export const BILLING_ATTRIBUTION_HEADER_MAX_BYTES = ${attributionHeaderMaxBytes};

export const BILLING_CALLBACK_OUTCOME = {
${renderPairs(callbackOutcomes)}
} as const;

export const BillingAnalyticsOutcome = {
${renderRecord(analyticsOutcomes.map((value) => ({ name: pascalCase(value), value })))}
} as const;

export type BillingAnalyticsOutcomeValue =
  (typeof BillingAnalyticsOutcome)[keyof typeof BillingAnalyticsOutcome];
`
}

async function main() {
  const checkOnly = process.argv.includes('--check')
  const inputArg = process.argv.find((argument) => argument.startsWith('--input='))
  const inputPath = inputArg
    ? resolve(ROOT, inputArg.slice('--input='.length))
    : DEFAULT_CONTRACT_PATH

  const schema = JSON.parse(await readFile(inputPath, 'utf8')) as SchemaNode
  const rendered = formatGeneratedSource(render(schema), OUTPUT_PATH, ROOT)

  if (checkOnly) {
    const existing = await readFile(OUTPUT_PATH, 'utf8').catch(() => null)
    if (existing !== rendered) {
      throw new Error(
        'Generated billing protocol contract is stale. Run: bun run billing-protocol-contract:generate'
      )
    }
    console.log('Billing protocol contract is up to date.')
    return
  }

  await mkdir(dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, rendered, 'utf8')
  console.log(`Generated billing protocol types -> ${OUTPUT_PATH}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
