/**
 * The frozen-names rules: names only ever get added, collisions resolve deterministically, and the
 * check reports every collision or gap. The whole-registry coverage runs as `check:sdk-names`.
 */
import { describe, expect, it } from 'vitest'
import {
  extendSdkNames,
  type SdkNameSource,
  type SdkNamesFile,
  validateSdkNames,
} from '@/lib/workflows/code/catalog/sdk-names'

const EMPTY: SdkNamesFile = { version: 1, blocks: {} }

function source(overrides: Partial<SdkNameSource> & { type: string }): SdkNameSource {
  return {
    hidden: false,
    triggerBlock: false,
    operations: [],
    triggers: [],
    params: { action: [], trigger: [] },
    ...overrides,
  }
}

const param = (name: string, pair = false) => ({
  name,
  identity: pair ? `pair:${name}` : `id:${name}`,
})

describe('extendSdkNames', () => {
  it('never renames an existing method when its option label changes', () => {
    const v1 = source({ type: 'slack_v2', operations: [{ id: 'send', label: 'Send Message' }] })
    const first = extendSdkNames(EMPTY, [v1]).names
    const relabelled = source({ type: 'slack_v2', operations: [{ id: 'send', label: 'Post' }] })
    const second = extendSdkNames(first, [relabelled])
    expect(second.names.blocks.slack_v2.methods).toEqual({ send: 'sendMessage' })
    expect(second.added).toEqual([])
  })

  it('gives a new operation whose label collides a distinct method, keeping the old one', () => {
    const first = extendSdkNames(EMPTY, [
      source({ type: 'crm', operations: [{ id: 'get_contact', label: 'Get Contact' }] }),
    ]).names
    const { names } = extendSdkNames(first, [
      source({
        type: 'crm',
        operations: [
          { id: 'get_contact', label: 'Get Contact' },
          { id: 'get_contact_v2', label: 'Get Contact' },
        ],
      }),
    ])
    expect(names.blocks.crm.methods).toEqual({
      get_contact: 'getContact',
      get_contact_v2: 'getContactV2',
    })
    expect(validateSdkNames(names, [])).toEqual([])
  })

  it('suffixes a reserved-word method and never takes the namespace member `tool`', () => {
    const { names } = extendSdkNames(EMPTY, [
      source({
        type: 'kv',
        operations: [
          { id: 'delete', label: 'Delete' },
          { id: 'tool', label: 'Tool' },
        ],
      }),
    ])
    expect(names.blocks.kv.methods).toEqual({ delete: 'delete_', tool: 'tool2' })
  })

  it('namespaces visible blocks by unversioned type, hidden ones under legacy, and avoids SDK roots', () => {
    const { names } = extendSdkNames(EMPTY, [
      source({ type: 'gmail', hidden: true }),
      source({ type: 'gmail_v2' }),
      source({ type: 'env' }),
      source({ type: 'condition' }),
    ])
    expect(names.blocks.gmail_v2.namespace).toBe('gmail')
    expect(names.blocks.gmail.namespace).toBe('legacy.gmail')
    expect(names.blocks.env.namespace).toBe('envBlock')
    expect(names.blocks.condition.namespace).toBe('condition')
  })

  it('names visible trigger blocks under trigger, and hidden ones under legacy', () => {
    const { names } = extendSdkNames(EMPTY, [
      source({ type: 'start_trigger', triggerBlock: true }),
      source({ type: 'generic_webhook', triggerBlock: true }),
      source({ type: 'schedule', triggerBlock: true }),
      source({ type: 'api_trigger', triggerBlock: true, hidden: true }),
    ])
    expect(names.blocks.start_trigger.namespace).toBe('trigger.start')
    expect(names.blocks.generic_webhook.namespace).toBe('trigger.webhook')
    expect(names.blocks.schedule.namespace).toBe('trigger.schedule')
    expect(names.blocks.api_trigger.namespace).toBe('legacy.apiTrigger')
  })

  it('aliases oauthCredential to credential per surface, unless that surface has a credential', () => {
    const { names } = extendSdkNames(EMPTY, [
      source({
        type: 'drive',
        params: {
          action: [param('oauthCredential', true)],
          trigger: [param('triggerCredentials')],
        },
      }),
      source({
        type: 'mixed',
        params: { action: [param('oauthCredential', true), param('credential')], trigger: [] },
      }),
    ])
    expect(names.blocks.drive.paramAliases).toEqual({
      action: { oauthCredential: 'credential' },
      trigger: { triggerCredentials: 'credential' },
    })
    expect(names.blocks.mixed.paramAliases).toBeUndefined()
  })
})

