/**
 * @vitest-environment node
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { DelegatedServiceId, Principal } from '@sim/auth/principal'
import { describe, expect, it, vi } from 'vitest'
import {
  admitContent,
  admitWrittenContent,
  type ContentDeliveryGate,
  ContentDeliveryUnaccountedError,
  ContentDeliveryUnobservedError,
  ContentRefusedError,
  type ContentSource,
  countWithheldContent,
  mustClassifyContent,
  noteContentDeliveryOperation,
  observeContentDelivery,
  observeContentOutsideModel,
  requireAdmittedContent,
  runDeclaredContentOperation,
  runWorkflowOutsideContentDelivery,
  trackContentDelivery,
} from '@/lib/core/application/content-delivery'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'
import { PROVENANCE_MAX_ENTRIES } from '@/lib/execution/provenance-limits'

function delegated(serviceId: DelegatedServiceId): Principal {
  const now = Date.now()
  return {
    kind: 'delegated',
    serviceId,
    subjectUserId: 'user-1',
    workspaceId: 'workspace-1',
    delegationId: 'delegation-1',
    audience: 'sim:test',
    issuedAt: new Date(now),
    expiresAt: new Date(now + 60_000),
  }
}

const CHAT = delegated('copilot')
const PROJECT_CHAT: Principal = {
  kind: 'resource_delegated',
  serviceId: 'copilot',
  subjectUserId: 'user-1',
  audience: 'sim:project-files',
  delegationId: 'delegation-1',
  issuedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
  scope: { kind: 'entity', entityType: 'project', entityId: 'project-1' },
  invocation: { kind: 'workspace', workspaceId: 'workspace-1' },
}
const EXECUTOR = delegated('executor')
const SESSION: Principal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' }

function operation(contentDelivery: 'sourced' | 'none') {
  return defineWorkspaceOperation({
    id: `test.${contentDelivery}`,
    contentDelivery,
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
    capability: 'none',
  })
}

const SOURCED = operation('sourced')
const NONE = operation('none')

function source(id: string, status: 'clean' | 'unknown' = 'clean'): ContentSource {
  return {
    kind: 'workspace-file',
    id,
    provenance: status === 'clean' ? { status: 'exact', entries: [] } : { status: 'unknown' },
    view: 'complete',
  }
}

/** Admits clean items and refuses unknown ones, recording every batch it was asked about. */
function recordingGate() {
  const batches: string[][] = []
  const gate: ContentDeliveryGate = {
    async admit(sources) {
      batches.push(sources.map((item) => item.id))
      return sources.map((item) => item.provenance.status !== 'unknown')
    },
  }
  return { gate, batches }
}

describe('mustClassifyContent', () => {
  it('refuses Chat with no gate before anything loads', () => {
    expect(() => mustClassifyContent(CHAT)).toThrow(ContentDeliveryUnobservedError)
    expect(() => mustClassifyContent(PROJECT_CHAT)).toThrow(ContentDeliveryUnobservedError)
  })

  it('is true for Chat under a gate and false for every other caller, gate or not', () => {
    const { gate } = recordingGate()
    expect(observeContentDelivery(gate, () => mustClassifyContent(CHAT))).toBe(true)
    expect(mustClassifyContent(EXECUTOR)).toBe(false)
    expect(mustClassifyContent(SESSION)).toBe(false)
    expect(observeContentDelivery(gate, () => mustClassifyContent(SESSION))).toBe(false)
  })
})

