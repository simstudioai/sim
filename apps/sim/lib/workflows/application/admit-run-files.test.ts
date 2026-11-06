/**
 * @vitest-environment node
 */
import {
  createDelegatedPrincipal,
  createExecutorPrincipal,
} from '@sim/testing/factories/principal.factory'
import {
  workspaceFileSecretProvenanceMock,
  workspaceFileSecretProvenanceMockFns,
} from '@sim/testing/mocks/workspace-file-secret-provenance.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock(
  '@/lib/uploads/contexts/workspace/file-secret-provenance',
  () => workspaceFileSecretProvenanceMock
)
const provenance = {
  getStoredFileSecretProvenanceByKey:
    workspaceFileSecretProvenanceMockFns.mockGetStoredFileSecretProvenanceByKey,
}

import {
  type ContentDeliveryGate,
  ContentRefusedError,
  observeContentDelivery,
} from '@/lib/core/application'
import {
  admitRunFiles,
  inlinesRunFiles,
  withholdUnadmittedInlineFiles,
} from '@/lib/workflows/application/admit-run-files'
import type { UserFile } from '@/executor/types'

const now = Date.now()
const CHAT = createDelegatedPrincipal()
const EXECUTOR = createExecutorPrincipal()

const ENTRY = { encryptedValue: 'ciphertext', sourceUserId: 'user-1' }

/** Stored classification per run file key; a key absent from the map has no metadata row. */
const STORED = new Map<string, unknown>([
  ['key-clean', { status: 'exact', entries: [] }],
  ['key-secret', { status: 'exact', entries: [ENTRY] }],
  ['key-superseded', { status: 'unknown' }],
  ['key-untracked', undefined],
])

/** Refuses unknown items and opaque views of items holding secrets, as Chat's registry gate does. */
const GATE: ContentDeliveryGate = {
  async admit(sources) {
    return sources.map(
      ({ provenance: item, view }) =>
        item.status !== 'unknown' &&
        !(item.status === 'exact' && item.entries.length > 0 && view === 'opaque')
    )
  },
}

function runFile(name: string, extra: Partial<UserFile> = {}): UserFile {
  return {
    id: `file-${name}`,
    name: `${name}.txt`,
    url: `https://files.invalid/${name}`,
    size: 4,
    type: 'text/plain',
    key: `key-${name}`,
    ...extra,
  }
}

beforeEach(() => {
  provenance.getStoredFileSecretProvenanceByKey.mockImplementation(
    async (_workspaceId: string, keys: readonly string[]) =>
      new Map(keys.filter((key) => STORED.has(key)).map((key) => [key, STORED.get(key)]))
  )
})

describe('admitRunFiles', () => {
  it('classifies each run file by the key the run recorded', async () => {
    const files = ['clean', 'secret', 'superseded', 'untracked', 'unnamed'].map((name) =>
      runFile(name)
    )
    const admitted = await observeContentDelivery(GATE, () =>
      admitRunFiles(CHAT, 'workspace-1', files, 'opaque')
    )
    /**
     * A key with no metadata row predates them (unrecorded, admitted); a key no lookup answered,
     * or a superseded version, is unknown; secrets in an opaque view are refused.
     */
    expect([...admitted].sort()).toEqual(['file-clean', 'file-untracked'])
  })

  it('admits a secret-bearing file when the view is text egress can redact', async () => {
    const admitted = await observeContentDelivery(GATE, () =>
      admitRunFiles(CHAT, 'workspace-1', [runFile('secret')], 'complete')
    )
    expect([...admitted]).toEqual(['file-secret'])
  })

  it('admits every file for a caller no gate observes, without reading provenance', async () => {
    const files = [runFile('superseded'), runFile('secret')]
    const admitted = await admitRunFiles(EXECUTOR, 'workspace-1', files, 'opaque')
    expect([...admitted].sort()).toEqual(['file-secret', 'file-superseded'])
    expect(provenance.getStoredFileSecretProvenanceByKey).not.toHaveBeenCalled()
  })
})

