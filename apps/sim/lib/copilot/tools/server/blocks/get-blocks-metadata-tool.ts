import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import {
  type GetBlocksMetadataInput,
  GetBlocksMetadataResult,
} from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'
import { registry as blockRegistry } from '@/blocks/registry'
import { tools as toolsRegistry } from '@/tools/registry'

export const getBlocksMetadataServerTool: BaseServerTool<
  ReturnType<typeof GetBlocksMetadataInput.parse>,
  ReturnType<typeof GetBlocksMetadataResult.parse>
> = {
  name: 'get_blocks_metadata',
  async execute({
    blockIds,
  }: ReturnType<typeof GetBlocksMetadataInput.parse>): Promise<
    ReturnType<typeof GetBlocksMetadataResult.parse>
  > {
    const logger = createLogger('GetBlocksMetadataServerTool')
    logger.debug('Executing get_blocks_metadata', { count: blockIds?.length })

    const result: Record<string, any> = {}
    for (const blockId of blockIds || []) {
      let metadata: any = {}

      if (SPECIAL_BLOCKS_METADATA[blockId]) {
        metadata = { ...SPECIAL_BLOCKS_METADATA[blockId] }
        metadata.tools = metadata.tools?.access || []
      } else {
        const blockConfig: any = (blockRegistry as any)[blockId]
        if (!blockConfig) {
          logger.debug('Block not found in registry', { blockId })
          continue
        }
        metadata = {
          id: blockId,
          name: blockConfig.name || blockId,
          description: blockConfig.description || '',
          longDescription: blockConfig.longDescription,
          category: blockConfig.category,
          bgColor: blockConfig.bgColor,
          inputs: blockConfig.inputs || {},
          outputs: blockConfig.outputs || {},
          tools: blockConfig.tools?.access || [],
          hideFromToolbar: blockConfig.hideFromToolbar,
        }
        if (blockConfig.subBlocks && Array.isArray(blockConfig.subBlocks)) {
          metadata.subBlocks = processSubBlocks(blockConfig.subBlocks)
        } else {
          metadata.subBlocks = []
        }
      }

      try {
        const workingDir = process.cwd()
        const isInAppsSim = workingDir.endsWith('/apps/sim') || workingDir.endsWith('\\apps\\sim')
        const basePath = isInAppsSim ? join(workingDir, '..', '..') : workingDir
        const docPath = join(
          basePath,
          'apps',
          'docs',
          'content',
          'docs',
          'yaml',
          'blocks',
          `${DOCS_FILE_MAPPING[blockId] || blockId}.mdx`
        )
        if (existsSync(docPath)) {
          metadata.yamlDocumentation = readFileSync(docPath, 'utf-8')
        }
      } catch {}

      if (Array.isArray(metadata.tools) && metadata.tools.length > 0) {
        metadata.toolDetails = {}
        for (const toolId of metadata.tools) {
          const tool = (toolsRegistry as any)[toolId]
          if (tool) {
            metadata.toolDetails[toolId] = { name: tool.name, description: tool.description }
          }
        }
      }

      result[blockId] = metadata
    }

    return GetBlocksMetadataResult.parse({ metadata: result })
  },
}

function resolveSubBlockOptions(options: any): any[] {
  try {
    if (typeof options === 'function') {
      const resolved = options()
      return Array.isArray(resolved) ? resolved : []
    }
    return Array.isArray(options) ? options : []
  } catch {
    return []
  }
}

