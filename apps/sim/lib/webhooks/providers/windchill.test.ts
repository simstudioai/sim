/**
 * @vitest-environment node
 */
import { resetEnvMock, setEnv } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { MockWindchillProviderError, mockCreateWindchillSession, mockWindchillMutationRequest } =
  vi.hoisted(() => {
    class MockWindchillProviderError extends Error {
      constructor(
        message: string,
        readonly status: number
      ) {
        super(message)
        this.name = 'WindchillProviderError'
      }
    }

    return {
      MockWindchillProviderError,
      mockCreateWindchillSession: vi.fn(),
      mockWindchillMutationRequest: vi.fn(),
    }
  })

vi.mock('@/tools/windchill/utils.server', () => ({
  createWindchillSession: mockCreateWindchillSession,
  WindchillProviderError: MockWindchillProviderError,
  windchillMutationRequest: mockWindchillMutationRequest,
}))

import { windchillHandler } from '@/lib/webhooks/providers/windchill'
import { WindchillBlock } from '@/blocks/blocks/windchill'
import { getTrigger } from '@/triggers'
import {
  windchillCustomDocumentEventTrigger,
  windchillDocumentAttributesChangedTrigger,
  windchillDocumentIdentityChangedTrigger,
  windchillDocumentLifecycleStateChangedTrigger,
} from '@/triggers/windchill'

const BASE_CONFIG = {
  triggerBaseUrl: 'https://windchill.example.com/Windchill/servlet/odata/v6',
  triggerUsername: 'windchill-user',
  triggerPassword: 'windchill-password',
  triggerId: 'windchill_document_attributes_changed',
  triggerScope: 'document',
  triggerDocumentOid: 'OR:wt.doc.WTDocument:1',
  triggerSubscribeAllVersions: true,
}

function subscriptionContext(providerConfig: Record<string, unknown>) {
  return {
    webhook: { id: 'webhook-1', path: 'windchill-path', providerConfig },
    workflow: {},
    userId: 'user-1',
    requestId: 'request-1',
    request: new NextRequest('http://localhost/test'),
  }
}

function deleteContext(providerConfig: Record<string, unknown>, strict = false) {
  return {
    webhook: { id: 'webhook-1', providerConfig },
    workflow: {},
    requestId: 'request-delete-1',
    strict,
  }
}

