/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerToolContext } from '@/lib/copilot/tools/server/base-tool'
import type { InterfaceDefinition, InterfaceModule } from '@/lib/interfaces/types'

const {
  mockAddModule,
  mockCreateInterface,
  mockDeleteInterface,
  mockGetInterfaceById,
  mockListInterfaces,
  mockMoveModule,
  mockRecordAudit,
  mockRemoveModule,
  mockRenameInterface,
  mockRestoreInterface,
  mockUpdateInterfaceDescription,
  mockUpdateModuleConfig,
  mockGetUserEntityPermissions,
} = vi.hoisted(() => ({
  mockGetUserEntityPermissions: vi.fn(),
  mockAddModule: vi.fn(),
  mockCreateInterface: vi.fn(),
  mockDeleteInterface: vi.fn(),
  mockGetInterfaceById: vi.fn(),
  mockListInterfaces: vi.fn(),
  mockMoveModule: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockRemoveModule: vi.fn(),
  mockRenameInterface: vi.fn(),
  mockRestoreInterface: vi.fn(),
  mockUpdateInterfaceDescription: vi.fn(),
  mockUpdateModuleConfig: vi.fn(),
}))

/**
 * The tool narrows domain errors with `instanceof`, so the mocked barrel must
 * expose real classes rather than stubs.
 */
const { MockConflictError, MockLayoutError, MockReferenceError } = vi.hoisted(() => ({
  MockConflictError: class InterfaceConflictError extends Error {},
  MockLayoutError: class InterfaceLayoutError extends Error {},
  MockReferenceError: class InvalidModuleReferenceError extends Error {},
}))

vi.mock('@sim/utils/id', () => ({
  generateId: vi.fn().mockReturnValue('generated-id'),
  generateShortId: vi.fn().mockReturnValue('short-id'),
}))