function processSubBlocks(subBlocks: any[]): any[] {
  if (!Array.isArray(subBlocks)) return []
  return subBlocks.map((subBlock) => {
    const processed: any = {
      id: subBlock.id,
      title: subBlock.title,
      type: subBlock.type,
      layout: subBlock.layout,
      mode: subBlock.mode,
      required: subBlock.required,
      placeholder: subBlock.placeholder,
      description: subBlock.description,
      hidden: subBlock.hidden,
      condition: subBlock.condition,
      min: subBlock.min,
      max: subBlock.max,
      step: subBlock.step,
      integer: subBlock.integer,
      rows: subBlock.rows,
      password: subBlock.password,
      multiSelect: subBlock.multiSelect,
      language: subBlock.language,
      generationType: subBlock.generationType,
      provider: subBlock.provider,
      serviceId: subBlock.serviceId,
      requiredScopes: subBlock.requiredScopes,
      mimeType: subBlock.mimeType,
      acceptedTypes: subBlock.acceptedTypes,
      multiple: subBlock.multiple,
      maxSize: subBlock.maxSize,
      connectionDroppable: subBlock.connectionDroppable,
      columns: subBlock.columns,
      value: typeof subBlock.value === 'function' ? 'function' : undefined,
      wandConfig: subBlock.wandConfig,
    }
    if (subBlock.options) {
      const resolvedOptions = resolveSubBlockOptions(subBlock.options)
      processed.options = resolvedOptions.map((option: any) => ({
        label: option.label,
        id: option.id,
        hasIcon: !!option.icon,
      }))
    }
    return Object.fromEntries(Object.entries(processed).filter(([_, v]) => v !== undefined))
  })
}

const DOCS_FILE_MAPPING: Record<string, string> = {}

const SPECIAL_BLOCKS_METADATA: Record<string, any> = {
  loop: {
    type: 'loop',
    name: 'Loop',
    description: 'Control flow block for iterating over collections or repeating actions',
    inputs: {
      loopType: { type: 'string', required: true, enum: ['for', 'forEach'] },
      iterations: { type: 'number', required: false, minimum: 1, maximum: 1000 },
      collection: { type: 'string', required: false },
      maxConcurrency: { type: 'number', required: false, default: 1, minimum: 1, maximum: 10 },
    },
    outputs: {
      results: 'array',
      currentIndex: 'number',
      currentItem: 'any',
      totalIterations: 'number',
    },
    tools: { access: [] },
    subBlocks: [
      {
        id: 'loopType',
        title: 'Loop Type',
        type: 'dropdown',
        required: true,
        options: [
          { label: 'For Loop (count)', id: 'for' },
          { label: 'For Each (collection)', id: 'forEach' },
        ],
      },
      {
        id: 'iterations',
        title: 'Iterations',
        type: 'slider',
        min: 1,
        max: 1000,
        integer: true,
        condition: { field: 'loopType', value: 'for' },
      },
      {
        id: 'collection',
        title: 'Collection',
        type: 'short-input',
        placeholder: 'Array or object to iterate over...',
        condition: { field: 'loopType', value: 'forEach' },
      },
      {
        id: 'maxConcurrency',
        title: 'Max Concurrency',
        type: 'slider',
        min: 1,
        max: 10,
        integer: true,
        default: 1,
      },
    ],
  },
  parallel: {
    type: 'parallel',
    name: 'Parallel',
    description: 'Control flow block for executing multiple branches simultaneously',
    inputs: {
      parallelType: { type: 'string', required: true, enum: ['count', 'collection'] },
      count: { type: 'number', required: false, minimum: 1, maximum: 100 },
      collection: { type: 'string', required: false },
      maxConcurrency: { type: 'number', required: false, default: 10, minimum: 1, maximum: 50 },
    },
    outputs: { results: 'array', branchId: 'number', branchItem: 'any', totalBranches: 'number' },
    tools: { access: [] },
    subBlocks: [
      {
        id: 'parallelType',
        title: 'Parallel Type',
        type: 'dropdown',
        required: true,
        options: [
          { label: 'Count (number)', id: 'count' },
          { label: 'Collection (array)', id: 'collection' },
        ],
      },
      {
        id: 'count',
        title: 'Count',
        type: 'slider',
        min: 1,
        max: 100,
        integer: true,
        condition: { field: 'parallelType', value: 'count' },
      },
      {
        id: 'collection',
        title: 'Collection',
        type: 'short-input',
        placeholder: 'Array to process in parallel...',
        condition: { field: 'parallelType', value: 'collection' },
      },
      {
        id: 'maxConcurrency',
        title: 'Max Concurrency',
        type: 'slider',
        min: 1,
        max: 50,
        integer: true,
        default: 10,
      },
    ],
  },
}
