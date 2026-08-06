/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createSandboxBodySchema,
  sandboxSchema,
  sandboxValidationErrorSchema,
  updateSandboxBodySchema,
} from '@/lib/api/contracts/sandboxes'
import {
  MAX_SANDBOX_CLI_TOOLS,
  SANDBOX_CLI_TOOL_IDS,
} from '@/lib/execution/remote-sandbox/cli-tools'

const CLI_ID = 'google-cloud-cli@577.0.0-r1' as const

describe('sandbox CLI contract', () => {
  it('accepts a curated immutable recipe id', () => {
    expect(
      createSandboxBodySchema.safeParse({
        name: 'bigquery',
        language: 'python',
        dependencies: [],
        cliTools: [CLI_ID],
      }).success
    ).toBe(true)
  })

  it.each(SANDBOX_CLI_TOOL_IDS)('accepts catalog id %s', (cliTool) => {
    expect(
      createSandboxBodySchema.safeParse({
        name: 'managed-cli',
        language: 'javascript',
        dependencies: [],
        cliTools: [cliTool],
      }).success
    ).toBe(true)
  })

  it('rejects duplicate CLI ids instead of silently deduplicating them', () => {
    const result = createSandboxBodySchema.safeParse({
      name: 'bigquery',
      language: 'python',
      dependencies: [],
      cliTools: [CLI_ID, CLI_ID],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes('duplicates'))).toBe(true)
    }
  })

  it('rejects CLI ids that are not in the curated catalog', () => {
    const result = createSandboxBodySchema.safeParse({
      name: 'bigquery',
      language: 'python',
      dependencies: [],
      cliTools: ['google-cloud-cli@latest'],
    })

    expect(result.success).toBe(false)
  })

  it('enforces the maximum number of submitted CLI ids', () => {
    const result = createSandboxBodySchema.safeParse({
      name: 'bigquery',
      language: 'python',
      dependencies: [],
      cliTools: Array.from({ length: MAX_SANDBOX_CLI_TOOLS + 1 }, () => CLI_ID),
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          issue.message.includes(`at most ${MAX_SANDBOX_CLI_TOOLS}`)
        )
      ).toBe(true)
    }
  })
})

describe('sandbox system package contract', () => {
  it('accepts free-form package coordinates and defaults an omitted list', () => {
    const result = createSandboxBodySchema.safeParse({
      name: 'utilities',
      language: 'python',
      dependencies: [],
      systemPackages: ['jq', 'postgresql-client=16+257build1.1'],
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.systemPackages).toEqual(['jq', 'postgresql-client=16+257build1.1'])
      expect(result.data.cliTools).toEqual([])
    }

    const defaulted = createSandboxBodySchema.parse({
      name: 'default',
      language: 'javascript',
      dependencies: [],
    })
    expect(defaulted.systemPackages).toEqual([])
  })

  it('structurally bounds submitted package lines', () => {
    expect(
      createSandboxBodySchema.safeParse({
        name: 'too-long',
        language: 'python',
        dependencies: [],
        systemPackages: ['x'.repeat(2001)],
      }).success
    ).toBe(false)

    expect(
      createSandboxBodySchema.safeParse({
        name: 'too-many',
        language: 'python',
        dependencies: [],
        systemPackages: Array.from({ length: 1001 }, () => 'jq'),
      }).success
    ).toBe(false)
  })

  it('allows a system-package-only update', () => {
    expect(updateSandboxBodySchema.safeParse({ systemPackages: ['jq'] }).success).toBe(true)
    expect(updateSandboxBodySchema.safeParse({}).success).toBe(false)
  })

  it('defaults new package fields when parsing a response from an older API task', () => {
    const base = {
      id: 'sandbox-1',
      name: 'utilities',
      language: 'python' as const,
      dependencies: [],
      buildStatus: null,
      errorCode: null,
      errorMessage: null,
      errorDetail: null,
      builtAt: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }

    expect(sandboxSchema.parse(base)).toMatchObject({ cliTools: [], systemPackages: [] })
    expect(sandboxSchema.parse({ ...base, systemPackages: ['jq'] }).systemPackages).toEqual(['jq'])
  })

  it('addresses package validation issues to their input field', () => {
    expect(
      sandboxValidationErrorSchema.safeParse({
        error: 'Invalid system package list',
        issueField: 'systemPackages',
        issues: [{ line: 2, value: '--force', reason: 'flags are not allowed' }],
      }).success
    ).toBe(true)
    expect(
      sandboxValidationErrorSchema.safeParse({
        error: 'Invalid system package list',
        issueField: 'unknown',
        issues: [],
      }).success
    ).toBe(false)
  })
})
