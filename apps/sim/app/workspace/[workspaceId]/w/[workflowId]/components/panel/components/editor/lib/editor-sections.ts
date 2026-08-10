import type { SubBlockConfig } from '@/blocks/types'

export interface EditorSection {
  id: string
  title: string
  description?: string
  subBlocks: SubBlockConfig[]
}

interface EditorSectionDefinition {
  id: string
  title: string
  description?: string
}

const API_SECTIONS = [
  { id: 'request', title: 'Request', description: 'Endpoint and request method.' },
  { id: 'request-data', title: 'Request data', description: 'Parameters, headers, and body.' },
  { id: 'execution', title: 'Execution', description: 'Timeout, retry, and proxy behavior.' },
] as const satisfies readonly EditorSectionDefinition[]

const AGENT_SECTIONS = [
  { id: 'messages', title: 'Prompt', description: 'Instructions and conversation context.' },
  { id: 'model', title: 'Model & provider', description: 'Model selection and provider access.' },
  {
    id: 'context',
    title: 'Context',
    description: 'Files, tools, and skills available to the agent.',
  },
  { id: 'memory', title: 'Memory', description: 'Conversation state retained across runs.' },
  { id: 'generation', title: 'Generation', description: 'Model behavior and response limits.' },
  { id: 'output', title: 'Output', description: 'Response shape and continuation.' },
] as const satisfies readonly EditorSectionDefinition[]

const INTEGRATION_SECTIONS = [
  { id: 'operation', title: 'Action', description: 'Choose what this block does.' },
  { id: 'connection', title: 'Connection', description: 'Account and authentication.' },
  { id: 'inputs', title: 'Inputs', description: 'Values used by the selected operation.' },
  { id: 'options', title: 'Options', description: 'Additional operation behavior.' },
] as const satisfies readonly EditorSectionDefinition[]

const CONDITION_SECTIONS = [
  { id: 'rules', title: 'Rules', description: 'Define the branches this block can take.' },
] as const satisfies readonly EditorSectionDefinition[]

const AGENT_MODEL_IDS = new Set([
  'model',
  'vertexCredential',
  'vertexManualCredential',
  'apiKey',
  'azureEndpoint',
  'azureApiVersion',
  'vertexProject',
  'vertexLocation',
  'bedrockAccessKeyId',
  'bedrockSecretKey',
  'bedrockRegion',
])

const AGENT_CONTEXT_IDS = new Set(['attachmentFiles', 'files', 'tools', 'skills'])
const AGENT_MEMORY_IDS = new Set([
  'memoryType',
  'conversationId',
  'slidingWindowSize',
  'slidingWindowTokens',
  'previousInteractionId',
])
const AGENT_GENERATION_IDS = new Set([
  'reasoningEffort',
  'verbosity',
  'thinkingLevel',
  'promptCaching',
  'temperature',
  'maxTokens',
])

function getCanonicalId(subBlock: SubBlockConfig): string {
  return subBlock.canonicalParamId ?? subBlock.id
}

function getIntegrationSectionId(subBlock: SubBlockConfig): string {
  const id = getCanonicalId(subBlock).toLowerCase()

  if (id === 'operation' || id.includes('trigger')) return 'operation'
  if (
    id.includes('credential') ||
    id.includes('account') ||
    id.includes('token') ||
    id === 'authmethod'
  ) {
    return 'connection'
  }
  if (subBlock.mode === 'advanced' && !subBlock.canonicalParamId) return 'options'
  return 'inputs'
}

function getSectionConfiguration(
  blockType: string
): readonly EditorSectionDefinition[] | undefined {
  if (blockType === 'api') return API_SECTIONS
  if (blockType === 'agent') return AGENT_SECTIONS
  if (blockType === 'slack' || blockType === 'slack_v2') return INTEGRATION_SECTIONS
  if (blockType === 'linear' || blockType === 'linear_v2') return INTEGRATION_SECTIONS
  if (blockType === 'condition') return CONDITION_SECTIONS
  return undefined
}

function getSectionId(blockType: string, subBlock: SubBlockConfig): string {
  const id = getCanonicalId(subBlock)

  if (blockType === 'api') {
    if (id === 'url' || id === 'method') return 'request'
    if (id === 'params' || id === 'headers' || id === 'body') return 'request-data'
    return 'execution'
  }

  if (blockType === 'agent') {
    if (id === 'messages') return 'messages'
    if (AGENT_MODEL_IDS.has(id)) return 'model'
    if (AGENT_CONTEXT_IDS.has(id)) return 'context'
    if (AGENT_MEMORY_IDS.has(id)) return 'memory'
    if (AGENT_GENERATION_IDS.has(id)) return 'generation'
    if (id === 'responseFormat') return 'output'
    return 'generation'
  }

  if (
    blockType === 'slack' ||
    blockType === 'slack_v2' ||
    blockType === 'linear' ||
    blockType === 'linear_v2'
  ) {
    return getIntegrationSectionId(subBlock)
  }

  return 'rules'
}

/**
 * Groups visible subblocks for the representative editor-layout prototypes.
 * Blocks outside the prototype set return `null` and retain the legacy flow.
 */
export function groupSubBlocksIntoEditorSections(
  blockType: string,
  subBlocks: SubBlockConfig[]
): EditorSection[] | null {
  const definitions = getSectionConfiguration(blockType)
  if (!definitions) return null

  const grouped = new Map<string, SubBlockConfig[]>()
  for (const subBlock of subBlocks) {
    const sectionId = getSectionId(blockType, subBlock)
    const sectionSubBlocks = grouped.get(sectionId) ?? []
    sectionSubBlocks.push(subBlock)
    grouped.set(sectionId, sectionSubBlocks)
  }

  return definitions.flatMap((definition) => {
    const sectionSubBlocks = grouped.get(definition.id)
    if (!sectionSubBlocks?.length) return []
    return [{ ...definition, subBlocks: sectionSubBlocks }]
  })
}