describe('admitContent', () => {
  it('decides each item on its own for Chat', async () => {
    const { gate, batches } = recordingGate()
    const items = [source('clean'), source('tainted', 'unknown'), source('also-clean')]
    const admission = await observeContentDelivery(gate, () => admitContent(CHAT, items))
    expect(items.map((item) => admission.admits(item))).toEqual([true, false, true])
    expect(admission.refused.map((item) => item.id)).toEqual(['tainted'])
    expect(batches).toEqual([['clean', 'tainted', 'also-clean']])
  })

  it('admits every other caller unread, whatever the items say', async () => {
    const { gate, batches } = recordingGate()
    const items = [source('tainted', 'unknown')]
    for (const principal of [EXECUTOR, SESSION]) {
      const admission = await observeContentDelivery(gate, () => admitContent(principal, items))
      expect(admission.admits(items[0])).toBe(true)
    }
    expect(batches).toEqual([])
  })

  it('only accounts for an empty result, even for Chat with no gate', async () => {
    const record = await trackContentDelivery(async () => {
      noteContentDeliveryOperation(SOURCED, CHAT)
      return admitContent(CHAT, [])
    })
    expect(record.result.refused).toEqual([])
    expect(record.unaccounted).toBe(false)
  })

  it('refuses Chat items with no gate installed', async () => {
    await expect(admitContent(CHAT, [source('clean')])).rejects.toThrow(
      ContentDeliveryUnobservedError
    )
  })

  it('refuses items classified inside an operation declared to return none', async () => {
    const { gate } = recordingGate()
    await expect(
      observeContentDelivery(gate, () =>
        runDeclaredContentOperation(NONE, CHAT, () => admitContent(CHAT, [source('clean')]))
      )
    ).rejects.toMatchObject({ name: 'ContentDeliveryUndeclaredError' })
  })
})

describe('requireAdmittedContent', () => {
  it('passes an admitted item and refuses a refused one with a 403 naming no content', async () => {
    const { gate } = recordingGate()
    await expect(
      observeContentDelivery(gate, () => requireAdmittedContent(CHAT, source('clean')))
    ).resolves.toBeUndefined()
    const refusal = await observeContentDelivery(gate, () =>
      requireAdmittedContent(CHAT, source('tainted', 'unknown')).catch((error: unknown) => error)
    )
    expect(refusal).toBeInstanceOf(ContentRefusedError)
    expect(refusal).toMatchObject({
      code: 'forbidden',
      message: expect.not.stringContaining('tainted'),
    })
  })
})