vi.mock('@sim/audit', () => ({
  recordAudit: mockRecordAudit,
  AuditAction: {
    INTERFACE_CREATED: 'interface.created',
    INTERFACE_UPDATED: 'interface.updated',
    INTERFACE_DELETED: 'interface.deleted',
    INTERFACE_RESTORED: 'interface.restored',
  },
  AuditResourceType: { INTERFACE: 'interface' },
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('@/lib/interfaces', () => ({
  INTERFACE_MODULE_TYPES: ['chat', 'table', 'file', 'form'],
  FORM_FIELD_TYPES: ['short-text', 'long-text', 'dropdown', 'switch'],
  addModule: mockAddModule,
  createInterface: mockCreateInterface,
  deleteInterface: mockDeleteInterface,
  getInterfaceById: mockGetInterfaceById,
  listInterfaces: mockListInterfaces,
  moveModule: mockMoveModule,
  removeModule: mockRemoveModule,
  renameInterface: mockRenameInterface,
  restoreInterface: mockRestoreInterface,
  updateInterfaceDescription: mockUpdateInterfaceDescription,
  updateModuleConfig: mockUpdateModuleConfig,
  InterfaceConflictError: MockConflictError,
  InterfaceLayoutError: MockLayoutError,
  InvalidModuleReferenceError: MockReferenceError,
}))

import { userInterfaceServerTool } from '@/lib/copilot/tools/server/interfaces/user-interface'

const WORKSPACE_ID = 'workspace-1'
const USER_ID = 'user-1'

const context: ServerToolContext = { userId: USER_ID, workspaceId: WORKSPACE_ID }

function chatModule(id: string, row: 0 | 1, col: 0 | 1): InterfaceModule {
  return {
    id,
    type: 'chat',
    cell: { row, col },
    config: { workflowId: null, outputConfigs: [], showThinking: false, welcomeMessage: '' },
  }
}

function tableModule(id: string, row: 0 | 1, col: 0 | 1): InterfaceModule {
  return { id, type: 'table', cell: { row, col }, config: { tableId: null } }
}

function buildDefinition(overrides: Partial<InterfaceDefinition> = {}): InterfaceDefinition {
  return {
    id: 'int_1',
    workspaceId: WORKSPACE_ID,
    name: 'Support desk',
    description: null,
    layout: { version: 1, modules: [] },
    createdBy: USER_ID,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    archivedAt: null,
    ...overrides,
  }
}

function run(operation: string, args: Record<string, unknown> = {}, ctx = context) {
  return userInterfaceServerTool.execute({ operation, args }, ctx)
}

describe('userInterfaceServerTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetInterfaceById.mockResolvedValue(buildDefinition())
    mockGetUserEntityPermissions.mockResolvedValue('admin')
  })

  describe('guards', () => {
    it('throws when the caller is unauthenticated', async () => {
      await expect(userInterfaceServerTool.execute({ operation: 'list' })).rejects.toThrow(
        'Authentication required'
      )
    })

    it('fails softly without a workspace', async () => {
      const result = await run('list', {}, { userId: USER_ID })
      expect(result).toEqual({ success: false, message: 'Workspace ID is required' })
    })

    it('ignores a model-supplied workspaceId', async () => {
      const result = await run(
        'create',
        { workspaceId: 'workspace-2', name: 'Support desk' },
        { userId: USER_ID }
      )

      expect(result).toEqual({ success: false, message: 'Workspace ID is required' })
      expect(mockCreateInterface).not.toHaveBeenCalled()
    })

    it('denies a read operation to a caller with no workspace permission', async () => {
      mockGetUserEntityPermissions.mockResolvedValue(null)

      const result = await run('list')

      expect(mockGetUserEntityPermissions).toHaveBeenCalledWith(USER_ID, 'workspace', WORKSPACE_ID)
      expect(result.success).toBe(false)
      expect(result.message).toMatch(/requires read access/)
      expect(mockListInterfaces).not.toHaveBeenCalled()
    })

    it('denies a write operation to a read-only caller', async () => {
      mockGetUserEntityPermissions.mockResolvedValue('read')

      const result = await run('create', { name: 'Support desk' })

      expect(result.success).toBe(false)
      expect(result.message).toMatch(/requires write access/)
      expect(mockCreateInterface).not.toHaveBeenCalled()
    })

    it('rejects an unknown operation', async () => {
      const result = await run('teleport')
      expect(result).toEqual({ success: false, message: 'Unknown operation: teleport' })
    })

    it('does not mutate after the user pressed stop', async () => {
      const result = await run(
        'create',
        { name: 'Support desk' },
        {
          ...context,
          userStopSignal: AbortSignal.abort(),
        }
      )

      expect(result.success).toBe(false)
      expect(result.message).toMatch(/aborted/i)
      expect(mockCreateInterface).not.toHaveBeenCalled()
    })
  })

  describe('create', () => {
    it('creates an interface and records an audit entry', async () => {
      mockCreateInterface.mockResolvedValue(buildDefinition({ description: 'Triage' }))

      const result = await run('create', { name: 'Support desk', description: 'Triage' })

      expect(mockCreateInterface).toHaveBeenCalledWith({
        workspaceId: WORKSPACE_ID,
        name: 'Support desk',
        description: 'Triage',
        createdBy: USER_ID,
      })
      expect(result.success).toBe(true)
      expect(result.message).toContain('Created interface "Support desk"')
      expect(result.data?.interface).toEqual({
        id: 'int_1',
        name: 'Support desk',
        description: 'Triage',
        modules: [],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      })
      expect(mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'interface.created',
          resourceType: 'interface',
          resourceId: 'int_1',
          resourceName: 'Support desk',
          metadata: { source: 'tool_input' },
        })
      )
    })

    it('defaults an omitted description to null', async () => {
      mockCreateInterface.mockResolvedValue(buildDefinition())

      await run('create', { name: 'Support desk' })

      expect(mockCreateInterface).toHaveBeenCalledWith(
        expect.objectContaining({ description: null })
      )
    })

    it('requires a name', async () => {
      const result = await run('create', {})
      expect(result).toEqual({ success: false, message: 'name is required for create' })
      expect(mockCreateInterface).not.toHaveBeenCalled()
    })

    it('surfaces a name conflict verbatim', async () => {
      mockCreateInterface.mockRejectedValue(
        new MockConflictError('An interface named "Support desk" already exists in this workspace')
      )

      const result = await run('create', { name: 'Support desk' })

      expect(result).toEqual({
        success: false,
        message: 'An interface named "Support desk" already exists in this workspace',
      })
    })

    it('wraps an unexpected failure', async () => {
      mockCreateInterface.mockRejectedValue(new Error('connection reset'))

      const result = await run('create', { name: 'Support desk' })

      expect(result).toEqual({ success: false, message: 'Operation failed: connection reset' })
    })
  })

  describe('get', () => {
    it('returns the full module layout', async () => {
      const modules = [chatModule('mod_1', 0, 0), tableModule('mod_2', 0, 1)]
      mockGetInterfaceById.mockResolvedValue(buildDefinition({ layout: { version: 1, modules } }))

      const result = await run('get', { interfaceId: 'int_1' })

      expect(result.success).toBe(true)
      expect(result.message).toBe('Interface "Support desk" has 2 module(s)')
      expect(result.data?.interface).toEqual(expect.objectContaining({ modules }))
    })

    it('hides interfaces belonging to another workspace', async () => {
      mockGetInterfaceById.mockResolvedValue(buildDefinition({ workspaceId: 'workspace-2' }))

      const result = await run('get', { interfaceId: 'int_1' })

      expect(result.success).toBe(false)
      expect(result.message).toContain('Interface not found: int_1')
    })

    it('reports a missing interface', async () => {
      mockGetInterfaceById.mockResolvedValue(null)

      const result = await run('get', { interfaceId: 'int_missing' })

      expect(result.success).toBe(false)
      expect(result.message).toContain('Interface not found: int_missing')
    })

    it('requires an interfaceId', async () => {
      const result = await run('get', {})
      expect(result).toEqual({ success: false, message: 'interfaceId is required for get' })
    })
  })

  describe('list', () => {
    it('summarizes the workspace interfaces', async () => {
      mockListInterfaces.mockResolvedValue([
        buildDefinition({ layout: { version: 1, modules: [chatModule('mod_1', 0, 0)] } }),
        buildDefinition({ id: 'int_2', name: 'Ops board', description: 'Runbooks' }),
      ])

      const result = await run('list')

      expect(mockListInterfaces).toHaveBeenCalledWith(WORKSPACE_ID)
      expect(result.message).toBe('Found 2 interface(s)')
      expect(result.data).toEqual({
        count: 2,
        interfaces: [
          {
            id: 'int_1',
            name: 'Support desk',
            description: null,
            moduleCount: 1,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-02T00:00:00.000Z',
          },
          {
            id: 'int_2',
            name: 'Ops board',
            description: 'Runbooks',
            moduleCount: 0,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-02T00:00:00.000Z',
          },
        ],
      })
    })

    it('reports an empty workspace', async () => {
      mockListInterfaces.mockResolvedValue([])

      const result = await run('list')

      expect(result).toEqual({
        success: true,
        message: 'No interfaces in this workspace yet',
        data: { count: 0, interfaces: [] },
      })
    })
  })

  describe('rename and set_description', () => {
    it('renames and audits the change', async () => {
      mockRenameInterface.mockResolvedValue(buildDefinition({ name: 'Front desk' }))

      const result = await run('rename', { interfaceId: 'int_1', name: 'Front desk' })

      expect(mockRenameInterface).toHaveBeenCalledWith('int_1', 'Front desk')
      expect(result.message).toBe('Renamed interface to "Front desk"')
      expect(mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'interface.updated',
          description: 'Renamed interface "Support desk" to "Front desk"',
        })
      )
    })

    it('requires the new name', async () => {
      const result = await run('rename', { interfaceId: 'int_1' })
      expect(result).toEqual({ success: false, message: 'name is required for rename' })
      expect(mockRenameInterface).not.toHaveBeenCalled()
    })

    it('sets a description', async () => {
      mockUpdateInterfaceDescription.mockResolvedValue(buildDefinition({ description: 'Triage' }))

      const result = await run('set_description', { interfaceId: 'int_1', description: 'Triage' })

      expect(mockUpdateInterfaceDescription).toHaveBeenCalledWith('int_1', 'Triage')
      expect(result.message).toBe('Updated description of interface "Support desk"')
    })

    it('clears the description on an empty string', async () => {
      mockUpdateInterfaceDescription.mockResolvedValue(buildDefinition())

      const result = await run('set_description', { interfaceId: 'int_1', description: '   ' })

      expect(mockUpdateInterfaceDescription).toHaveBeenCalledWith('int_1', null)
      expect(result.message).toBe('Cleared description of interface "Support desk"')
    })

    it('requires a description argument', async () => {
      const result = await run('set_description', { interfaceId: 'int_1' })
      expect(result).toEqual({
        success: false,
        message: 'description is required for set_description',
      })
    })
  })

  describe('delete and restore', () => {
    it('archives the interface', async () => {
      const result = await run('delete', { interfaceId: 'int_1' })

      expect(mockDeleteInterface).toHaveBeenCalledWith('int_1')
      expect(result.success).toBe(true)
      expect(result.data).toEqual({ interfaceId: 'int_1', name: 'Support desk' })
      expect(mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'interface.deleted' })
      )
    })

    it('restores an archived interface', async () => {
      mockGetInterfaceById.mockResolvedValue(
        buildDefinition({ archivedAt: '2024-02-01T00:00:00.000Z' })
      )
      mockRestoreInterface.mockResolvedValue(buildDefinition())

      const result = await run('restore', { interfaceId: 'int_1' })

      expect(mockGetInterfaceById).toHaveBeenCalledWith('int_1', { includeArchived: true })
      expect(mockRestoreInterface).toHaveBeenCalledWith('int_1')
      expect(result.message).toBe('Restored interface "Support desk"')
      expect(mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'interface.restored' })
      )
    })

    it('reports the suffixed name when the original was taken', async () => {
      mockGetInterfaceById.mockResolvedValue(
        buildDefinition({ archivedAt: '2024-02-01T00:00:00.000Z' })
      )
      mockRestoreInterface.mockResolvedValue(buildDefinition({ name: 'Support desk (restored)' }))

      const result = await run('restore', { interfaceId: 'int_1' })

      expect(result.message).toBe(
        'Restored interface as "Support desk (restored)" (the original name was taken)'
      )
    })

    it('refuses to restore an active interface', async () => {
      const result = await run('restore', { interfaceId: 'int_1' })

      expect(result).toEqual({
        success: false,
        message: 'Interface "Support desk" is not archived',
      })
      expect(mockRestoreInterface).not.toHaveBeenCalled()
    })
  })

  describe('add_module', () => {
    it('adds a module with the type defaults when no config is sent', async () => {
      mockAddModule.mockResolvedValue({
        definition: buildDefinition({
          layout: { version: 1, modules: [tableModule('mod_1', 0, 1)] },
        }),
        moduleId: 'mod_1',
      })

      const result = await run('add_module', {
        interfaceId: 'int_1',
        moduleType: 'table',
        cell: { row: 0, col: 1 },
      })

      expect(mockAddModule).toHaveBeenCalledWith('int_1', {
        type: 'table',
        cell: { row: 0, col: 1 },
        config: undefined,
      })
      expect(result.message).toBe('Added table module mod_1 at cell (0, 1) on "Support desk"')
      expect(result.data?.moduleId).toBe('mod_1')
    })

    it('fills absent chat config fields with the type defaults', async () => {
      mockAddModule.mockResolvedValue({ definition: buildDefinition(), moduleId: 'mod_1' })

      await run('add_module', {
        interfaceId: 'int_1',
        moduleType: 'chat',
        cell: { row: 0, col: 0 },
        config: { workflowId: 'wf_1' },
      })

      expect(mockAddModule).toHaveBeenCalledWith('int_1', {
        type: 'chat',
        cell: { row: 0, col: 0 },
        config: {
          workflowId: 'wf_1',
          outputConfigs: [],
          showThinking: false,
          welcomeMessage: '',
        },
      })
    })

    it('normalizes chat output configs', async () => {
      mockAddModule.mockResolvedValue({ definition: buildDefinition(), moduleId: 'mod_1' })

      await run('add_module', {
        interfaceId: 'int_1',
        moduleType: 'chat',
        cell: { row: 0, col: 0 },
        config: {
          workflowId: 'wf_1',
          outputConfigs: [{ blockId: 'blk_1', path: 'content' }, { blockId: 'blk_2' }],
          showThinking: true,
          welcomeMessage: 'Hi',
        },
      })

      expect(mockAddModule).toHaveBeenCalledWith(
        'int_1',
        expect.objectContaining({
          config: expect.objectContaining({
            outputConfigs: [
              { blockId: 'blk_1', path: 'content' },
              { blockId: 'blk_2', path: '' },
            ],
            showThinking: true,
            welcomeMessage: 'Hi',
          }),
        })
      )
    })

    it('generates ids for new form fields and keeps supplied ones', async () => {
      mockAddModule.mockResolvedValue({ definition: buildDefinition(), moduleId: 'mod_1' })

      await run('add_module', {
        interfaceId: 'int_1',
        moduleType: 'form',
        cell: { row: 1, col: 0 },
        config: {
          workflowId: 'wf_1',
          fields: [
            { name: 'email', label: 'Email', type: 'short-text', required: true },
            { id: 'field_kept', name: 'tier', type: 'dropdown', options: ['free', 2] },
          ],
        },
      })

      expect(mockAddModule).toHaveBeenCalledWith('int_1', {
        type: 'form',
        cell: { row: 1, col: 0 },
        config: {
          workflowId: 'wf_1',
          submitLabel: 'Submit',
          fields: [
            {
              id: 'generated-id',
              name: 'email',
              label: 'Email',
              type: 'short-text',
              required: true,
            },
            {
              id: 'field_kept',
              name: 'tier',
              label: 'tier',
              type: 'dropdown',
              required: false,
              options: ['free', '2'],
            },
          ],
        },
      })
    })

    it('falls back to the default submit label when the model sends a blank string', async () => {
      mockAddModule.mockResolvedValue({ definition: buildDefinition(), moduleId: 'mod_1' })

      await run('add_module', {
        interfaceId: 'int_1',
        moduleType: 'form',
        cell: { row: 0, col: 0 },
        config: { workflowId: 'wf_1', fields: [], submitLabel: '   ' },
      })

      expect(mockAddModule).toHaveBeenCalledWith(
        'int_1',
        expect.objectContaining({
          config: expect.objectContaining({ submitLabel: 'Submit' }),
        })
      )
    })

    it('rejects an out-of-range cell', async () => {
      const result = await run('add_module', {
        interfaceId: 'int_1',
        moduleType: 'chat',
        cell: { row: 2, col: 0 },
      })

      expect(result).toEqual({
        success: false,
        message: 'cell.row and cell.col must each be 0 or 1',
      })
      expect(mockAddModule).not.toHaveBeenCalled()
    })

    it('rejects an unknown module type', async () => {
      const result = await run('add_module', {
        interfaceId: 'int_1',
        moduleType: 'kanban',
        cell: { row: 0, col: 0 },
      })

      expect(result.success).toBe(false)
      expect(result.message).toContain('moduleType is required for add_module')
    })

    it('rejects an unknown form field type', async () => {
      const result = await run('add_module', {
        interfaceId: 'int_1',
        moduleType: 'form',
        cell: { row: 0, col: 0 },
        config: { fields: [{ name: 'email', type: 'rich-text' }] },
      })

      expect(result.success).toBe(false)
      expect(result.message).toContain('config.fields[0].type must be one of')
    })

    it('surfaces a layout validation failure verbatim', async () => {
      mockAddModule.mockRejectedValue(
        new MockLayoutError('Cell (0, 0) is already occupied by module "mod_1"')
      )

      const result = await run('add_module', {
        interfaceId: 'int_1',
        moduleType: 'chat',
        cell: { row: 0, col: 0 },
      })

      expect(result).toEqual({
        success: false,
        message: 'Cell (0, 0) is already occupied by module "mod_1"',
      })
    })

    it('surfaces a cross-workspace reference failure verbatim', async () => {
      mockAddModule.mockRejectedValue(
        new MockReferenceError('Workflow "wf_9" referenced by module "mod_1" was not found')
      )

      const result = await run('add_module', {
        interfaceId: 'int_1',
        moduleType: 'chat',
        cell: { row: 0, col: 0 },
        config: { workflowId: 'wf_9' },
      })

      expect(result).toEqual({
        success: false,
        message: 'Workflow "wf_9" referenced by module "mod_1" was not found',
      })
    })
  })

  describe('update_module', () => {
    beforeEach(() => {
      mockGetInterfaceById.mockResolvedValue(
        buildDefinition({ layout: { version: 1, modules: [tableModule('mod_1', 0, 0)] } })
      )
    })

    it('replaces the config using the module type on record', async () => {
      mockUpdateModuleConfig.mockResolvedValue(buildDefinition())

      const result = await run('update_module', {
        interfaceId: 'int_1',
        moduleId: 'mod_1',
        config: { tableId: 'tbl_1' },
      })

      expect(mockUpdateModuleConfig).toHaveBeenCalledWith('int_1', 'mod_1', { tableId: 'tbl_1' })
      expect(result.message).toBe('Updated table module mod_1 on "Support desk"')
      expect(mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'interface.updated' })
      )
    })

    it('requires a config', async () => {
      const result = await run('update_module', { interfaceId: 'int_1', moduleId: 'mod_1' })

      expect(result.success).toBe(false)
      expect(result.message).toContain('config is required for update_module')
      expect(mockUpdateModuleConfig).not.toHaveBeenCalled()
    })

    it('lists the available modules when the id is wrong', async () => {
      const result = await run('update_module', {
        interfaceId: 'int_1',
        moduleId: 'mod_missing',
        config: { tableId: 'tbl_1' },
      })

      expect(result.success).toBe(false)
      expect(result.message).toBe(
        'Module not found: mod_missing. Interface "Support desk" has mod_1 (table).'
      )
    })

    it('rejects an ill-typed config field', async () => {
      const result = await run('update_module', {
        interfaceId: 'int_1',
        moduleId: 'mod_1',
        config: { tableId: 42 },
      })

      expect(result).toEqual({
        success: false,
        message: 'config.tableId must be a string or null',
      })
    })
  })

  describe('move_module and remove_module', () => {
    beforeEach(() => {
      mockGetInterfaceById.mockResolvedValue(
        buildDefinition({
          layout: {
            version: 1,
            modules: [chatModule('mod_1', 0, 0), tableModule('mod_2', 0, 1)],
          },
        })
      )
    })

    it('moves a module to an empty cell', async () => {
      mockMoveModule.mockResolvedValue(buildDefinition())

      const result = await run('move_module', {
        interfaceId: 'int_1',
        moduleId: 'mod_1',
        cell: { row: 1, col: 1 },
      })

      expect(mockMoveModule).toHaveBeenCalledWith('int_1', 'mod_1', { row: 1, col: 1 })
      expect(result.message).toBe('Moved module mod_1 to cell (1, 1) on "Support desk"')
    })

    it('reports the swap when the target cell is occupied', async () => {
      mockMoveModule.mockResolvedValue(buildDefinition())

      const result = await run('move_module', {
        interfaceId: 'int_1',
        moduleId: 'mod_1',
        cell: { row: 0, col: 1 },
      })

      expect(result.message).toBe(
        'Moved module mod_1 to cell (0, 1) on "Support desk", swapping with module mod_2'
      )
    })

    it('requires a cell', async () => {
      const result = await run('move_module', { interfaceId: 'int_1', moduleId: 'mod_1' })

      expect(result.success).toBe(false)
      expect(result.message).toContain('cell is required for move_module')
      expect(mockMoveModule).not.toHaveBeenCalled()
    })

    it('removes a module', async () => {
      mockRemoveModule.mockResolvedValue(buildDefinition())

      const result = await run('remove_module', { interfaceId: 'int_1', moduleId: 'mod_2' })

      expect(mockRemoveModule).toHaveBeenCalledWith('int_1', 'mod_2')
      expect(result.message).toBe('Removed table module mod_2 from "Support desk"')
      expect(mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'interface.updated',
          description: 'Removed a table module from interface "Support desk"',
        })
      )
    })

    it('rejects a module that is not on the interface', async () => {
      const result = await run('remove_module', { interfaceId: 'int_1', moduleId: 'mod_9' })

      expect(result.success).toBe(false)
      expect(result.message).toContain('Module not found: mod_9')
      expect(mockRemoveModule).not.toHaveBeenCalled()
    })
  })
})
