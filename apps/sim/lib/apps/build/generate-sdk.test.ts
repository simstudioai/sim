import { describe, expect, it } from 'vitest'
import { generateSimGeneratedTs } from '@/lib/apps/build/generate-sdk'
import { withSchemaHash } from '@/lib/apps/manifest'

describe('generateSimGeneratedTs', () => {
  it('emits a typed wrapper that calls the original action id', () => {
    const src = generateSimGeneratedTs([
      withSchemaHash({
        actionId: 'main',
        workflowId: 'w',
        deploymentVersionId: 'd',
        inputSchema: {
          type: 'object',
          properties: { q: { type: 'string' } },
          required: ['q'],
          additionalProperties: false,
        },
        outputAllowlist: [],
        executionPolicy: 'sync',
      }),
    ])
    expect(src).toContain('sim.run("main"')
    expect(src).toContain('export async function main')
    expect(src).toContain('export type MainInput')
  })

  it('types file outputs as the stable public Apps file shape', () => {
    const src = generateSimGeneratedTs([
      withSchemaHash({
        actionId: 'profile',
        workflowId: 'w',
        deploymentVersionId: 'd',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputAllowlist: [
          {
            key: 'avatarFile',
            blockId: 'tiktok-1',
            path: 'avatarFile',
            schema: {
              type: 'object',
              properties: {
                url: { type: 'string' },
                name: { type: 'string' },
                mimeType: { type: 'string' },
                size: { type: 'number' },
              },
              required: ['url', 'name', 'mimeType', 'size'],
              additionalProperties: false,
            },
          },
        ],
        executionPolicy: 'sync',
      }),
    ])
    expect(src).toContain('{ url: string; name: string; mimeType: string; size: number }')
  })
})
