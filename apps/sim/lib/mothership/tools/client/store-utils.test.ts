/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'
import { Read as ReadTool } from '@/lib/mothership/generated/tool-catalog-v1'
import { resolveToolDisplay } from './store-utils'
import { ClientToolCallState } from './tool-call-state'

const gmailBlock = { type: 'gmail_v2', name: 'Gmail', icon: () => null }
const customBlock = {
  type: 'custom_block_invoice_parser',
  name: 'Invoice Parser',
  icon: () => null,
}

vi.mock('@/blocks/registry', () => ({
  getBlock: vi.fn((type: string) => {
    if (type === 'gmail_v2') return gmailBlock
    if (type === 'custom_block_invoice_parser') return customBlock
    return undefined
  }),
  getLatestBlock: vi.fn((baseType: string) => (baseType === 'gmail' ? gmailBlock : undefined)),
}))

describe('resolveToolDisplay', () => {
  it('uses a friendly label for internal respond tools', () => {
    expect(resolveToolDisplay('respond', ClientToolCallState.executing)?.text).toBe(
      'Gathering thoughts'
    )
    expect(resolveToolDisplay('workflow_respond', ClientToolCallState.success)?.text).toBe(
      'Gathering thoughts'
    )
  })

  it('formats read targets from workspace paths', () => {
    expect(resolveToolDisplay(ReadTool.id, ClientToolCallState.executing)?.text).toBe(
      'Reading file'
    )
    expect(resolveToolDisplay(ReadTool.id, ClientToolCallState.success)?.text).toBe('Read file')

    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.executing, {
        path: 'files/report.pdf',
      })?.text
    ).toBe('Reading report.pdf')

    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.success, {
        path: 'workflows/My Workflow/meta.json',
      })?.text
    ).toBe('Read metadata for My Workflow')

    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.success, {
        path: 'workflows/Folder 1/RET XYZ/state.json',
      })?.text
    ).toBe('Read RET XYZ')
  })

  it('labels resource artifact reads distinctly instead of repeating the resource name', () => {
    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.success, {
        path: 'workflows/Elder v2/The Elder/state.json',
      })?.text
    ).toBe('Read The Elder')
    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.success, {
        path: 'workflows/Elder v2/The Elder/deployment.json',
      })?.text
    ).toBe('Read deployment status for The Elder')
    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.error, {
        path: 'workflows/Elder v2/The Elder/lint.json',
      })?.text
    ).toBe('Attempted to validate The Elder')
    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.success, {
        path: 'tables/CRM/Leads/views.json',
      })?.text
    ).toBe('Read views of Leads')
    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.success, {
        path: 'knowledgebases/Contracts/documents.json',
      })?.text
    ).toBe('Read documents in Contracts')
  })

  it('formats docs corpus reads as section/page', () => {
    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.success, {
        path: 'docs/workflows/blocks/agent.mdx',
      })?.text
    ).toBe('Read workflows/agent')

    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.executing, {
        path: 'docs/integrations/gmail.mdx',
      })?.text
    ).toBe('Reading integrations/gmail')

    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.error, {
        path: 'docs/getting-started.mdx',
      })?.text
    ).toBe('Attempted to read getting-started')
  })

  it('decodes percent-encoded VFS path segments for display', () => {
    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.executing, {
        path: 'files/My%20Report.txt',
      })?.text
    ).toBe('Reading My Report.txt')

    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.success, {
        path: 'workflows/My%20Workflow/meta.json',
      })?.text
    ).toBe('Read metadata for My Workflow')

    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.executing, {
        path: 'files/caf%C3%A9.txt',
      })?.text
    ).toBe('Reading café.txt')

    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.success, {
        path: 'files/Quarterly%20Report.docx/content',
      })?.text
    ).toBe('Read Quarterly Report.docx')
  })

  it('shows only the file name for file reads, dropping the folder path and content qualifier', () => {
    // Bare file leaf inside a folder → just the file name (with extension).
    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.success, {
        path: 'files/Skills/Skill%20%E2%80%94%20PostHog%20Analytics.md',
      })?.text
    ).toBe('Read Skill — PostHog Analytics.md')

    // Explicit content facet → no "the content of", folder dropped too.
    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.success, {
        path: 'files/Skills/Skill%20%E2%80%94%20PostHog%20Analytics.md/content',
      })?.text
    ).toBe('Read Skill — PostHog Analytics.md')

    // Non-content facets keep their descriptive label but still show only the name.
    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.executing, {
        path: 'files/Reports/brief.docx/meta.json',
      })?.text
    ).toBe('Reading metadata for brief.docx')
  })

  it('falls back to the raw segment when it is not valid percent-encoding', () => {
    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.executing, {
        path: 'files/100%done.txt',
      })?.text
    ).toBe('Reading 100%done.txt')
  })

  it('formats special workspace file reads as natural language', () => {
    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.error, {
        path: 'files/haiku_collection_sim.pptx/compiled-check',
      })?.text
    ).toBe('Attempted to read the final file check for haiku_collection_sim.pptx')

    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.success, {
        path: 'files/Reports/brief.docx/content',
      })?.text
    ).toBe('Read brief.docx')

    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.executing, {
        path: 'files/report.pdf/meta.json',
      })?.text
    ).toBe('Reading metadata for report.pdf')

    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.success, {
        path: 'files/deck.pptx/style',
      })?.text
    ).toBe('Read style details for deck.pptx')
  })

  it('shows the block display name for block, integration, and custom-block reads', () => {
    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.success, {
        path: 'components/blocks/gmail_v2.json',
      })?.text
    ).toBe('Read Gmail')

    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.executing, {
        path: 'components/integrations/gmail/send.json',
      })?.text
    ).toBe('Reading Gmail')

    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.success, {
        path: 'components/blocks/unknown_block.json',
      })?.text
    ).toBe('Read Unknown block')

    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.success, {
        path: 'organization/custom-blocks/custom_block_invoice_parser.json',
      })?.text
    ).toBe('Read Invoice Parser')
  })

  it('humanizes internal VFS resource identifiers', () => {
    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.executing, {
        path: 'environment/oauth-integrations.json',
      })?.text
    ).toBe('Reading OAuth integrations')

    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.success, {
        path: 'environment/oauth-integrations.json',
      })?.text
    ).toBe('Read OAuth integrations')

    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.success, {
        path: 'environment/api-key-integrations.json',
      })?.text
    ).toBe('Read API key integrations')
  })

  it('falls back to a humanized tool label for generic tools', () => {
    expect(resolveToolDisplay('deploy_as_api', ClientToolCallState.success)?.text).toBe(
      'Executed Deploy As API'
    )
    expect(resolveToolDisplay('oauth-integrations', ClientToolCallState.success)?.text).toBe(
      'Executed OAuth Integrations'
    )
  })

  it('hides internal deferred tool loaders', () => {
    expect(resolveToolDisplay('load_custom_tool', ClientToolCallState.executing)).toBeUndefined()
  })
})

describe('lint reads render as validation', () => {
  it.each([
    [ClientToolCallState.generating, 'Validating The Elder'],
    [ClientToolCallState.success, 'Validated The Elder'],
    [ClientToolCallState.error, 'Attempted to validate The Elder'],
    [ClientToolCallState.aborted, 'Skipped validating The Elder'],
  ])('state %s -> %s', (state, expected) => {
    expect(
      resolveToolDisplay('read', state, { path: 'workflows/Elder v2/The Elder/lint.json' })?.text
    ).toBe(expected)
  })

  it('only workflow lint artifacts get the verb; other reads keep Reading', () => {
    expect(
      resolveToolDisplay('read', ClientToolCallState.success, {
        path: 'workflows/Elder v2/The Elder/meta.json',
      })?.text
    ).toBe('Read metadata for The Elder')
  })
})
