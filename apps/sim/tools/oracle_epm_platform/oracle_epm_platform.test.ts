/** @vitest-environment node */
import { toolsMetadataMock, toolsUtilsMock } from '@sim/testing/mocks'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/blocks', async () => {
  const { OracleEpmPlatformBlock } = await import('@/blocks/blocks/oracle_epm_platform')
  return {
    getBlock: (type: string) =>
      type === 'oracle_epm_platform' ? OracleEpmPlatformBlock : undefined,
  }
})
vi.mock('@/tools/metadata', () => toolsMetadataMock)
vi.mock('@/tools/utils', () => toolsUtilsMock)

import { NetSuiteIcon } from '@/components/icons'
import { inputSchemas } from '@/lib/internal/oracle-epm-platform/schemas'
import {
  getInternalToolOperationHandler,
  isInternalToolOperationRegistered,
} from '@/lib/internal/tool-operations/registry.server'
import {
  buildCanonicalIndex,
  evaluateSubBlockCondition,
} from '@/lib/workflows/subblocks/visibility'
import { OracleEpmPlatformBlock as block } from '@/blocks/blocks/oracle_epm_platform'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { extractBlockParams } from '@/serializer'
import type { BlockState } from '@/stores/workflows/workflow/types'
import toolMetadata from '@/tools/generated/tool-metadata'
import * as toolExports from '@/tools/oracle_epm_platform'
import { hasToolId } from '@/tools/tool-ids'
import type { InternalToolConfig } from '@/tools/types'

const suffixes = [
  'get_environment_info',
  'get_idle_session_timeout',
  'set_idle_session_timeout',
  'set_maintenance_window',
  'run_daily_maintenance',
  'get_restricted_data_access',
  'set_restricted_data_access',
  'get_upload_virus_scan',
  'set_upload_virus_scan',
  'list_users',
  'create_users',
  'update_users',
  'delete_users',
  'list_groups',
  'create_groups',
  'delete_groups',
  'add_users_to_group',
  'remove_users_from_group',
  'list_roles',
  'assign_role',
  'unassign_role',
  'get_role_assignments',
  'get_user_group_report',
  'list_files',
  'delete_file',
  'upload_repository_file',
  'download_file',
  'get_snapshot',
  'export_snapshot',
  'import_snapshot',
  'rename_snapshot',
  'list_migrations',
  'upload_snapshot',
  'get_admin_job_status',
]
const ids = suffixes.map((suffix) => `oracle_epm_platform_${suffix}`)
const tools = Object.values(toolExports) as InternalToolConfig[]
const file = {
  id: 'file-1',
  name: 'source.zip',
  url: '',
  key: 'workspace/source.zip',
  context: 'workspace',
  size: 3,
  type: 'application/zip',
}

function params(input: Record<string, unknown>) {
  const map = block.tools.config.params
  if (!map) throw new Error('Missing params mapper')
  return { ...input, ...map(input) }
}
function serialized(
  values: Record<string, unknown>,
  canonicalModes: Record<string, 'basic' | 'advanced'> = {}
) {
  const state = {
    id: 'epm',
    type: block.type,
    name: block.name,
    enabled: true,
    position: { x: 0, y: 0 },
    outputs: {},
    subBlocks: Object.fromEntries(
      block.subBlocks.map((sub) => [
        sub.id,
        { id: sub.id, type: sub.type, value: values[sub.id] ?? sub.defaultValue ?? null },
      ])
    ),
    data: { canonicalModes },
  } as BlockState
  return extractBlockParams(state)
}