describe('withholdUnadmittedInlineFiles', () => {
  it.each(['clean', 'secret'])(
    'handles deeply nested %s files without a call-stack limit',
    async (kind) => {
      let output: unknown = runFile(kind, { base64: 'Ynl0ZXM=' })
      for (let depth = 0; depth < 12_000; depth++) output = [output]
      const result = await observeContentDelivery(GATE, () =>
        withholdUnadmittedInlineFiles(CHAT, 'workspace-1', output)
      )
      let leaf = result
      while (Array.isArray(leaf)) leaf = leaf[0]
      expect(leaf).toMatchObject({ id: `file-${kind}` })
      if (kind === 'secret') expect(leaf).not.toHaveProperty('base64')
      else expect(result).toBe(output)
    }
  )

  it('strips base64 only from files Chat may not receive, keeping their descriptors', async () => {
    const clean = runFile('clean', { base64: 'Y2xlYW4=' })
    const secret = runFile('secret', { base64: 'c2VjcmV0' })
    const output = {
      result: { files: [clean, secret], note: 'done' },
      count: 2,
      at: new Date(now),
    }
    const withheld = await observeContentDelivery(GATE, () =>
      withholdUnadmittedInlineFiles(CHAT, 'workspace-1', output)
    )
    const { base64: _secretBytes, ...secretDescriptor } = secret
    expect(withheld).toEqual({
      result: { files: [clean, secretDescriptor], note: 'done' },
      count: 2,
      at: output.at,
    })
    expect(withheld.at).toBe(output.at)
    expect(output.result.files[1].base64).toBe('c2VjcmV0')
  })

  it('returns the very same value when every inlined file is admitted', async () => {
    const output = { files: [runFile('clean', { base64: 'Y2xlYW4=' }), runFile('secret')] }
    const result = await observeContentDelivery(GATE, () =>
      withholdUnadmittedInlineFiles(CHAT, 'workspace-1', output)
    )
    expect(result).toBe(output)
  })

  it('withholds a file reached through shared references everywhere it appears', async () => {
    const secret = runFile('secret', { base64: 'c2VjcmV0' })
    const shared = { file: secret }
    const output = { first: shared, second: shared, list: [secret] }
    const result = await observeContentDelivery(GATE, () =>
      withholdUnadmittedInlineFiles(CHAT, 'workspace-1', output)
    )
    expect(result.first).toBe(result.second)
    expect(result.first.file).not.toHaveProperty('base64')
    expect(result.list[0]).not.toHaveProperty('base64')
  })

  it('terminates on a cyclic output and withholds the file inside it', async () => {
    const node: { file: UserFile; self?: unknown } = {
      file: runFile('secret', { base64: 'c2VjcmV0' }),
    }
    node.self = node
    const result = await observeContentDelivery(GATE, () =>
      withholdUnadmittedInlineFiles(CHAT, 'workspace-1', { node })
    )
    expect(result.node.file).not.toHaveProperty('base64')
  })

  it('withholds inline bytes even after a byteless descriptor of the same file', async () => {
    const output = {
      first: runFile('secret'),
      later: runFile('secret', { base64: 'c2VjcmV0' }),
    }
    const result = await observeContentDelivery(GATE, () =>
      withholdUnadmittedInlineFiles(CHAT, 'workspace-1', output)
    )
    expect(result.later).not.toHaveProperty('base64')
  })

  it('keeps an own `__proto__` key as data in the copy', async () => {
    const output = JSON.parse('{"__proto__":{"note":"kept"},"files":[]}')
    output.files.push(runFile('secret', { base64: 'c2VjcmV0' }))
    const result = await observeContentDelivery(GATE, () =>
      withholdUnadmittedInlineFiles(CHAT, 'workspace-1', output)
    )
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect(Object.hasOwn(result, '__proto__')).toBe(true)
    expect(result.files[0]).not.toHaveProperty('base64')
  })

  it('refuses refused bytes held by an object it cannot rebuild', async () => {
    class Envelope {
      constructor(readonly file: UserFile) {}
    }
    const output = { wrapped: new Envelope(runFile('secret', { base64: 'c2VjcmV0' })) }
    await expect(
      observeContentDelivery(GATE, () => withholdUnadmittedInlineFiles(CHAT, 'workspace-1', output))
    ).rejects.toBeInstanceOf(ContentRefusedError)
  })

  it('leaves every caller no gate observes byte-identical', async () => {
    const output = { files: [runFile('superseded', { base64: 'b2xk' })] }
    expect(await withholdUnadmittedInlineFiles(EXECUTOR, 'workspace-1', output)).toBe(output)
  })
})

describe('inlinesRunFiles', () => {
  it('disables inline bytes for Chat only on a run that streams its result', () => {
    observeContentDelivery(GATE, () => {
      expect(inlinesRunFiles(CHAT, true, 'stream')).toBe(false)
      expect(inlinesRunFiles(CHAT, true, undefined)).toBe(false)
      expect(inlinesRunFiles(CHAT, true, 'sync')).toBe(true)
      expect(inlinesRunFiles(CHAT, undefined, 'stream')).toBe(false)
    })
    expect(inlinesRunFiles(EXECUTOR, true, 'stream')).toBe(true)
  })
})
