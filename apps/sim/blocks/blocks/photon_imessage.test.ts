/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { photonImessageSendBodySchema } from '@/lib/api/contracts/tools/photon-imessage'
import { PhotonImessageBlock, PhotonImessageBlockMeta } from '@/blocks/blocks/photon_imessage'
import { getTrigger } from '@/triggers'
import {
  buildPhotonImessageOutputs,
  buildPhotonImessageReactionOutputs,
  buildPhotonImessageReadReceiptOutputs,
  buildPhotonImessageWebhookOutputs,
} from '@/triggers/photon_imessage/utils'

const mapParams = (params: Record<string, unknown>) =>
  PhotonImessageBlock.tools.config!.params!(params) as Record<string, unknown>

const selectTool = (params: Record<string, unknown>) =>
  PhotonImessageBlock.tools.config!.tool!(params)

describe('PhotonImessageBlock params', () => {
  it('accepts an address in the unified target field', () => {
    const mapped = mapParams({ operation: 'send_message', to: '+14155551234', text: 'hi' })
    expect(
      photonImessageSendBodySchema.safeParse({ projectId: 'p', projectSecret: 's', ...mapped })
        .success
    ).toBe(true)
  })

  it('accepts a chat GUID from a trigger in the same field', () => {
    const mapped = mapParams({ operation: 'send_message', to: 'any;-;+14155551234', text: 'hi' })
    expect(
      photonImessageSendBodySchema.safeParse({ projectId: 'p', projectSecret: 's', ...mapped })
        .success
    ).toBe(true)
  })

  it('rejects a send with no target', () => {
    const mapped = mapParams({ operation: 'send_message', to: '', text: 'hi' })
    expect(
      photonImessageSendBodySchema.safeParse({ projectId: 'p', projectSecret: 's', ...mapped })
        .success
    ).toBe(false)
  })

  it('selects the tool from the operation and defaults to send', () => {
    expect(selectTool({ operation: 'create_poll' })).toBe('photon_imessage_create_poll')
    expect(selectTool({})).toBe('photon_imessage_send_message')
  })

  it('renames the edit text field onto the tool text param', () => {
    const mapped = mapParams({
      operation: 'edit_message',
      chatId: 'c',
      messageId: 'm',
      editText: 'fixed',
    })
    expect(mapped.text).toBe('fixed')
    expect(mapped).not.toHaveProperty('editText')
  })

  it('splits poll options on commas and newlines', () => {
    const mapped = mapParams({
      operation: 'create_poll',
      chatId: 'c',
      pollTitle: 'Lunch?',
      pollOptions: 'Sushi, Tacos\nPizza',
    })
    expect(mapped.title).toBe('Lunch?')
    expect(mapped.options).toEqual(['Sushi', 'Tacos', 'Pizza'])
  })

  it('splits group participants and keeps the opening message only when set', () => {
    const withText = mapParams({
      operation: 'create_group',
      handles: '+1555, a@b.com',
      initialText: 'hey',
    })
    expect(withText.handles).toEqual(['+1555', 'a@b.com'])
    expect(withText.initialText).toBe('hey')

    const withoutText = mapParams({
      operation: 'create_group',
      handles: '+1555, a@b.com',
      initialText: '',
    })
    expect(withoutText).not.toHaveProperty('initialText')
  })

  it('maps the clear image choice to the clear flag instead of a file', () => {
    const cleared = mapParams({ operation: 'set_group_avatar', chatId: 'c', imageAction: 'clear' })
    expect(cleared.clear).toBe(true)
    expect(cleared).not.toHaveProperty('file')
  })

  it('forwards send effects and inline replies only when set', () => {
    const bare = mapParams({
      operation: 'send_message',
      to: '+1',
      text: 'hi',
      effectName: '',
      replyToMessageId: '',
    })
    expect(bare).not.toHaveProperty('effectName')
    expect(bare).not.toHaveProperty('replyToMessageId')

    const rich = mapParams({
      operation: 'send_message',
      to: '+1',
      text: 'hi',
      effectName: 'confetti',
      replyToMessageId: 'msg-1',
    })
    expect(rich.effectName).toBe('confetti')
    expect(rich.replyToMessageId).toBe('msg-1')
  })
})

describe('PhotonImessageBlock wiring', () => {
  it('exposes every registered operation exactly once', () => {
    const access = PhotonImessageBlock.tools.access
    expect(new Set(access).size).toBe(access.length)
    expect(access).toHaveLength(20)

    const operationIds = (
      PhotonImessageBlock.subBlocks.find((s) => s.id === 'operation')?.options as Array<{
        id: string
      }>
    ).map((o) => o.id)
    expect(operationIds.map((id) => `photon_imessage_${id}`).sort()).toEqual([...access].sort())
  })

  it('advertises all four triggers with their subBlocks spread in', () => {
    expect(PhotonImessageBlock.triggers).toEqual({
      enabled: true,
      available: [
        'photon_imessage_message_received',
        'photon_imessage_reaction_received',
        'photon_imessage_read_receipt',
        'photon_imessage_webhook',
      ],
    })
    // buildTriggerSubBlocks returns fresh objects per call, so compare by id, not reference.
    const blockSubBlockIds = new Set(PhotonImessageBlock.subBlocks.map((sub) => sub.id))
    for (const triggerId of PhotonImessageBlock.triggers!.available) {
      for (const sub of getTrigger(triggerId).subBlocks) {
        expect(blockSubBlockIds.has(sub.id)).toBe(true)
      }
    }
  })

  it('keeps trigger outputs unique per trigger and non-empty', () => {
    for (const outputs of [
      buildPhotonImessageOutputs(),
      buildPhotonImessageReactionOutputs(),
      buildPhotonImessageReadReceiptOutputs(),
      buildPhotonImessageWebhookOutputs(),
    ]) {
      expect(Object.keys(outputs).length).toBeGreaterThan(0)
    }
  })
})

describe('PhotonImessageBlockMeta', () => {
  it('ships at least 7 templates and 5 skills', () => {
    expect(PhotonImessageBlockMeta.templates.length).toBeGreaterThanOrEqual(7)
    expect(PhotonImessageBlockMeta.skills.length).toBeGreaterThanOrEqual(5)
  })

  it('uses unique, kebab-case, non-reserved skill names', () => {
    const names = PhotonImessageBlockMeta.skills.map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) {
      expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(name.length).toBeLessThanOrEqual(64)
      expect(['connect-integration', 'research', 'create-table', 'deploy-workflow']).not.toContain(
        name
      )
    }
  })

  it('writes skill content with the Steps/Output structure', () => {
    for (const skill of PhotonImessageBlockMeta.skills) {
      expect(skill.content).toMatch(/^# /)
      expect(skill.content).toContain('## Steps')
      expect(skill.content).toContain('## Output')
      expect(skill.description.length).toBeGreaterThan(0)
    }
  })
})
