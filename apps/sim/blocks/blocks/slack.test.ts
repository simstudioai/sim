/**
 * Tests for Slack Block configuration
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { SlackBlock } from './slack'

describe('SlackBlock', () => {
  describe('basic configuration', () => {
    it('should have correct type and name', () => {
      expect(SlackBlock.type).toBe('slack')
      expect(SlackBlock.name).toBe('Slack')
    })

    it('should have slack_add_reaction in tools access', () => {
      expect(SlackBlock.tools.access).toContain('slack_add_reaction')
    })

    it('should have tools.config.tool function', () => {
      expect(typeof SlackBlock.tools.config?.tool).toBe('function')
    })

    it('should have tools.config.params function', () => {
      expect(typeof SlackBlock.tools.config?.params).toBe('function')
    })
  })

  describe('tools.config.tool', () => {
    const getToolName = SlackBlock.tools.config?.tool

    it('should return slack_add_reaction for react operation', () => {
      expect(getToolName?.({ operation: 'react' })).toBe('slack_add_reaction')
    })

    it('should return slack_message for send operation', () => {
      expect(getToolName?.({ operation: 'send' })).toBe('slack_message')
    })

    it('should return slack_delete_message for delete operation', () => {
      expect(getToolName?.({ operation: 'delete' })).toBe('slack_delete_message')
    })

    it('should return slack_update_message for update operation', () => {
      expect(getToolName?.({ operation: 'update' })).toBe('slack_update_message')
    })
  })

  describe('tools.config.params for react operation', () => {
    const getParams = SlackBlock.tools.config?.params

    it('should map reaction params correctly with OAuth auth', () => {
      const inputParams = {
        operation: 'react',
        authMethod: 'oauth',
        credential: 'oauth-credential-123',
        channel: 'C1234567890',
        reactionTimestamp: '1405894322.002768',
        emojiName: 'thumbsup',
      }

      const result = getParams?.(inputParams)

      expect(result).toEqual({
        credential: 'oauth-credential-123',
        channel: 'C1234567890',
        timestamp: '1405894322.002768',
        name: 'thumbsup',
      })
    })

    it('should map reaction params correctly with bot token auth', () => {
      const inputParams = {
        operation: 'react',
        authMethod: 'bot_token',
        botToken: 'xoxb-test-token',
        channel: 'C1234567890',
        reactionTimestamp: '1405894322.002768',
        emojiName: 'eyes',
      }

      const result = getParams?.(inputParams)

      expect(result).toEqual({
        accessToken: 'xoxb-test-token',
        channel: 'C1234567890',
        timestamp: '1405894322.002768',
        name: 'eyes',
      })
    })

    it('should handle various emoji names', () => {
      const emojiNames = ['heart', 'fire', 'rocket', '+1', '-1', 'tada', 'thinking_face']

      for (const emoji of emojiNames) {
        const inputParams = {
          operation: 'react',
          authMethod: 'bot_token',
          botToken: 'xoxb-test-token',
          channel: 'C1234567890',
          reactionTimestamp: '1405894322.002768',
          emojiName: emoji,
        }

        const result = getParams?.(inputParams)

        expect(result?.name).toBe(emoji)
      }
    })

    it('should handle channel from trigger data', () => {
      const inputParams = {
        operation: 'react',
        authMethod: 'bot_token',
        botToken: 'xoxb-test-token',
        channel: 'C9876543210',
        reactionTimestamp: '1234567890.123456',
        emojiName: 'white_check_mark',
      }

      const result = getParams?.(inputParams)

      expect(result?.channel).toBe('C9876543210')
      expect(result?.timestamp).toBe('1234567890.123456')
    })

    it('should trim whitespace from channel', () => {
      const inputParams = {
        operation: 'react',
        authMethod: 'bot_token',
        botToken: 'xoxb-test-token',
        channel: '  C1234567890  ',
        reactionTimestamp: '1405894322.002768',
        emojiName: 'thumbsup',
      }

      const result = getParams?.(inputParams)

      expect(result?.channel).toBe('C1234567890')
    })
  })

  describe('subBlocks for react operation', () => {
    it('should have reactionTimestamp subBlock with correct condition', () => {
      const reactionTimestampSubBlock = SlackBlock.subBlocks.find(
        (sb) => sb.id === 'reactionTimestamp'
      )

      expect(reactionTimestampSubBlock).toBeDefined()
      expect(reactionTimestampSubBlock?.type).toBe('short-input')
      expect(reactionTimestampSubBlock?.required).toBe(true)
      expect(reactionTimestampSubBlock?.condition).toEqual({
        field: 'operation',
        value: 'react',
      })
    })

    it('should have emojiName subBlock with correct condition', () => {
      const emojiNameSubBlock = SlackBlock.subBlocks.find((sb) => sb.id === 'emojiName')

      expect(emojiNameSubBlock).toBeDefined()
      expect(emojiNameSubBlock?.type).toBe('short-input')
      expect(emojiNameSubBlock?.required).toBe(true)
      expect(emojiNameSubBlock?.condition).toEqual({
        field: 'operation',
        value: 'react',
      })
    })

    it('should have channel subBlock that shows for react operation', () => {
      const channelSubBlock = SlackBlock.subBlocks.find((sb) => sb.id === 'channel')

      expect(channelSubBlock).toBeDefined()

      const condition = channelSubBlock?.condition as {
        field: string
        value: string[]
        not: boolean
        and: { field: string; value: string; not: boolean }
      }

      expect(condition.field).toBe('operation')
      expect(condition.value).not.toContain('react')
      expect(condition.not).toBe(true)
    })
  })

  describe('inputs configuration', () => {
    it('should have timestamp input for reaction', () => {
      expect(SlackBlock.inputs.timestamp).toBeDefined()
      expect(SlackBlock.inputs.timestamp.type).toBe('string')
    })

    it('should have name input for emoji', () => {
      expect(SlackBlock.inputs.name).toBeDefined()
      expect(SlackBlock.inputs.name.type).toBe('string')
    })

    it('should have reactionTimestamp input', () => {
      expect(SlackBlock.inputs.reactionTimestamp).toBeDefined()
      expect(SlackBlock.inputs.reactionTimestamp.type).toBe('string')
    })

    it('should have emojiName input', () => {
      expect(SlackBlock.inputs.emojiName).toBeDefined()
      expect(SlackBlock.inputs.emojiName.type).toBe('string')
    })
  })

  describe('operation dropdown', () => {
    it('should include Add Reaction option', () => {
      const operationSubBlock = SlackBlock.subBlocks.find((sb) => sb.id === 'operation')
      expect(operationSubBlock?.type).toBe('dropdown')

      const options = operationSubBlock?.options as Array<{ label: string; id: string }>
      const reactOption = options?.find((opt) => opt.id === 'react')

      expect(reactOption).toBeDefined()
      expect(reactOption?.label).toBe('Add Reaction')
    })
  })
})
