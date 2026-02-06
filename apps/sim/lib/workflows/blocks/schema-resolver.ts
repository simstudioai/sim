import { createLogger } from '@sim/logger'
import { getAllBlocks, getBlock } from '@/blocks/registry'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import type { ResolvedBlock, ResolvedOption, ResolvedOutput, ResolvedSubBlock } from './schema-types'

const logger = createLogger('BlockSchemaResolver')

/**
 * BlockSchemaResolver provides typed access to block configurations.
 *
 * It wraps the raw block registry and returns resolved, typed schemas
 * that consumers can use without any type assertions.
 */
export class BlockSchemaResolver {
  private cache = new Map<string, ResolvedBlock>()

  /** Resolve a single block by type */
  resolveBlock(type: string): ResolvedBlock | null {
    const cached = this.cache.get(type)
    if (cached) return cached

    const config = getBlock(type)
    if (!config) return null

    const resolved = this.buildResolvedBlock(config)
    this.cache.set(type, resolved)
    return resolved
  }

  /** Resolve all available blocks */
  resolveAllBlocks(options?: { includeHidden?: boolean }): ResolvedBlock[] {
    const configs = getAllBlocks()
    return configs
      .filter((config) => options?.includeHidden || !config.hideFromToolbar)
      .map((config) => this.resolveBlock(config.type))
      .filter((block): block is ResolvedBlock => block !== null)
  }

  /** Clear the cache (call when block registry changes) */
  clearCache(): void {
    this.cache.clear()
  }

  private buildResolvedBlock(config: BlockConfig): ResolvedBlock {
    return {
      type: config.type,
      name: config.name,
      description: config.description,
      category: config.category,
      icon: config.icon as unknown as ResolvedBlock['icon'],
      isTrigger: this.isTriggerBlock(config),
      hideFromToolbar: config.hideFromToolbar ?? false,
      subBlocks: config.subBlocks.map((subBlock) => this.resolveSubBlock(subBlock)),
      outputs: this.resolveOutputs(config),
      supportsTriggerMode: this.supportsTriggerMode(config),
      hasAdvancedMode: config.subBlocks.some((subBlock) => subBlock.mode === 'advanced'),
      raw: config,
    }
  }

  private resolveSubBlock(sb: SubBlockConfig): ResolvedSubBlock {
    const resolved: ResolvedSubBlock = {
      id: sb.id,
      type: sb.type,
      label: sb.title,
      placeholder: sb.placeholder,
      required: typeof sb.required === 'boolean' ? sb.required : undefined,
      password: sb.password,
      hasCondition: Boolean(sb.condition),
      defaultValue: sb.defaultValue,
      validation: {
        min: sb.min,
        max: sb.max,
        pattern: this.resolvePattern(sb),
      },
    }

    const condition = this.resolveCondition(sb)
    if (condition) {
      resolved.condition = condition
    }

    const options = this.resolveOptions(sb)
    if (options.length > 0) {
      resolved.options = options
    }

    if (!resolved.validation?.min && !resolved.validation?.max && !resolved.validation?.pattern) {
      delete resolved.validation
    }

    return resolved
  }

  private resolveCondition(sb: SubBlockConfig): ResolvedSubBlock['condition'] | undefined {
    try {
      const condition = typeof sb.condition === 'function' ? sb.condition() : sb.condition
      if (!condition || typeof condition !== 'object') {
        return undefined
      }

      return {
        field: String(condition.field),
        value: condition.value,
      }
    } catch (error) {
      logger.warn('Failed to resolve sub-block condition', {
        subBlockId: sb.id,
        error: error instanceof Error ? error.message : String(error),
      })
      return undefined
    }
  }

  private resolveOptions(sb: SubBlockConfig): ResolvedOption[] {
    try {
      if (Array.isArray(sb.options)) {
        return sb.options.map((opt) => {
          if (typeof opt === 'string') {
            return { label: opt, value: opt }
          }

          const label = String(opt.label || opt.id || '')
          const value = String(opt.id || opt.label || '')

          return {
            label,
            value,
            id: opt.id,
          }
        })
      }

      // For function-based or dynamic options, return empty.
      // Consumers can evaluate these options if they need runtime resolution.
      return []
    } catch (error) {
      logger.warn('Failed to resolve sub-block options', {
        subBlockId: sb.id,
        error: error instanceof Error ? error.message : String(error),
      })
      return []
    }
  }

  private resolveOutputs(config: BlockConfig): ResolvedOutput[] {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const blockOutputs = require('@/lib/workflows/blocks/block-outputs') as {
        getBlockOutputPaths: (
          blockType: string,
          subBlocks?: Record<string, unknown>,
          triggerMode?: boolean
        ) => string[]
      }

      const paths = blockOutputs.getBlockOutputPaths(config.type, {}, false)
      return paths.map((path) => ({
        name: path,
        type: 'string',
      }))
    } catch (error) {
      logger.warn('Failed to resolve block outputs, using fallback', {
        blockType: config.type,
        error: error instanceof Error ? error.message : String(error),
      })
      return [{ name: 'result', type: 'string' }]
    }
  }

  private isTriggerBlock(config: BlockConfig): boolean {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const triggerUtils = require('@/lib/workflows/triggers/input-definition-triggers') as {
        isInputDefinitionTrigger: (blockType: string) => boolean
      }
      return triggerUtils.isInputDefinitionTrigger(config.type)
    } catch (error) {
      logger.warn('Failed to detect trigger block, using fallback', {
        blockType: config.type,
        error: error instanceof Error ? error.message : String(error),
      })
      return config.type === 'starter'
    }
  }

  private supportsTriggerMode(config: BlockConfig): boolean {
    return Boolean(
      config.triggerAllowed ||
        config.subBlocks.some((subBlock) => subBlock.id === 'triggerMode' || subBlock.mode === 'trigger')
    )
  }

  private resolvePattern(sb: SubBlockConfig): string | undefined {
    const maybePattern = (sb as SubBlockConfig & { pattern?: string }).pattern
    return typeof maybePattern === 'string' ? maybePattern : undefined
  }
}

/** Singleton resolver instance */
export const blockSchemaResolver = new BlockSchemaResolver()