describe('runDeclaredContentOperation', () => {
  it('throws for a sourced operation that never accounted, after its effects completed', async () => {
    const { gate } = recordingGate()
    const complete = vi.fn(async () => {})
    await expect(
      observeContentDelivery(gate, () =>
        runDeclaredContentOperation(SOURCED, CHAT, async () => 'unclassified', complete)
      )
    ).rejects.toThrow(ContentDeliveryUnaccountedError)
    expect(complete).toHaveBeenCalledWith('unclassified')
  })

  it('returns a sourced result that accounted, and a none result that had nothing to account', async () => {
    const { gate } = recordingGate()
    await expect(
      observeContentDelivery(gate, () =>
        runDeclaredContentOperation(SOURCED, CHAT, async () => {
          await admitContent(CHAT, [source('clean')])
          return 'classified'
        })
      )
    ).resolves.toBe('classified')
    await expect(runDeclaredContentOperation(NONE, CHAT, async () => 'metadata')).resolves.toBe(
      'metadata'
    )
  })

  it('runs every other caller unchanged, with no accounting demanded', async () => {
    const complete = vi.fn(async () => {})
    await expect(
      runDeclaredContentOperation(SOURCED, EXECUTOR, async () => 'run output', complete)
    ).resolves.toBe('run output')
    expect(complete).toHaveBeenCalledWith('run output')
  })

  it('answers a committed write whose returned item was refused only after its effects', async () => {
    const { gate } = recordingGate()
    const events: string[] = []
    const refusal = await observeContentDelivery(gate, () =>
      runDeclaredContentOperation(
        SOURCED,
        CHAT,
        async () => {
          const admission = await admitWrittenContent(CHAT, [source('written', 'unknown')])
          events.push(`write returned admitted=${admission.refused.length === 0}`)
          return 'saved row'
        },
        async () => {
          events.push('audit recorded')
        }
      ).catch((error: unknown) => error)
    )
    expect(events).toEqual(['write returned admitted=false', 'audit recorded'])
    expect(refusal).toBeInstanceOf(ContentRefusedError)
    expect(refusal).toMatchObject({ message: expect.stringContaining('The change was saved') })
  })

  it.each(['workspace-file', 'tool-result'] as const)(
    'finishes %s effects before reporting a gate failure with its actual completion state',
    async (kind) => {
      const failure = new Error('history unavailable')
      const failing: ContentDeliveryGate = {
        async admit() {
          throw failure
        },
      }
      const events: string[] = []
      const outcome = await observeContentDelivery(failing, () =>
        runDeclaredContentOperation(
          SOURCED,
          CHAT,
          async () => {
            const admission = await admitWrittenContent(CHAT, [{ ...source('written'), kind }])
            events.push(`withheld=${admission.refused.length}`)
            return 'saved row'
          },
          async () => {
            events.push('audit recorded')
          }
        ).catch((error: unknown) => error)
      )
      expect(events).toEqual(['withheld=1', 'audit recorded'])
      /** Not the gate's error: that would invite a retry of a write that already committed. */
      expect(outcome).toBeInstanceOf(ContentRefusedError)
      expect(outcome).toMatchObject({
        message: expect.stringContaining(
          kind === 'tool-result' ? 'Tool execution settled' : 'The change was saved'
        ),
      })
      /** The request's transport still sees the failure, to answer it itself (the proxy's 502). */
      const record = await observeContentDelivery(failing, () =>
        trackContentDelivery(() =>
          runDeclaredContentOperation(SOURCED, CHAT, async () => {
            await admitWrittenContent(CHAT, [{ ...source('written'), kind }])
            return 'saved row'
          }).catch(() => 'answered')
        )
      )
      expect(record.gateFailure).toBe(failure)
      expect(record.committedWrite).toBe(kind !== 'tool-result')
      await expect(
        observeContentDelivery(failing, () =>
          trackContentDelivery(() =>
            runDeclaredContentOperation(SOURCED, CHAT, async () => {
              await admitWrittenContent(CHAT, [{ ...source('written'), kind }])
            })
          )
        )
      ).rejects.toMatchObject({ gateFailure: failure, committedWrite: kind !== 'tool-result' })
    }
  )

  it('does not account for a result whose admission failed and was caught', async () => {
    const failing: ContentDeliveryGate = {
      async admit() {
        throw new Error('gate down')
      },
    }
    const outcome = await observeContentDelivery(failing, () =>
      runDeclaredContentOperation(SOURCED, CHAT, async () => {
        await admitContent(CHAT, [source('read')]).catch(() => undefined)
        return 'content returned anyway'
      }).catch((error: unknown) => error)
    )
    expect(outcome).toBeInstanceOf(ContentDeliveryUnaccountedError)
  })

  it('does not let a nested use case account for what its enclosing operation returns', async () => {
    const admitAll: ContentDeliveryGate = {
      async admit(sources) {
        return sources.map(() => true)
      },
    }
    const outcome = await observeContentDelivery(admitAll, () =>
      runDeclaredContentOperation(SOURCED, CHAT, async () => {
        await runDeclaredContentOperation(SOURCED, CHAT, async () => {
          await admitContent(CHAT, [source('nested')])
          return 'nested'
        })
        return 'outer content never classified'
      }).catch((error: unknown) => error)
    )
    expect(outcome).toBeInstanceOf(ContentDeliveryUnaccountedError)
  })

  it('rethrows a gate failure at once when no operation is open to answer with it', async () => {
    const failure = new Error('history unavailable')
    const failing: ContentDeliveryGate = {
      async admit() {
        throw failure
      },
    }
    await expect(
      observeContentDelivery(failing, () => admitWrittenContent(CHAT, [source('written')]))
    ).rejects.toBe(failure)
  })

  it('lets a written result through when every returned item was admitted', async () => {
    const { gate } = recordingGate()
    await expect(
      observeContentDelivery(gate, () =>
        runDeclaredContentOperation(SOURCED, CHAT, async () => {
          await admitWrittenContent(CHAT, [source('written')])
          return 'saved row'
        })
      )
    ).resolves.toBe('saved row')
  })
})