describe('validateSdkNames', () => {
  it('reports a credential alias the generator would add, as it reports a missing method', () => {
    const drive = source({
      type: 'drive',
      operations: [{ id: 'list', label: 'List' }],
      params: { action: [param('oauthCredential', true)], trigger: [] },
    })
    const { names } = extendSdkNames(EMPTY, [drive])
    expect(validateSdkNames(names, [drive])).toEqual([])

    const { paramAliases: _dropped, ...withoutAlias } = names.blocks.drive
    expect(validateSdkNames({ version: 1, blocks: { drive: withoutAlias } }, [drive])).toEqual([
      'missing drive: action param oauthCredential → credential',
    ])

    const { methods: _methods, ...withoutMethod } = names.blocks.drive
    expect(validateSdkNames({ version: 1, blocks: { drive: withoutMethod } }, [drive])).toEqual([
      'missing drive: method list → list',
    ])
  })

  it('reports a block, operation or trigger the file lacks', () => {
    const names: SdkNamesFile = {
      version: 1,
      blocks: { crm: { namespace: 'crm', methods: { a: 'a' } } },
    }
    expect(
      validateSdkNames(names, [
        source({
          type: 'crm',
          operations: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
          ],
          triggers: [{ id: 'crm_webhook', provider: 'crm' }],
        }),
        source({ type: 'new_block' }),
      ])
    ).toEqual([
      'missing crm: method b → b',
      'missing crm: trigger crm_webhook → webhook',
      'missing new_block: namespace newBlock',
    ])
  })

  it('reports shared namespaces, shared methods and params that collide after aliasing', () => {
    const names: SdkNamesFile = {
      version: 1,
      blocks: {
        a: { namespace: 'shared', methods: { x: 'go', y: 'go' } },
        b: { namespace: 'shared', paramAliases: { action: { oauthCredential: 'credential' } } },
      },
    }
    const issues = validateSdkNames(names, [
      source({
        type: 'b',
        params: { action: [param('oauthCredential', true), param('credential')], trigger: [] },
      }),
    ])
    expect(issues).toEqual([
      'a: method "go" names both x and y',
      'b: action param "credential" names id:credential, pair:oauthCredential',
      'b: namespace "shared" collides with a',
    ])
  })

  it('keeps trigger namespaces to trigger blocks and clear of trigger methods', () => {
    const names: SdkNamesFile = {
      version: 1,
      blocks: {
        crm: { namespace: 'trigger.crm' },
        mail: { namespace: 'mail', triggers: { mail_poller: 'poller' } },
        mail_watch: { namespace: 'trigger.mail' },
      },
    }
    expect(
      validateSdkNames(names, [
        source({ type: 'crm' }),
        source({ type: 'mail_watch', triggerBlock: true }),
      ])
    ).toEqual([
      'crm: namespace "trigger.crm" is only for trigger blocks',
      'mail_watch: namespace "trigger.mail" collides with mail\'s trigger methods',
    ])
  })

  it('rejects a namespace on an SDK-owned root or a reserved word', () => {
    const names: SdkNamesFile = {
      version: 1,
      blocks: { a: { namespace: 'trigger' }, b: { namespace: 'legacy.new' } },
    }
    expect(validateSdkNames(names, [])).toEqual([
      'a: namespace "trigger" is not a valid SDK namespace',
      'b: namespace "legacy.new" is not a valid SDK namespace',
    ])
  })
})
