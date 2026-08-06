/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { Sandbox } from '@/lib/api/contracts/sandboxes'
import {
  CLI_TOOL_GROUPS,
  canRetrySandboxBuild,
  draftFromSandbox,
  emptyDraft,
  extractIssues,
  LANGUAGE_OPTIONS,
  toSubmittedLines,
} from '@/app/workspace/[workspaceId]/settings/components/sandboxes/utils'
import { FunctionBlock } from '@/blocks/blocks/function'

const languageField = FunctionBlock.subBlocks.find((subBlock) => subBlock.id === 'language')
const sandboxField = FunctionBlock.subBlocks.find((subBlock) => subBlock.id === 'sandboxId')
const functionLanguageOptions =
  typeof languageField?.options === 'function' ? languageField.options() : languageField?.options

describe('sandbox draft defaults', () => {
  it('starts a new sandbox in the language the Function block itself defaults to', () => {
    const blockDefault = typeof languageField?.value === 'function' ? languageField.value() : null
    expect(blockDefault).toBe('javascript')
    expect(emptyDraft().language).toBe(blockDefault)
  })

  it('offers languages in the Function block dropdown order', () => {
    expect(LANGUAGE_OPTIONS.map((option) => option.value)).toEqual(
      functionLanguageOptions
        ?.map((option) => (typeof option === 'string' ? option : option.id))
        .filter((language) => language !== 'shell')
    )
  })

  it('starts empty so nothing is submitted by accident', () => {
    expect(emptyDraft()).toEqual({
      name: '',
      language: 'javascript',
      dependencies: '',
      systemPackages: '',
      cliTools: [],
    })
  })

  it('copies every install source into an editable draft', () => {
    const sandbox: Sandbox = {
      id: 'sandbox-1',
      name: 'BigQuery',
      language: 'python',
      dependencies: ['requests', 'pandas'],
      systemPackages: ['jq', 'postgresql-client=16+257build1.1'],
      cliTools: ['google-cloud-cli@577.0.0-r1'],
      buildStatus: 'ready',
      errorCode: null,
      errorMessage: null,
      errorDetail: null,
      builtAt: '2026-08-03T00:00:00.000Z',
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:00.000Z',
    }

    expect(draftFromSandbox(sandbox)).toEqual({
      name: 'BigQuery',
      language: 'python',
      dependencies: 'requests\npandas',
      systemPackages: 'jq\npostgresql-client=16+257build1.1',
      cliTools: ['google-cloud-cli@577.0.0-r1'],
    })
  })
})

describe('sandbox picker create action', () => {
  it('declares the inline create row the picker renders', () => {
    expect(sandboxField?.createAction).toBe('sandbox')
  })
})

describe('managed CLI picker search metadata', () => {
  const options = CLI_TOOL_GROUPS.flatMap((group) => group.items)

  it.each([
    ['google-cloud-cli@577.0.0-r1', 'Google Cloud CLI', ['bq', 'gcloud']],
    ['github-cli@2.97.0-r1', 'GitHub CLI', ['gh']],
    ['azure-cli@2.89.0-r1', 'Azure CLI', ['az']],
    ['minio-mc@RELEASE.2025-08-13T08-35-41Z-r1', 'MinIO Client', ['mc']],
  ] as const)(
    'passes search aliases without changing the label for %s',
    (value, label, aliases) => {
      expect(options.find((option) => option.value === value)).toMatchObject({
        label,
        searchTerms: expect.arrayContaining([...aliases]),
      })
    }
  )
})

describe('sandbox build retry availability', () => {
  it('allows an admin to retry only from a clean, idle draft', () => {
    expect(canRetrySandboxBuild({ canAdmin: true, isDirty: false, saving: false })).toBe(true)
    expect(canRetrySandboxBuild({ canAdmin: true, isDirty: true, saving: false })).toBe(false)
    expect(canRetrySandboxBuild({ canAdmin: true, isDirty: false, saving: true })).toBe(false)
  })

  it('does not expose retry capability to read-only viewers', () => {
    expect(canRetrySandboxBuild({ canAdmin: false, isDirty: false, saving: false })).toBe(false)
  })
})

describe('toSubmittedLines', () => {
  it('keeps blank rows so a rejection can address the line the user typed on', () => {
    expect(toSubmittedLines('axios\n\nzod')).toEqual(['axios', '', 'zod'])
  })
})

describe('extractIssues', () => {
  it('routes system-package rejections to the system-package field', () => {
    const error = {
      body: {
        issueField: 'systemPackages',
        issues: [{ line: 2, value: 'Nope', reason: 'not a package name' }],
      },
    }
    expect(extractIssues(error)).toEqual({
      field: 'systemPackages',
      issues: [{ line: 2, value: 'Nope', reason: 'not a package name' }],
    })
  })

  it('routes legacy untagged rejections to dependencies', () => {
    const error = {
      body: { issues: [{ line: 2, value: 'Nope', reason: 'not a package name' }] },
    }
    expect(extractIssues(error)).toEqual({
      field: 'dependencies',
      issues: [{ line: 2, value: 'Nope', reason: 'not a package name' }],
    })
  })

  it('returns nothing for an error that carries no issues', () => {
    expect(extractIssues(new Error('network'))).toBeNull()
    expect(extractIssues({ body: { issues: 'nope' } })).toBeNull()
    expect(extractIssues(undefined)).toBeNull()
  })
})