describe('trackContentDelivery', () => {
  it('reports a sourced operation Chat was admitted to whose use case never accounted', async () => {
    const record = await trackContentDelivery(async () => {
      noteContentDeliveryOperation(SOURCED, CHAT)
      return 'response'
    })
    expect(record).toEqual({
      result: 'response',
      unaccounted: true,
      committedWrite: false,
      admitted: [],
    })
  })

  it('does not report a none operation, or a sourced one another caller ran', async () => {
    for (const [op, principal] of [
      [NONE, CHAT],
      [SOURCED, EXECUTOR],
    ] as const) {
      const record = await trackContentDelivery(async () => {
        noteContentDeliveryOperation(op, principal)
      })
      expect(record.unaccounted).toBe(false)
    }
  })

  it('collects the provenance of admitted items only, through nested use cases', async () => {
    const { gate } = recordingGate()
    const entries = {
      status: 'exact' as const,
      entries: [{ encryptedValue: 'ciphertext', sourceUserId: 'user-1' }],
    }
    const record = await observeContentDelivery(gate, () =>
      trackContentDelivery(() =>
        runDeclaredContentOperation(SOURCED, CHAT, async () => {
          await runDeclaredContentOperation(SOURCED, CHAT, async () => {
            await admitContent(CHAT, [
              { ...source('inner'), provenance: entries },
              source('refused', 'unknown'),
            ])
          })
          await admitContent(CHAT, [source('outer')])
        })
      )
    )
    expect(record.unaccounted).toBe(false)
    expect(record.admitted).toEqual([entries])
  })

  it('keeps one bounded provenance union when nested deferred pages repeat admitted evidence', async () => {
    const gate: ContentDeliveryGate = {
      async admit(items) {
        return items.map(() => true)
      },
    }
    const entries = [
      { encryptedValue: 'first-ciphertext', sourceUserId: 'user-1' },
      { encryptedValue: 'second-ciphertext', sourceUserId: 'user-1' },
    ]
    const record = await observeContentDelivery(gate, () =>
      trackContentDelivery(() =>
        runDeclaredContentOperation(SOURCED, CHAT, async () => {
          await admitContent(CHAT, [])
          const inRequest = AsyncLocalStorage.snapshot()
          return () =>
            inRequest(() =>
              trackContentDelivery(async () => {
                await admitContent(
                  CHAT,
                  entries.map((entry, index) => ({
                    ...source(`chunk-${index}`),
                    provenance: { status: 'exact', entries: [entry] },
                  }))
                )
              })
            )
        })
      )
    )
    expect(record.admitted).toEqual([])
    for (let page = 0; page < 200; page += 1) {
      const nested = await record.result()
      expect(nested.admitted).toEqual([{ status: 'exact', entries }])
    }
    expect(record.admitted).toEqual([{ status: 'exact', entries }])
  })

  it('retains unrecorded coverage without retaining every clean or unrecorded source', async () => {
    const gate: ContentDeliveryGate = {
      async admit(items) {
        return items.map(() => true)
      },
    }
    const record = await observeContentDelivery(gate, () =>
      trackContentDelivery(async () => {
        for (let page = 0; page < 200; page += 1) {
          await admitContent(CHAT, [
            source('clean'),
            { ...source('legacy'), provenance: { status: 'unrecorded' } },
          ])
        }
      })
    )
    expect(record.admitted).toEqual([{ status: 'unrecorded' }])
  })

  it('uses the existing provenance budget for combined delivered evidence', async () => {
    const gate: ContentDeliveryGate = {
      async admit(items) {
        return items.map(() => true)
      },
    }
    const entries = Array.from({ length: PROVENANCE_MAX_ENTRIES }, (_, index) => ({
      encryptedValue: `ciphertext-${index}`,
      sourceUserId: 'user-1',
    }))
    const record = await observeContentDelivery(gate, () =>
      trackContentDelivery(async () => {
        await admitContent(CHAT, [{ ...source('first'), provenance: { status: 'exact', entries } }])
        await admitContent(CHAT, [
          {
            ...source('overflow'),
            provenance: {
              status: 'exact',
              entries: [{ encryptedValue: 'one-more', sourceUserId: 'user-1' }],
            },
          },
        ])
      })
    )
    expect(record.admitted).toEqual([{ status: 'unknown' }])
  })

  it('keeps a nested request’s accounting from satisfying a sibling that never accounted', async () => {
    const { gate } = recordingGate()
    const [accounted, unaccounted] = await observeContentDelivery(gate, () =>
      Promise.all([
        trackContentDelivery(async () => {
          noteContentDeliveryOperation(SOURCED, CHAT)
          await admitContent(CHAT, [source('clean')])
        }),
        trackContentDelivery(async () => {
          noteContentDeliveryOperation(SOURCED, CHAT)
        }),
      ])
    )
    expect(accounted.unaccounted).toBe(false)
    expect(unaccounted.unaccounted).toBe(true)
  })
})