describe('Oracle EPM Platform integration surface', () => {
  it('exposes exactly the agreed 34 operations in the block, tool catalog, and operation registry', async () => {
    expect(ids).toHaveLength(34)
    expect(tools.map((tool) => tool.id).sort()).toEqual([...ids].sort())
    expect([...block.tools.access].sort()).toEqual([...ids].sort())
    const dropdown = block.subBlocks.find((sub) => sub.id === 'operation')
    expect(dropdown?.options?.map((option) => option.id).sort()).toEqual([...ids].sort())
    for (const id of ids) {
      expect(block.tools.config.tool({ operation: id })).toBe(id)
      expect(hasToolId(id), id).toBe(true)
      expect(isInternalToolOperationRegistered(id), id).toBe(true)
      expect(await getInternalToolOperationHandler(id), id).toBeTypeOf('function')
      expect((toolMetadata as Record<string, unknown>)[id], id).toBeDefined()
    }
  })

  it('uses the existing Oracle oval and the service-account API-key catalog pattern', () => {
    expect(block.icon).toBe(NetSuiteIcon)
    expect(block.authMode).toBe(AuthMode.ApiKey)
    expect(block.integrationType).toBe(IntegrationType.Security)
    expect(block.subBlocks.find((sub) => sub.id === 'credential')).toMatchObject({
      type: 'oauth-input',
      serviceId: 'oracle-epm-platform',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
    })
  })

  it.each([
    ['fileName', 'oracle_epm_platform_download_file'],
    ['snapshotName', 'oracle_epm_platform_export_snapshot'],
    ['groupname', 'oracle_epm_platform_add_users_to_group'],
    ['rolename', 'oracle_epm_platform_assign_role'],
  ])('%s selectors have a working advanced manual alternative', (canonicalId, operation) => {
    const group = buildCanonicalIndex(block.subBlocks).groupsById[canonicalId]
    expect(group.basicId).toBeDefined()
    expect(group.advancedIds).toHaveLength(1)
    const values = {
      operation,
      credential: 'credential-1',
      [group.basicId!]: 'Selected value',
      [group.advancedIds[0]]: '<previous.value>',
    }
    expect(serialized(values, { [canonicalId]: 'basic' })[canonicalId]).toBe('Selected value')
    expect(serialized(values, { [canonicalId]: 'advanced' })[canonicalId]).toBe('<previous.value>')
    const selector = block.subBlocks.find((sub) => sub.id === group.basicId)!
    expect(selector.dependsOn).toEqual(expect.arrayContaining(['credential', 'manualCredential']))
  })

  it('keeps references intact during serialization and normalizes only resolved execution inputs', async () => {
    const result = await Response.json(
      serialized(
        {
          operation: 'oracle_epm_platform_upload_snapshot',
          credential: 'credential-1',
          snapshotFileUpload: [file],
          snapshotFileReference: '<previous.file>',
          uploadSnapshotName: '<previous.name>',
        },
        { snapshotFile: 'advanced' }
      )
    ).json()
    expect(result.snapshotFile).toBe('<previous.file>')
    expect(result.snapshotName).toBeUndefined()
    expect(result.uploadSnapshotName).toBe('<previous.name>')
    const resolved = params({ ...result, snapshotFile: [file], uploadSnapshotName: 'new.zip' })
    expect(resolved.file).toEqual(file)
    expect(resolved.snapshotName).toBe('new.zip')
    expect(resolved).not.toHaveProperty('snapshotFileReference')
  })

  it('normalizes basic repository uploads and preserves the intended destination name', () => {
    const result = serialized(
      {
        operation: 'oracle_epm_platform_upload_repository_file',
        credential: 'credential-1',
        repositoryFileUpload: [file],
        uploadFileName: 'inbox/source.zip',
      },
      { repositoryFile: 'basic' }
    )
    expect(params(result)).toMatchObject({
      file,
      fileName: 'inbox/source.zip',
      oauthCredential: 'credential-1',
    })
  })

  it('preserves bulk JSON references until execution, then parses arrays and coerces strings', () => {
    const result = serialized({
      operation: 'oracle_epm_platform_create_users',
      credential: 'credential-1',
      users: '<previous.users>',
    })
    expect(result.users).toBe('<previous.users>')
    const users = [
      { userlogin: 'new', lastname: 'User', email: 'new@example.com', resetpassword: true },
    ]
    expect(params({ ...result, users: JSON.stringify(users) }).users).toEqual(users)
    expect(
      params({ operation: 'oracle_epm_platform_set_idle_session_timeout', timeoutMinutes: '30' })
        .timeoutMinutes
    ).toBe(30)
    expect(
      params({ operation: 'oracle_epm_platform_set_upload_virus_scan', enabled: 'false' }).enabled
    ).toBe(false)
    expect(() => params({ operation: 'oracle_epm_platform_create_users', users: '{}' })).toThrow(
      'JSON array'
    )
  })

  it('drops dormant password controls unless importing users is explicitly enabled', () => {
    expect(
      params({
        operation: 'oracle_epm_platform_import_snapshot',
        importUsers: 'false',
        userPassword: 'dormant-secret',
        resetPassword: 'false',
      })
    ).toMatchObject({ importUsers: false, userPassword: undefined, resetPassword: undefined })
    expect(
      params({ operation: 'oracle_epm_platform_import_snapshot', importUsers: 'true' })
    ).toMatchObject({
      importUsers: true,
      resetPassword: true,
    })
  })

  it('uses a groups example accepted for both creating and deleting groups', () => {
    const groups = JSON.parse(block.subBlocks.find((sub) => sub.id === 'groups')!.placeholder!)
    const auth = {
      oauthCredential: 'credential',
      accessToken: 'token',
      instanceUrl: 'https://epm.example.com',
    }
    expect(inputSchemas.create_groups.safeParse({ ...auth, groups }).success).toBe(true)
    expect(inputSchemas.delete_groups.safeParse({ ...auth, groups }).success).toBe(true)
  })

  it('serializes boolean defaults without enabling maintenance skipping, imports, or waiting', () => {
    const defaults = (operation: string) =>
      params(serialized({ operation, credential: 'credential-1' }))
    expect(defaults('oracle_epm_platform_run_daily_maintenance').skipNext).toBe(false)
    expect(defaults('oracle_epm_platform_import_snapshot').importUsers).toBe(false)
    expect(defaults('oracle_epm_platform_get_admin_job_status').waitForCompletion).toBe(false)
  })

  it('shows only operation-relevant file fields and enforces different input limits', () => {
    const repository = block.subBlocks.find((sub) => sub.id === 'repositoryFileUpload')!
    const snapshot = block.subBlocks.find((sub) => sub.id === 'snapshotFileUpload')!
    expect(repository.maxSize).toBe(100)
    expect(snapshot.maxSize).toBe(5120)
    expect(
      evaluateSubBlockCondition(repository.condition, {
        operation: 'oracle_epm_platform_upload_snapshot',
      })
    ).toBe(false)
    expect(
      evaluateSubBlockCondition(snapshot.condition, {
        operation: 'oracle_epm_platform_upload_repository_file',
      })
    ).toBe(false)
  })
})
