/**
 * Pins what each kind prints and fingerprints for one fixed declaration. A checkout holds both: the
 * printed files are what users commit, and the base records each resource's `rf1:` fingerprint, so
 * a change to either makes every outstanding checkout read as edited or stale. When this test fails
 * the change is a format change: bump the fingerprint prefix (`rf1:` → `rf2:`) and accept the old
 * one for a release, rather than updating the pins here.
 */
import { describe, expect, it } from 'vitest'
import { fingerprintOf } from './fingerprint'
import type { KindCodec } from './kind'
import { fileCodec } from './kinds/files'
import { knowledgeCodec } from './kinds/knowledge'
import { skillCodec } from './kinds/skills'
import { testTableCodec } from './kinds/table.test-helpers'
import { toolCodec } from './kinds/tools'

const SHA = 'a'.repeat(64)

function pinned<D>(codec: KindCodec<D>, key: string, decl: D) {
  const printed = codec.print(key, decl)
  return { ...printed, fingerprint: fingerprintOf(codec.canonical(decl)) }
}

describe('kind formats', () => {
  it('knowledge base', () => {
    expect(
      pinned(knowledgeCodec, 'policies', {
        name: 'Policies',
        description: 'Support policies',
        folder: '/support',
        chunking: {
          maxSize: 512,
          minSize: 50,
          overlap: 20,
          strategy: 'recursive',
          strategyOptions: {
            pattern: '\\n\\n',
            separators: ['\n\n', '\n'],
            recipe: 'markdown',
            strictBoundaries: true,
          },
        },
        embeddingModel: 'text-embedding-3-small',
        docs: { 'refunds.md': { sha256: SHA, size: 12 } },
      })
    ).toEqual({
      text: {
        'knowledge/policies/knowledge.ts':
          "// @sim-sdk 1\nimport { defineKnowledgeBase } from '@sim/workflow-sdk/workspace'\n\nexport default defineKnowledgeBase({\n  name: 'Policies',\n  description: 'Support policies',\n  folder: '/support',\n  chunking: {\n    maxSize: 512,\n    minSize: 50,\n    overlap: 20,\n    strategy: 'recursive',\n    strategyOptions: {\n      pattern: '\\\\n\\\\n',\n      separators: ['\\n\\n', '\\n'],\n      recipe: 'markdown',\n      strictBoundaries: true,\n    },\n  },\n  embeddingModel: 'text-embedding-3-small',\n})\n",
      },
      blobs: [{ path: 'knowledge/policies/docs/refunds.md', sha256: SHA, size: 12 }],
      fingerprint: 'rf1:6208a06e2c573e109a1920fe667a139ba22b9a34e9981bb461328598b7843561',
    })
  })

  it('table', () => {
    expect(
      pinned(testTableCodec, 'leads', {
        name: 'leads',
        description: 'Inbound leads',
        folder: '/sales',
        columns: {
          email: { type: 'string', required: true, unique: true },
          stage: { type: 'select', name: 'status', options: ['new', 'won'], multiple: true },
          value: { type: 'currency', currencyCode: 'EUR' },
          notes: { type: 'json' },
        },
      })
    ).toEqual({
      text: {
        'tables/leads.ts':
          "// @sim-sdk 1\nimport { column, defineTable } from '@sim/workflow-sdk/workspace'\n\nexport default defineTable({\n  name: 'leads',\n  description: 'Inbound leads',\n  folder: '/sales',\n  columns: {\n    email: column.string({ required: true, unique: true }),\n    stage: column.select({\n      name: 'status',\n      options: ['new', 'won'],\n      multiple: true,\n    }),\n    value: column.currency({ currencyCode: 'EUR' }),\n    notes: column.json(),\n  },\n})\n",
      },
      blobs: [],
      fingerprint: 'rf1:e161ccbbf909814dd45a67e07a0f2adb6140438d41a0a04b330af8fcddf2b2e4',
    })
  })

  it('custom tool', () => {
    expect(
      pinned(toolCodec, 'lookup-order', {
        title: 'Lookup order',
        schema: {
          type: 'function',
          function: { name: 'lookup_order', parameters: { type: 'object', properties: {} } },
        },
        code: 'return fetch({{API_URL}})',
      })
    ).toEqual({
      text: {
        'tools/lookup-order.ts':
          "// @sim-sdk 1\nimport { codeFile, defineTool } from '@sim/workflow-sdk/workspace'\n\nexport default defineTool({\n  title: 'Lookup order',\n  schema: {\n    type: 'function',\n    function: {\n      name: 'lookup_order',\n      parameters: {\n        type: 'object',\n        properties: {},\n      },\n    },\n  },\n  code: codeFile('./lookup-order.js'),\n})\n",
        'tools/lookup-order.js': 'return fetch($env.API_URL)',
      },
      blobs: [],
      fingerprint: 'rf1:0d7ff24cf79b96f0a437b798e4671a1157532da25e379afdc4e0092f4cd23709',
    })
  })

  it('skill', () => {
    expect(
      pinned(skillCodec, 'tone', {
        name: 'tone',
        description: 'Answer in the support voice: short, warm.',
        content: 'Write like a person.\r\n',
      })
    ).toEqual({
      text: {
        'skills/tone.md':
          '---\nname: tone\ndescription: "Answer in the support voice: short, warm."\n---\nWrite like a person.\r\n',
      },
      blobs: [],
      fingerprint: 'rf1:f27e1bff20367d7215203181c1ccf9e23a226365c5951e1fd72756a23bca280b',
    })
  })

  it('file', () => {
    expect(pinned(fileCodec, 'reports/q1.csv', { sha256: SHA, size: 40 })).toEqual({
      text: {},
      blobs: [{ path: 'files/reports/q1.csv', sha256: SHA, size: 40 }],
      fingerprint: 'rf1:91d55c997599a1b301a52f2ad8559a9f2bfa28927d7cb2c391f3cedf6072ccdd',
    })
  })

  it('the defaults a declaration leaves out', () => {
    expect([
      fingerprintOf(knowledgeCodec.canonical({ name: 'Policies', docs: {} })),
      fingerprintOf(
        testTableCodec.canonical({ name: 'leads', columns: { value: { type: 'currency' } } })
      ),
    ]).toEqual([
      'rf1:89685dd8ee6a019d3f5ac53eeb16c7967a7e4378528d1b2f6bab0696bf127154',
      'rf1:6b29a57276d243eebb5cbb56f8ae1eef47de42ee1d92ad35b8a3601501a9cc83',
    ])
  })
})
