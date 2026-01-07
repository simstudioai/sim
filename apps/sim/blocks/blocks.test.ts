import { describe, expect, it, vi } from 'vitest'

// Use the real registry module, not the global mock from vitest.setup.ts
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

describe('Blocks Module', () => {
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
      const validPrimitiveTypes = ['string', 'number', 'boolean', 'json', 'array', 'files', 'any']
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
})