describe('Windchill webhook provider', () => {
  beforeEach(() => {
    setEnv({ NEXT_PUBLIC_APP_URL: 'https://app.test' })
    mockCreateWindchillSession.mockReset()
    mockWindchillMutationRequest.mockReset()
    mockCreateWindchillSession.mockResolvedValue({
      nonceHeader: 'CSRF_NONCE',
      nonceValue: 'nonce',
      cookie: null,
    })
    mockWindchillMutationRequest.mockResolvedValue({
      ID: 'OR:wt.notify.NotificationSubscription:5012541',
    })
  })

  afterEach(() => {
    resetEnvMock()
  })

  it('creates an object subscription for the mapped attributes event', async () => {
    const result = await windchillHandler.createSubscription!(subscriptionContext(BASE_CONFIG))

    expect(mockCreateWindchillSession).toHaveBeenCalledWith({
      baseUrl: BASE_CONFIG.triggerBaseUrl,
      username: BASE_CONFIG.triggerUsername,
      password: BASE_CONFIG.triggerPassword,
    })
    expect(mockWindchillMutationRequest).toHaveBeenCalledWith({
      params: {
        baseUrl: BASE_CONFIG.triggerBaseUrl,
        username: BASE_CONFIG.triggerUsername,
        password: BASE_CONFIG.triggerPassword,
      },
      session: { nonceHeader: 'CSRF_NONCE', nonceValue: 'nonce', cookie: null },
      url: 'https://windchill.example.com/Windchill/servlet/odata/v6/EventMgmt/EntityEventSubscriptions',
      method: 'POST',
      body: {
        Name: 'Sim webhook-1 EDIT_ATTRIBUTES',
        CallbackURL: 'https://app.test/api/webhooks/trigger/windchill-path',
        'SubscribedEvent@odata.bind': "Events('EDIT_ATTRIBUTES')",
        'SubscribedOnEntity@odata.bind': "WindchillEntities('OR%3Awt.doc.WTDocument%3A1')",
        SubscribeAllVersions: true,
        '@odata.type': 'PTC.EventMgmt.EntityEventSubscription',
      },
    })
    expect(result?.providerConfigUpdates).toEqual({
      externalId: 'OR:wt.notify.NotificationSubscription:5012541',
    })
  })

  it('creates a folder subscription for a custom installed event', async () => {
    await windchillHandler.createSubscription!(
      subscriptionContext({
        ...BASE_CONFIG,
        triggerId: 'windchill_custom_document_event',
        triggerEvent: 'EDIT_CONTENT',
        triggerScope: 'folder',
        triggerFolderOid: 'OR:wt.folder.SubFolder:2',
      })
    )

    expect(mockWindchillMutationRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://windchill.example.com/Windchill/servlet/odata/v6/EventMgmt/EventSubscriptions',
        body: {
          Name: 'Sim webhook-1 EDIT_CONTENT',
          CallbackURL: 'https://app.test/api/webhooks/trigger/windchill-path',
          'SubscribedEvent@odata.bind': "Events('EDIT_CONTENT')",
          SubscribedOnEntityType: 'PTC.DocMgmt.Document',
          'SubscribedOnFolder@odata.bind': "Folders('OR%3Awt.folder.SubFolder%3A2')",
          '@odata.type': 'PTC.EventMgmt.EntityTypeInFolderEventSubscription',
        },
      })
    )
  })

  it('creates a container subscription for the mapped identity event', async () => {
    await windchillHandler.createSubscription!(
      subscriptionContext({
        ...BASE_CONFIG,
        triggerId: 'windchill_document_identity_changed',
        triggerScope: 'container',
        triggerContainerOid: 'OR:wt.pdmlink.PDMLinkProduct:3',
      })
    )

    expect(mockWindchillMutationRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          'SubscribedEvent@odata.bind': "Events('EDIT_IDENTITY')",
          SubscribedOnEntityType: 'PTC.DocMgmt.Document',
          'SubscribedOnContext@odata.bind': "Containers('OR%3Awt.pdmlink.PDMLinkProduct%3A3')",
          '@odata.type': 'PTC.EventMgmt.EntityTypeInContainerEventSubscription',
        }),
      })
    )
  })

  it('includes the documented lifecycle state object', async () => {
    await windchillHandler.createSubscription!(
      subscriptionContext({
        ...BASE_CONFIG,
        triggerId: 'windchill_document_lifecycle_state_changed',
        triggerLifecycleStateValue: 'RELEASED',
      })
    )

    expect(mockWindchillMutationRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          'SubscribedEvent@odata.bind': "Events('CHANGE_LIFECYCLE_STATE')",
          LifeCycleState: { Value: 'RELEASED' },
        }),
      })
    )
  })

  it('rejects unsafe custom event identifiers before making a Windchill request', async () => {
    await expect(
      windchillHandler.createSubscription!(
        subscriptionContext({
          ...BASE_CONFIG,
          triggerId: 'windchill_custom_document_event',
          triggerEvent: "EDIT_CONTENT')/Anything(",
        })
      )
    ).rejects.toThrow('unsupported characters')
    expect(mockCreateWindchillSession).not.toHaveBeenCalled()
  })

  it('requires trigger credentials and scope identifiers', async () => {
    await expect(
      windchillHandler.createSubscription!(
        subscriptionContext({ ...BASE_CONFIG, triggerPassword: '' })
      )
    ).rejects.toThrow('Windchill password is required')

    await expect(
      windchillHandler.createSubscription!(
        subscriptionContext({ ...BASE_CONFIG, triggerDocumentOid: '' })
      )
    ).rejects.toThrow('Windchill document OID is required')
  })

  it('fails deployment when Windchill returns no subscription ID', async () => {
    mockWindchillMutationRequest.mockResolvedValue({ Name: 'Created without an ID' })

    await expect(
      windchillHandler.createSubscription!(subscriptionContext(BASE_CONFIG))
    ).rejects.toThrow('no subscription ID was returned')
  })

  it('deletes the external subscription by its Windchill OID', async () => {
    await windchillHandler.deleteSubscription!(
      deleteContext({
        ...BASE_CONFIG,
        externalId: 'OR:wt.notify.NotificationSubscription:5012541',
      })
    )

    expect(mockWindchillMutationRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://windchill.example.com/Windchill/servlet/odata/v6/EventMgmt/EventSubscriptions('OR%3Awt.notify.NotificationSubscription%3A5012541')",
        method: 'DELETE',
      })
    )
  })

  it('treats a missing external subscription as already deleted', async () => {
    mockWindchillMutationRequest.mockRejectedValue(new MockWindchillProviderError('Not found', 404))

    await expect(
      windchillHandler.deleteSubscription!(
        deleteContext({
          ...BASE_CONFIG,
          externalId: 'OR:wt.notify.NotificationSubscription:5012541',
        })
      )
    ).resolves.toBeUndefined()
  })

  it('keeps cleanup non-fatal unless strict cleanup is requested', async () => {
    const error = new MockWindchillProviderError('Windchill unavailable', 503)
    mockWindchillMutationRequest.mockRejectedValue(error)
    const config = {
      ...BASE_CONFIG,
      externalId: 'OR:wt.notify.NotificationSubscription:5012541',
    }

    await expect(
      windchillHandler.deleteSubscription!(deleteContext(config))
    ).resolves.toBeUndefined()
    await expect(windchillHandler.deleteSubscription!(deleteContext(config, true))).rejects.toBe(
      error
    )
  })
})

describe('Windchill trigger configuration', () => {
  const triggers = [
    windchillDocumentAttributesChangedTrigger,
    windchillDocumentIdentityChangedTrigger,
    windchillDocumentLifecycleStateChangedTrigger,
    windchillCustomDocumentEventTrigger,
  ]

  it('uses the shared dropdown only on the primary trigger', () => {
    expect(
      windchillDocumentAttributesChangedTrigger.subBlocks.some(
        (subBlock) => subBlock.id === 'selectedTriggerId'
      )
    ).toBe(true)
    for (const trigger of triggers.slice(1)) {
      expect(trigger.subBlocks.some((subBlock) => subBlock.id === 'selectedTriggerId')).toBe(false)
    }
  })

  it('keeps callback payloads raw until PTC documents their schema', () => {
    for (const trigger of triggers) {
      expect(trigger.outputs).toEqual({})
    }
    expect(windchillHandler.formatInput).toBeUndefined()
    expect(windchillHandler.matchEvent).toBeUndefined()
    expect(windchillHandler.extractIdempotencyId).toBeUndefined()
  })

  it('registers every trigger on the Windchill block', () => {
    const ids = triggers.map((trigger) => trigger.id)
    expect(WindchillBlock.triggerAllowed).toBe(true)
    expect(WindchillBlock.triggers).toEqual({ enabled: true, available: ids })
    for (const id of ids) {
      expect(getTrigger(id).id).toBe(id)
    }
  })
})