describe('observeContentDelivery', () => {
  it('decides by the innermost gate', async () => {
    const outer = recordingGate()
    const inner = recordingGate()
    await observeContentDelivery(outer.gate, () =>
      observeContentDelivery(inner.gate, () => admitContent(CHAT, [source('clean')]))
    )
    expect(inner.batches).toEqual([['clean']])
    expect(outer.batches).toEqual([])
  })
})

describe('runWorkflowOutsideContentDelivery', () => {
  it('keeps an in-process run from consulting or accounting to the Chat request around it', async () => {
    const { gate, batches } = recordingGate()
    const record = await observeContentDelivery(gate, () =>
      trackContentDelivery(async () => {
        noteContentDeliveryOperation(SOURCED, CHAT)
        await runWorkflowOutsideContentDelivery(() =>
          runDeclaredContentOperation(SOURCED, CHAT, () =>
            admitContent(CHAT, [source('tainted', 'unknown')])
          )
        )
      })
    )
    expect(batches).toEqual([])
    expect(record.unaccounted).toBe(true)
  })

  it('classifies again under a gate installed inside the run, and after the run returns', async () => {
    const outer = recordingGate()
    const inner = recordingGate()
    await observeContentDelivery(outer.gate, async () => {
      await runWorkflowOutsideContentDelivery(() =>
        observeContentDelivery(inner.gate, () => admitContent(CHAT, [source('inside')]))
      )
      await admitContent(CHAT, [source('result')])
    })
    expect(inner.batches).toEqual([['inside']])
    expect(outer.batches).toEqual([['result']])
  })
})

describe('observeContentOutsideModel', () => {
  it('admits every item, tainted ones included, inside a gate that would refuse them', async () => {
    const { gate, batches } = recordingGate()
    const tainted = source('tainted', 'unknown')
    const admission = await observeContentDelivery(gate, () =>
      observeContentOutsideModel(() => admitContent(CHAT, [tainted]))
    )
    expect(admission.admits(tainted)).toBe(true)
    expect(batches).toEqual([])
  })
})

describe('countWithheldContent', () => {
  it('counts every refused item by kind across the requests and use cases it ran', async () => {
    const { gate } = recordingGate()
    const row = (id: string): ContentSource => ({ ...source(id, 'unknown'), kind: 'table-row' })
    const { result, withheld } = await observeContentDelivery(gate, () =>
      countWithheldContent(async () => {
        await trackContentDelivery(() => admitContent(CHAT, [row('a'), row('b'), source('clean')]))
        const admission = await admitContent(CHAT, [source('file', 'unknown')])
        return admission.refused.length
      })
    )
    expect(result).toBe(1)
    expect([...withheld].map(([kind, reasons]) => [kind, [...reasons]])).toEqual([
      ['table-row', [['unknown', 2]]],
      ['workspace-file', [['unknown', 1]]],
    ])
  })

  it('keeps the reason a gate gave for each refusal', async () => {
    const gate: ContentDeliveryGate = {
      async admit(sources) {
        return sources.map((item) =>
          item.id === 'raw' ? 'opaque' : item.id === 'later' ? 'registry' : true
        )
      },
    }
    const { withheld } = await observeContentDelivery(gate, () =>
      countWithheldContent(() =>
        admitContent(CHAT, [source('raw'), source('later'), source('clean')])
      )
    )
    expect([...(withheld.get('workspace-file') ?? [])]).toEqual([
      ['opaque', 1],
      ['registry', 1],
    ])
  })

  it('counts nothing for a caller that never classifies', async () => {
    const { gate } = recordingGate()
    const { withheld } = await observeContentDelivery(gate, () =>
      countWithheldContent(() => admitContent(EXECUTOR, [source('file', 'unknown')]))
    )
    expect(withheld.size).toBe(0)
  })
})
