import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')

import { generateRouterPrompt } from '@/blocks/blocks/router'
import {
  getAllBlocks,
  getAllBlockTypes,
  getBlock,
  getBlockByToolName,
  getBlocksByCategory,
  isValidBlockType,
  registry,
} from '@/blocks/registry'
import { AuthMode } from '@/blocks/types'

describe.concurrent('Blocks Module', () => {
  describe('Registry', () => {
    it('should have a non-empty registry of blocks', () => {
      expect(Object.keys(registry).length).toBeGreaterThan(0)
    })

    it('should have all blocks with required properties', () => {
      const blocks = getAllBlocks()
      for (const block of blocks) {
        expect(block.type).toBeDefined()
        expect(typeof block.type).toBe('string')
        expect(block.name).toBeDefined()
        expect(typeof block.name).toBe('string')
        expect(block.description).toBeDefined()
        expect(typeof block.description).toBe('string')
        expect(block.category).toBeDefined()
        expect(['blocks', 'tools', 'triggers']).toContain(block.category)
        expect(block.bgColor).toBeDefined()
        expect(typeof block.bgColor).toBe('string')
        expect(block.bgColor.length).toBeGreaterThan(0)
        expect(block.icon).toBeDefined()
        expect(typeof block.icon).toBe('function')
        expect(block.tools).toBeDefined()
        expect(block.tools.access).toBeDefined()
        expect(Array.isArray(block.tools.access)).toBe(true)
        expect(block.inputs).toBeDefined()
        expect(typeof block.inputs).toBe('object')
        expect(block.outputs).toBeDefined()
        expect(typeof block.outputs).toBe('object')
        expect(block.subBlocks).toBeDefined()
        expect(Array.isArray(block.subBlocks)).toBe(true)
      }
    })

    it('should have unique block types', () => {
      const types = getAllBlockTypes()
      const uniqueTypes = new Set(types)
      expect(types.length).toBe(uniqueTypes.size)
    })
  })

  describe('getBlock', () => {
    it('should return a block by type', () => {
      const block = getBlock('function')
      expect(block).toBeDefined()
      expect(block?.type).toBe('function')
      expect(block?.name).toBe('Function')
    })

    it('should return undefined for non-existent block type', () => {
      const block = getBlock('non-existent-block')
      expect(block).toBeUndefined()
    })

    it('should normalize hyphens to underscores', () => {
      const block = getBlock('microsoft-teams')
      expect(block).toBeDefined()
      expect(block?.type).toBe('microsoft_teams')
    })
  })

  describe('getBlockByToolName', () => {
    it('should find a block by tool name', () => {
      const block = getBlockByToolName('function_execute')
      expect(block).toBeDefined()
      expect(block?.type).toBe('function')
    })

    it('should find a block with http_request tool', () => {
      const block = getBlockByToolName('http_request')
      expect(block).toBeDefined()
      expect(block?.type).toBe('api')
    })

    it('should return undefined for non-existent tool name', () => {
      const block = getBlockByToolName('non_existent_tool')
      expect(block).toBeUndefined()
    })
  })

  describe('getBlocksByCategory', () => {
    it('should return blocks in the "blocks" category', () => {
      const blocks = getBlocksByCategory('blocks')
      expect(blocks.length).toBeGreaterThan(0)
      for (const block of blocks) {
        expect(block.category).toBe('blocks')
      }
    })

    it('should return blocks in the "tools" category', () => {
      const blocks = getBlocksByCategory('tools')
      expect(blocks.length).toBeGreaterThan(0)
      for (const block of blocks) {
        expect(block.category).toBe('tools')
      }
    })

    it('should return blocks in the "triggers" category', () => {
      const blocks = getBlocksByCategory('triggers')
      expect(blocks.length).toBeGreaterThan(0)
      for (const block of blocks) {
        expect(block.category).toBe('triggers')
      }
    })
  })

  describe('getAllBlockTypes', () => {
    it('should return an array of block types', () => {
      const types = getAllBlockTypes()
      expect(Array.isArray(types)).toBe(true)
      expect(types.length).toBeGreaterThan(0)
      for (const type of types) {
        expect(typeof type).toBe('string')
      }
    })
  })

  describe('isValidBlockType', () => {
    it('should return true for valid block types', () => {
      expect(isValidBlockType('function')).toBe(true)
      expect(isValidBlockType('agent')).toBe(true)
      expect(isValidBlockType('condition')).toBe(true)
      expect(isValidBlockType('api')).toBe(true)
    })

    it('should return false for invalid block types', () => {
      expect(isValidBlockType('invalid-block')).toBe(false)
      expect(isValidBlockType('')).toBe(false)
    })

    it('should handle hyphenated versions of underscored types', () => {
      expect(isValidBlockType('microsoft-teams')).toBe(true)
      expect(isValidBlockType('google-calendar')).toBe(true)
    })
  })

  describe('Block Definitions', () => {
    describe('FunctionBlock', () => {
      const block = getBlock('function')

      it('should have correct metadata', () => {
        expect(block?.type).toBe('function')
        expect(block?.name).toBe('Function')
        expect(block?.category).toBe('blocks')
        expect(block?.bgColor).toBe('#FF402F')
      })

      it('should have language and code subBlocks', () => {
        expect(block?.subBlocks.length).toBeGreaterThanOrEqual(1)
        const languageSubBlock = block?.subBlocks.find((sb) => sb.id === 'language')
        const codeSubBlock = block?.subBlocks.find((sb) => sb.id === 'code')
        expect(codeSubBlock).toBeDefined()
        expect(codeSubBlock?.type).toBe('code')
      })

      it('should have function_execute tool access', () => {
        expect(block?.tools.access).toContain('function_execute')
      })

      it('should have code input', () => {
        expect(block?.inputs.code).toBeDefined()
        expect(block?.inputs.code.type).toBe('string')
      })

      it('should have result and stdout outputs', () => {
        expect(block?.outputs.result).toBeDefined()
        expect(block?.outputs.stdout).toBeDefined()
      })
    })

    describe('ConditionBlock', () => {
      const block = getBlock('condition')

      it('should have correct metadata', () => {
        expect(block?.type).toBe('condition')
        expect(block?.name).toBe('Condition')
        expect(block?.category).toBe('blocks')
        expect(block?.bgColor).toBe('#FF752F')
      })

      it('should have condition-input subBlock', () => {
        const conditionsSubBlock = block?.subBlocks.find((sb) => sb.id === 'conditions')
        expect(conditionsSubBlock).toBeDefined()
        expect(conditionsSubBlock?.type).toBe('condition-input')
      })

      it('should have empty tools access', () => {
        expect(block?.tools.access).toEqual([])
      })

      it('should have condition-related outputs', () => {
        expect(block?.outputs.conditionResult).toBeDefined()
        expect(block?.outputs.selectedPath).toBeDefined()
        expect(block?.outputs.selectedOption).toBeDefined()
      })
    })

    describe('ApiBlock', () => {
      const block = getBlock('api')

      it('should have correct metadata', () => {
        expect(block?.type).toBe('api')
        expect(block?.name).toBe('API')
        expect(block?.category).toBe('blocks')
        expect(block?.bgColor).toBe('#2F55FF')
      })

      it('should have required url subBlock', () => {
        const urlSubBlock = block?.subBlocks.find((sb) => sb.id === 'url')
        expect(urlSubBlock).toBeDefined()
        expect(urlSubBlock?.type).toBe('short-input')
        expect(urlSubBlock?.required).toBe(true)
      })

      it('should have method dropdown with HTTP methods', () => {
        const methodSubBlock = block?.subBlocks.find((sb) => sb.id === 'method')
        expect(methodSubBlock).toBeDefined()
        expect(methodSubBlock?.type).toBe('dropdown')
        expect(methodSubBlock?.required).toBe(true)
        const options = methodSubBlock?.options as Array<{ label: string; id: string }>
        expect(options?.map((o) => o.id)).toContain('GET')
        expect(options?.map((o) => o.id)).toContain('POST')
        expect(options?.map((o) => o.id)).toContain('PUT')
        expect(options?.map((o) => o.id)).toContain('DELETE')
        expect(options?.map((o) => o.id)).toContain('PATCH')
      })

      it('should have http_request tool access', () => {
        expect(block?.tools.access).toContain('http_request')
      })

      it('should have API-related inputs', () => {
        expect(block?.inputs.url).toBeDefined()
        expect(block?.inputs.method).toBeDefined()
        expect(block?.inputs.headers).toBeDefined()
        expect(block?.inputs.body).toBeDefined()
        expect(block?.inputs.params).toBeDefined()
      })

      it('should have API response outputs', () => {
        expect(block?.outputs.data).toBeDefined()
        expect(block?.outputs.status).toBeDefined()
        expect(block?.outputs.headers).toBeDefined()
      })
    })

    describe('ResponseBlock', () => {
      const block = getBlock('response')

      it('should have correct metadata', () => {
        expect(block?.type).toBe('response')
        expect(block?.name).toBe('Response')
        expect(block?.category).toBe('blocks')
      })

      it('should have dataMode dropdown with builder and editor options', () => {
        const dataModeSubBlock = block?.subBlocks.find((sb) => sb.id === 'dataMode')
        expect(dataModeSubBlock).toBeDefined()
        expect(dataModeSubBlock?.type).toBe('dropdown')
        const options = dataModeSubBlock?.options as Array<{ label: string; id: string }>
        expect(options?.map((o) => o.id)).toContain('structured')
        expect(options?.map((o) => o.id)).toContain('json')
      })

      it('should have conditional subBlocks based on dataMode', () => {
        const builderDataSubBlock = block?.subBlocks.find((sb) => sb.id === 'builderData')
        const dataSubBlock = block?.subBlocks.find((sb) => sb.id === 'data')

        expect(builderDataSubBlock?.condition).toEqual({ field: 'dataMode', value: 'structured' })
        expect(dataSubBlock?.condition).toEqual({ field: 'dataMode', value: 'json' })
      })

      it('should have empty tools access', () => {
        expect(block?.tools.access).toEqual([])
      })
    })

    describe('StarterBlock', () => {
      const block = getBlock('starter')

      it('should have correct metadata', () => {
        expect(block?.type).toBe('starter')
        expect(block?.name).toBe('Starter')
        expect(block?.category).toBe('blocks')
        expect(block?.hideFromToolbar).toBe(true)
      })

      it('should have startWorkflow dropdown', () => {
        const startWorkflowSubBlock = block?.subBlocks.find((sb) => sb.id === 'startWorkflow')
        expect(startWorkflowSubBlock).toBeDefined()
        expect(startWorkflowSubBlock?.type).toBe('dropdown')
        const options = startWorkflowSubBlock?.options as Array<{ label: string; id: string }>
        expect(options?.map((o) => o.id)).toContain('manual')
        expect(options?.map((o) => o.id)).toContain('chat')
      })

      it('should have empty outputs since it initiates workflow', () => {
        expect(Object.keys(block?.outputs || {}).length).toBe(0)
      })
    })

    describe('RouterBlock', () => {
      const block = getBlock('router')

      it('should have correct metadata', () => {
        expect(block?.type).toBe('router')
        expect(block?.name).toBe('Router (Legacy)')
        expect(block?.category).toBe('blocks')
        expect(block?.authMode).toBe(AuthMode.ApiKey)
      })

      it('should have required prompt subBlock', () => {
        const promptSubBlock = block?.subBlocks.find((sb) => sb.id === 'prompt')
        expect(promptSubBlock).toBeDefined()
        expect(promptSubBlock?.type).toBe('long-input')
        expect(promptSubBlock?.required).toBe(true)
      })

      it('should have model combobox with default value', () => {
        const modelSubBlock = block?.subBlocks.find((sb) => sb.id === 'model')
        expect(modelSubBlock).toBeDefined()
        expect(modelSubBlock?.type).toBe('combobox')
        expect(modelSubBlock?.required).toBe(true)
        expect(modelSubBlock?.defaultValue).toBe('claude-sonnet-4-5')
      })

      it('should have LLM tool access', () => {
        expect(block?.tools.access).toContain('openai_chat')
        expect(block?.tools.access).toContain('anthropic_chat')
        expect(block?.tools.access).toContain('google_chat')
      })

      it('should have tools.config with tool selector function', () => {
        expect(block?.tools.config).toBeDefined()
        expect(typeof block?.tools.config?.tool).toBe('function')
      })
    })
  })

  describe('SubBlock Validation', () => {
    it('should have non-empty ids for all subBlocks', () => {
      const blocks = getAllBlocks()
      for (const block of blocks) {
        for (const subBlock of block.subBlocks) {
          expect(subBlock.id).toBeDefined()
          expect(typeof subBlock.id).toBe('string')
          expect(subBlock.id.length).toBeGreaterThan(0)
        }
      }
    })

    it('should have valid subBlock types', () => {
      const validTypes = [
        'short-input',
        'long-input',
        'dropdown',
        'combobox',
        'slider',
        'table',
        'code',
        'switch',
        'tool-input',
        'checkbox-list',
        'grouped-checkbox-list',
        'condition-input',
        'eval-input',
        'time-input',
        'oauth-input',
        'webhook-config',
        'schedule-info',
        'file-selector',
        'sheet-selector',
        'project-selector',
        'channel-selector',
        'user-selector',
        'folder-selector',
        'knowledge-base-selector',
        'knowledge-tag-filters',
        'document-selector',
        'document-tag-entry',
        'mcp-server-selector',
        'mcp-tool-selector',
        'mcp-dynamic-args',
        'input-format',
        'response-format',
        'trigger-save',
        'file-upload',
        'input-mapping',
        'variables-input',
        'messages-input',
        'workflow-selector',
        'workflow-input-mapper',
        'text',
        'router-input',
        'skill-input',
      ]

      const blocks = getAllBlocks()
      for (const block of blocks) {
        for (const subBlock of block.subBlocks) {
          expect(validTypes).toContain(subBlock.type)
        }
      }
    })

    it('should have valid mode values for subBlocks', () => {
      const validModes = ['basic', 'advanced', 'both', 'trigger', undefined]
      const blocks = getAllBlocks()
      for (const block of blocks) {
        for (const subBlock of block.subBlocks) {
          expect(validModes).toContain(subBlock.mode)
        }
      }
    })
  })

  describe('Input/Output Validation', () => {
    it('should have valid input types', () => {
      const validTypes = ['string', 'number', 'boolean', 'json', 'array']
      const blocks = getAllBlocks()
      for (const block of blocks) {
        for (const [_, inputConfig] of Object.entries(block.inputs)) {
          expect(validTypes).toContain(inputConfig.type)
        }
      }
    })

    it('should have valid output types', () => {
      const validPrimitiveTypes = [
        'string',
        'number',
        'boolean',
        'json',
        'array',
        'file',
        'file[]',
        'any',
      ]
      const blocks = getAllBlocks()
      for (const block of blocks) {
        for (const [key, outputConfig] of Object.entries(block.outputs)) {
          if (key === 'visualization') continue
          if (typeof outputConfig === 'string') {
            expect(validPrimitiveTypes).toContain(outputConfig)
          } else if (typeof outputConfig === 'object' && outputConfig !== null) {
            if ('type' in outputConfig) {
              expect(validPrimitiveTypes).toContain(outputConfig.type)
            }
          }
        }
      }
    })
  })

  describe('AuthMode Validation', () => {
    it('should have valid authMode when defined', () => {
      const validAuthModes = [AuthMode.OAuth, AuthMode.ApiKey, AuthMode.BotToken, undefined]
      const blocks = getAllBlocks()
      for (const block of blocks) {
        expect(validAuthModes).toContain(block.authMode)
      }
    })
  })

  describe('Edge Cases', () => {
    it('should handle blocks with no inputs', () => {
      const conditionBlock = getBlock('condition')
      expect(conditionBlock?.inputs).toBeDefined()
      expect(Object.keys(conditionBlock?.inputs || {}).length).toBe(0)
    })

    it('should handle blocks with no outputs', () => {
      const starterBlock = getBlock('starter')
      expect(starterBlock?.outputs).toBeDefined()
      expect(Object.keys(starterBlock?.outputs || {}).length).toBe(0)
    })

    it('should handle blocks with no tool access', () => {
      const conditionBlock = getBlock('condition')
      expect(conditionBlock?.tools.access).toEqual([])
    })

    it('should handle blocks with multiple tool access', () => {
      const routerBlock = getBlock('router')
      expect(routerBlock?.tools.access.length).toBeGreaterThan(1)
    })

    it('should handle blocks with tools.config', () => {
      const routerBlock = getBlock('router')
      expect(routerBlock?.tools.config).toBeDefined()
      expect(typeof routerBlock?.tools.config?.tool).toBe('function')
    })

    it('should handle blocks with triggerAllowed flag', () => {
      const gmailBlock = getBlock('gmail')
      expect(gmailBlock?.triggerAllowed).toBe(true)

      const functionBlock = getBlock('function')
      expect(functionBlock?.triggerAllowed).toBeUndefined()
    })

    it('should handle blocks with hideFromToolbar flag', () => {
      const starterBlock = getBlock('starter')
      expect(starterBlock?.hideFromToolbar).toBe(true)

      const functionBlock = getBlock('function')
      expect(functionBlock?.hideFromToolbar).toBeUndefined()
    })

    it('should handle blocks with docsLink', () => {
      const functionBlock = getBlock('function')
      expect(functionBlock?.docsLink).toBe('https://docs.sim.ai/blocks/function')

      const apiBlock = getBlock('api')
      expect(apiBlock?.docsLink).toBe('https://docs.sim.ai/blocks/api')
    })
  })

  describe('generateRouterPrompt', () => {
    it('should generate a base prompt with routing instructions', () => {
      const prompt = generateRouterPrompt('Route to the correct agent')
      expect(prompt).toContain('You are an intelligent routing agent')
      expect(prompt).toContain('Route to the correct agent')
      expect(prompt).toContain('Response Format')
    })

    it('should include target blocks information when provided', () => {
      const targetBlocks = [
        {
          id: 'block-1',
          type: 'agent',
          title: 'Customer Support Agent',
          description: 'Handles customer inquiries',
          subBlocks: { systemPrompt: 'You are a helpful customer support agent.' },
        },
        {
          id: 'block-2',
          type: 'agent',
          title: 'Sales Agent',
          description: 'Handles sales inquiries',
          subBlocks: { systemPrompt: 'You are a sales agent.' },
        },
      ]

      const prompt = generateRouterPrompt('Route to the correct agent', targetBlocks)

      expect(prompt).toContain('Available Target Blocks')
      expect(prompt).toContain('block-1')
      expect(prompt).toContain('Customer Support Agent')
      expect(prompt).toContain('block-2')
      expect(prompt).toContain('Sales Agent')
    })

    it('should include current state when provided', () => {
      const targetBlocks = [
        {
          id: 'block-1',
          type: 'agent',
          title: 'Agent',
          currentState: { status: 'active', count: 5 },
        },
      ]

      const prompt = generateRouterPrompt('Route based on state', targetBlocks)

      expect(prompt).toContain('Current State')
      expect(prompt).toContain('active')
      expect(prompt).toContain('5')
    })

    it('should handle empty target blocks array', () => {
      const prompt = generateRouterPrompt('Route to agent', [])
      expect(prompt).toContain('You are an intelligent routing agent')
      expect(prompt).toContain('Route to agent')
    })

    it('should handle empty prompt string', () => {
      const prompt = generateRouterPrompt('')
      expect(prompt).toContain('You are an intelligent routing agent')
      expect(prompt).toContain('Routing Request:')
    })
  })

  describe('Block Category Counts', () => {
    it('should have more blocks in tools category than triggers', () => {
      const toolsBlocks = getBlocksByCategory('tools')
      const triggersBlocks = getBlocksByCategory('triggers')
      expect(toolsBlocks.length).toBeGreaterThan(triggersBlocks.length)
    })

    it('should have a reasonable total number of blocks', () => {
      const allBlocks = getAllBlocks()
      expect(allBlocks.length).toBeGreaterThan(50)
    })
  })

  describe('SubBlock Features', () => {
    it('should have wandConfig on code subBlocks where applicable', () => {
      const functionBlock = getBlock('function')
      const codeSubBlock = functionBlock?.subBlocks.find((sb) => sb.id === 'code')
      expect(codeSubBlock?.wandConfig).toBeDefined()
      expect(codeSubBlock?.wandConfig?.enabled).toBe(true)
      expect(codeSubBlock?.wandConfig?.prompt).toBeDefined()
    })

    it('should have correct slider configurations', () => {
      const routerBlock = getBlock('router')
      const temperatureSubBlock = routerBlock?.subBlocks.find((sb) => sb.id === 'temperature')
      expect(temperatureSubBlock?.type).toBe('slider')
      expect(temperatureSubBlock?.min).toBe(0)
      expect(temperatureSubBlock?.max).toBe(2)
    })
  })

  describe('Block Consistency', () => {
    it('should have consistent registry keys matching block types', () => {
      for (const [key, block] of Object.entries(registry)) {
        expect(key).toBe(block.type)
      }
    })

    it('should have non-empty descriptions for all blocks', () => {
      const blocks = getAllBlocks()
      for (const block of blocks) {
        expect(block.description.trim().length).toBeGreaterThan(0)
      }
    })

    it('should have non-empty names for all blocks', () => {
      const blocks = getAllBlocks()
      for (const block of blocks) {
        expect(block.name.trim().length).toBeGreaterThan(0)
      }
    })
  })

  describe('Canonical Param Validation', () => {
    /**
     * Helper to serialize a condition for comparison
     */
    function serializeCondition(condition: unknown): string {
      if (!condition) return ''
      return JSON.stringify(condition)
    }

    it('should not have canonicalParamId that matches any subBlock id within the same block', () => {
      const blocks = getAllBlocks()
      const errors: string[] = []

      for (const block of blocks) {
        const allSubBlockIds = new Set(block.subBlocks.map((sb) => sb.id))
        const canonicalParamIds = new Set(
          block.subBlocks.filter((sb) => sb.canonicalParamId).map((sb) => sb.canonicalParamId)
        )

        for (const canonicalId of canonicalParamIds) {
          if (allSubBlockIds.has(canonicalId!)) {
            // Check if the matching subBlock also has a canonicalParamId pointing to itself
            const matchingSubBlock = block.subBlocks.find(
              (sb) => sb.id === canonicalId && !sb.canonicalParamId
            )
            if (matchingSubBlock) {
              errors.push(
                `Block "${block.type}": canonicalParamId "${canonicalId}" clashes with subBlock id "${canonicalId}"`
              )
            }
          }
        }
      }

      if (errors.length > 0) {
        throw new Error(`Canonical param ID clashes detected:\n${errors.join('\n')}`)
      }
    })

    it('should have unique subBlock IDs within the same condition context', () => {
      const blocks = getAllBlocks()
      const errors: string[] = []

      for (const block of blocks) {
        // Group subBlocks by their condition (only for static/JSON conditions, not functions)
        const subBlocksByCondition = new Map<
          string,
          Array<{ id: string; mode?: string; hasCanonical: boolean }>
        >()

        for (const subBlock of block.subBlocks) {
          // Skip subBlocks with function conditions - we can't evaluate them statically
          // These are valid when the function returns different conditions at runtime
          if (typeof subBlock.condition === 'function') {
            continue
          }

          const conditionKey = serializeCondition(subBlock.condition)
          if (!subBlocksByCondition.has(conditionKey)) {
            subBlocksByCondition.set(conditionKey, [])
          }
          subBlocksByCondition.get(conditionKey)!.push({
            id: subBlock.id,
            mode: subBlock.mode,
            hasCanonical: Boolean(subBlock.canonicalParamId),
          })
        }

        // Check for duplicate IDs within the same condition (excluding canonical pairs and mode swaps)
        for (const [conditionKey, subBlocks] of subBlocksByCondition) {
          const idCounts = new Map<string, number>()
          for (const sb of subBlocks) {
            idCounts.set(sb.id, (idCounts.get(sb.id) || 0) + 1)
          }

          for (const [id, count] of idCounts) {
            if (count > 1) {
              const duplicates = subBlocks.filter((sb) => sb.id === id)

              // Categorize modes
              const basicModes = duplicates.filter(
                (sb) => !sb.mode || sb.mode === 'basic' || sb.mode === 'both'
              )
              const advancedModes = duplicates.filter((sb) => sb.mode === 'advanced')
              const triggerModes = duplicates.filter((sb) => sb.mode === 'trigger')

              // Valid pattern 1: basic/advanced mode swap (with or without canonicalParamId)
              if (
                basicModes.length === 1 &&
                advancedModes.length === 1 &&
                triggerModes.length === 0
              ) {
                continue // This is a valid basic/advanced mode swap pair
              }

              // Valid pattern 2: basic/trigger mode separation (trigger version for trigger mode)
              // One basic/both + one or more trigger versions is valid
              if (
                basicModes.length <= 1 &&
                advancedModes.length === 0 &&
                triggerModes.length >= 1
              ) {
                continue // This is a valid pattern where trigger mode has its own subBlock
              }

              // Valid pattern 3: All duplicates have canonicalParamId (they form a canonical group)
              const allHaveCanonical = duplicates.every((sb) => sb.hasCanonical)
              if (allHaveCanonical) {
                continue // Validated separately by canonical pair tests
              }

              // Invalid: duplicates without proper pairing
              const condition = conditionKey || '(no condition)'
              const modeBreakdown = duplicates.map((d) => d.mode || 'basic/both').join(', ')
              errors.push(
                `Block "${block.type}": Duplicate subBlock id "${id}" with condition ${condition} (count: ${count}, modes: ${modeBreakdown})`
              )
            }
          }
        }
      }

      if (errors.length > 0) {
        throw new Error(`Duplicate subBlock IDs detected:\n${errors.join('\n')}`)
      }
    })

    it('should have properly formed canonical pairs (matching conditions)', () => {
      const blocks = getAllBlocks()
      const errors: string[] = []

      for (const block of blocks) {
        // Group subBlocks by canonicalParamId
        const canonicalGroups = new Map<
          string,
          Array<{ id: string; mode?: string; condition: unknown; isStaticCondition: boolean }>
        >()

        for (const subBlock of block.subBlocks) {
          if (subBlock.canonicalParamId) {
            if (!canonicalGroups.has(subBlock.canonicalParamId)) {
              canonicalGroups.set(subBlock.canonicalParamId, [])
            }
            canonicalGroups.get(subBlock.canonicalParamId)!.push({
              id: subBlock.id,
              mode: subBlock.mode,
              condition: subBlock.condition,
              isStaticCondition: typeof subBlock.condition !== 'function',
            })
          }
        }

        // Validate each canonical group
        for (const [canonicalId, members] of canonicalGroups) {
          // Only validate condition matching for static conditions
          const staticMembers = members.filter((m) => m.isStaticCondition)
          if (staticMembers.length > 1) {
            const conditions = staticMembers.map((m) => serializeCondition(m.condition))
            const uniqueConditions = new Set(conditions)

            if (uniqueConditions.size > 1) {
              errors.push(
                `Block "${block.type}": Canonical param "${canonicalId}" has members with different conditions: ${[...uniqueConditions].join(' vs ')}`
              )
            }
          }

          // Check for proper basic/advanced pairing
          const basicMembers = members.filter((m) => !m.mode || m.mode === 'basic')
          const advancedMembers = members.filter((m) => m.mode === 'advanced')

          if (basicMembers.length > 1) {
            errors.push(
              `Block "${block.type}": Canonical param "${canonicalId}" has ${basicMembers.length} basic mode members (should have at most 1)`
            )
          }

          if (basicMembers.length === 0 && advancedMembers.length === 0) {
            errors.push(
              `Block "${block.type}": Canonical param "${canonicalId}" has no basic or advanced mode members`
            )
          }
        }
      }

      if (errors.length > 0) {
        throw new Error(`Canonical pair validation errors:\n${errors.join('\n')}`)
      }
    })

    it('should have unique canonicalParamIds per operation/condition context', () => {
      const blocks = getAllBlocks()
      const errors: string[] = []

      for (const block of blocks) {
        // Group by condition + canonicalParamId to detect same canonical used for different operations
        const canonicalByCondition = new Map<string, Set<string>>()

        for (const subBlock of block.subBlocks) {
          if (subBlock.canonicalParamId) {
            // Skip function conditions - we can't evaluate them statically
            if (typeof subBlock.condition === 'function') {
              continue
            }
            const conditionKey = serializeCondition(subBlock.condition)
            if (!canonicalByCondition.has(subBlock.canonicalParamId)) {
              canonicalByCondition.set(subBlock.canonicalParamId, new Set())
            }
            canonicalByCondition.get(subBlock.canonicalParamId)!.add(conditionKey)
          }
        }

        // Check that each canonicalParamId is only used for one condition
        for (const [canonicalId, conditions] of canonicalByCondition) {
          if (conditions.size > 1) {
            errors.push(
              `Block "${block.type}": Canonical param "${canonicalId}" is used across ${conditions.size} different conditions. Each operation should have its own unique canonicalParamId.`
            )
          }
        }
      }

      if (errors.length > 0) {
        throw new Error(`Canonical param reuse across conditions:\n${errors.join('\n')}`)
      }
    })

    it('should have inputs containing canonical param IDs instead of raw subBlock IDs', () => {
      const blocks = getAllBlocks()
      const errors: string[] = []

      for (const block of blocks) {
        if (!block.inputs) continue

        // Find all canonical groups (subBlocks with canonicalParamId)
        const canonicalGroups = new Map<string, string[]>()
        for (const subBlock of block.subBlocks) {
          if (subBlock.canonicalParamId) {
            if (!canonicalGroups.has(subBlock.canonicalParamId)) {
              canonicalGroups.set(subBlock.canonicalParamId, [])
            }
            canonicalGroups.get(subBlock.canonicalParamId)!.push(subBlock.id)
          }
        }

        const inputKeys = Object.keys(block.inputs)

        for (const [canonicalId, rawSubBlockIds] of canonicalGroups) {
          // Check that the canonical param ID is in inputs
          if (!inputKeys.includes(canonicalId)) {
            errors.push(
              `Block "${block.type}": inputs section is missing canonical param "${canonicalId}"`
            )
          }

          // Check that raw subBlock IDs are NOT in inputs (they get deleted after transformation)
          for (const rawId of rawSubBlockIds) {
            if (rawId !== canonicalId && inputKeys.includes(rawId)) {
              errors.push(
                `Block "${block.type}": inputs section contains raw subBlock id "${rawId}" which should be replaced by canonical param "${canonicalId}"`
              )
            }
          }
        }
      }

      if (errors.length > 0) {
        throw new Error(`Inputs section validation errors:\n${errors.join('\n')}`)
      }
    })

    it('should have params function using canonical IDs instead of raw subBlock IDs', () => {
      const blocks = getAllBlocks()
      const errors: string[] = []

      for (const block of blocks) {
        // Check if block has a params function
        const paramsFunc = block.tools?.config?.params
        if (!paramsFunc || typeof paramsFunc !== 'function') continue

        // Get the function source code, stripping comments to avoid false positives
        const rawFuncSource = paramsFunc.toString()
        // Remove single-line comments (// ...) and multi-line comments (/* ... */)
        const funcSource = rawFuncSource
          .replace(/\/\/[^\n]*/g, '') // Remove single-line comments
          .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments

        // Find all canonical groups (subBlocks with canonicalParamId)
        const canonicalGroups = new Map<string, string[]>()
        for (const subBlock of block.subBlocks) {
          if (subBlock.canonicalParamId) {
            if (!canonicalGroups.has(subBlock.canonicalParamId)) {
              canonicalGroups.set(subBlock.canonicalParamId, [])
            }
            canonicalGroups.get(subBlock.canonicalParamId)!.push(subBlock.id)
          }
        }

        // Check for raw subBlock IDs being used in the params function
        for (const [canonicalId, rawSubBlockIds] of canonicalGroups) {
          for (const rawId of rawSubBlockIds) {
            // Skip if the rawId is the same as the canonicalId (self-referential, which is allowed in some cases)
            if (rawId === canonicalId) continue

            // Check if the params function references the raw subBlock ID
            // Look for patterns like: params.rawId, { rawId }, destructuring rawId
            const patterns = [
              new RegExp(`params\\.${rawId}\\b`), // params.rawId
              new RegExp(`\\{[^}]*\\b${rawId}\\b[^}]*\\}\\s*=\\s*params`), // { rawId } = params
              new RegExp(`\\b${rawId}\\s*[,}]`), // rawId in destructuring
            ]

            for (const pattern of patterns) {
              if (pattern.test(funcSource)) {
                errors.push(
                  `Block "${block.type}": params function references raw subBlock id "${rawId}" which is deleted after canonical transformation. Use canonical param "${canonicalId}" instead.`
                )
                break
              }
            }
          }
        }
      }

      if (errors.length > 0) {
        throw new Error(`Params function validation errors:\n${errors.join('\n')}`)
      }
    })

    it('should have consistent required status across canonical param groups', () => {
      const blocks = getAllBlocks()
      const errors: string[] = []

      for (const block of blocks) {
        // Find all canonical groups (subBlocks with canonicalParamId)
        const canonicalGroups = new Map<string, typeof block.subBlocks>()
        for (const subBlock of block.subBlocks) {
          if (subBlock.canonicalParamId) {
            if (!canonicalGroups.has(subBlock.canonicalParamId)) {
              canonicalGroups.set(subBlock.canonicalParamId, [])
            }
            canonicalGroups.get(subBlock.canonicalParamId)!.push(subBlock)
          }
        }

        // For each canonical group, check that required status is consistent
        for (const [canonicalId, subBlocks] of canonicalGroups) {
          if (subBlocks.length < 2) continue // Single subblock, no consistency check needed

          // Get required status for each subblock (handling both boolean and condition object)
          const requiredStatuses = subBlocks.map((sb) => {
            // If required is a condition object or function, we can't statically determine it
            // so we skip those cases
            if (typeof sb.required === 'object' || typeof sb.required === 'function') {
              return 'dynamic'
            }
            return sb.required === true ? 'required' : 'optional'
          })

          // Filter out dynamic cases
          const staticStatuses = requiredStatuses.filter((s) => s !== 'dynamic')
          if (staticStatuses.length < 2) continue // Not enough static statuses to compare

          // Check if all static statuses are the same
          const hasRequired = staticStatuses.includes('required')
          const hasOptional = staticStatuses.includes('optional')

          if (hasRequired && hasOptional) {
            const requiredSubBlocks = subBlocks
              .filter((sb, i) => requiredStatuses[i] === 'required')
              .map((sb) => `${sb.id} (${sb.mode || 'both'})`)
            const optionalSubBlocks = subBlocks
              .filter((sb, i) => requiredStatuses[i] === 'optional')
              .map((sb) => `${sb.id} (${sb.mode || 'both'})`)

            errors.push(
              `Block "${block.type}": canonical param "${canonicalId}" has inconsistent required status. ` +
                `Required: [${requiredSubBlocks.join(', ')}], Optional: [${optionalSubBlocks.join(', ')}]. ` +
                `All subBlocks in a canonical group should have the same required status.`
            )
          }
        }
      }

      if (errors.length > 0) {
        throw new Error(`Required status consistency errors:\n${errors.join('\n')}`)
      }
    })
  })
})
