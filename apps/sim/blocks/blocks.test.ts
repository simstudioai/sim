import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')

import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import { getAllBlocks, getBlock } from '@/blocks/registry'

describe.concurrent('Blocks Module', () => {
  describe('Agent block', () => {
    it('should expose canonical file attachments and normalize file params', () => {
      const block = getBlock('agent')

      expect(block).toBeDefined()
      const uploadSubBlock = block?.subBlocks.find((subBlock) => subBlock.id === 'attachmentFiles')
      const advancedSubBlock = block?.subBlocks.find((subBlock) => subBlock.id === 'files')

      expect(uploadSubBlock?.type).toBe('file-upload')
      expect(uploadSubBlock?.canonicalParamId).toBe('files')
      expect(uploadSubBlock?.multiple).toBe(true)
      expect(advancedSubBlock?.canonicalParamId).toBe('files')
      expect(block?.inputs.files).toEqual({
        type: 'array',
        description: 'Files to include with the latest user message',
      })

      expect(
        block?.tools.config?.params?.({
          model: 'gpt-4o',
          files:
            '[{"id":"file-1","key":"workspace/ws-1/example.png","name":"example.png","url":"/api/files/serve/workspace%2Fws-1%2Fexample.png?context=workspace","size":123,"type":"image/png"}]',
        })
      ).toMatchObject({
        files: [
          {
            id: 'file-1',
            key: 'workspace/ws-1/example.png',
            name: 'example.png',
            type: 'image/png',
          },
        ],
      })
    })
  })

  describe('SubBlock Features', () => {
    it('should default an embeddings block saved before the provider field existed to openai', () => {
      const block = getBlock('embeddings')

      // Serialization runs before variable resolution, so an absent provider
      // must still resolve to the original OpenAI tool.
      expect(block?.tools.config?.tool?.({})).toBe('embeddings_openai')
      expect(block?.tools.config?.tool?.({ provider: 'gemini' })).toBe('embeddings_gemini')
    })

    /** Each model-tuning field with a model that accepts it and one that does not. */
    const AGENT_MODEL_LEVEL_FIELDS = [
      { id: 'reasoningEffort', capable: 'gpt-5.1', incapable: 'claude-sonnet-5' },
      { id: 'verbosity', capable: 'gpt-5.1', incapable: 'claude-sonnet-5' },
      { id: 'thinkingLevel', capable: 'claude-sonnet-5', incapable: 'gpt-5.1' },
    ] as const

    it('should keep the agent model-tuning fields visible when the model is a reference', () => {
      const agentBlock = getBlock('agent')

      for (const { id, capable, incapable } of AGENT_MODEL_LEVEL_FIELDS) {
        const subBlock = agentBlock?.subBlocks.find((sb) => sb.id === id)
        const condition = subBlock?.condition
        if (typeof condition !== 'function') throw new Error(`${id} condition is not a function`)

        expect(evaluateSubBlockCondition(condition, { model: '<start.model>' })).toBe(true)
        expect(evaluateSubBlockCondition(condition, { model: '{{MODEL_ID}}' })).toBe(true)
        // Gating on the capability list is unchanged for a literal model.
        expect(evaluateSubBlockCondition(condition, { model: capable })).toBe(true)
        expect(evaluateSubBlockCondition(condition, { model: incapable })).toBe(false)
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
        // Exclude trigger-mode subBlocks — they operate in a separate rendering context
        // and their IDs don't participate in canonical param resolution
        const nonTriggerSubBlocks = block.subBlocks.filter(
          (sb) => sb.mode !== 'trigger' && sb.mode !== 'trigger-advanced'
        )
        const allSubBlockIds = new Set(nonTriggerSubBlocks.map((sb) => sb.id))
        const canonicalParamIds = new Set(
          nonTriggerSubBlocks.filter((sb) => sb.canonicalParamId).map((sb) => sb.canonicalParamId)
        )

        for (const canonicalId of canonicalParamIds) {
          if (allSubBlockIds.has(canonicalId!)) {
            // Check if the matching subBlock also has a canonicalParamId pointing to itself
            const matchingSubBlock = nonTriggerSubBlocks.find(
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
          // Skip trigger-mode subBlocks — they operate in a separate rendering context
          if (subBlock.mode === 'trigger' || subBlock.mode === 'trigger-advanced') continue
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
            // Skip trigger-mode subBlocks — they operate in a separate rendering context
            if (subBlock.mode === 'trigger' || subBlock.mode === 'trigger-advanced') {
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
        // Skip trigger-mode subBlocks — they operate in a separate rendering context
        // and are not wired to the block's inputs section
        const canonicalGroups = new Map<string, string[]>()
        for (const subBlock of block.subBlocks) {
          if (subBlock.mode === 'trigger' || subBlock.mode === 'trigger-advanced') continue
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
        // Skip trigger-mode subBlocks — they are not passed through params function
        const canonicalGroups = new Map<string, string[]>()
        for (const subBlock of block.subBlocks) {
          if (subBlock.mode === 'trigger' || subBlock.mode === 'trigger-advanced') continue
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
        // Skip trigger-mode subBlocks — they operate in a separate rendering context
        // and may have different required semantics from their block counterparts
        const canonicalGroups = new Map<string, typeof block.subBlocks>()
        for (const subBlock of block.subBlocks) {
          if (subBlock.mode === 'trigger' || subBlock.mode === 'trigger-advanced') continue
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
