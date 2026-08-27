/**
 * @vitest-environment node
 *
 * Verified against https://vault.googleapis.com/$discovery/rest?version=v1:
 *
 * - `AddMatterPermissionsRequest`: "Add an account with the permission specified. The role cannot
 *   be owner." `OWNER` is on the `MatterPermission.role` resource enum (the read side) only, so
 *   the request surface must not offer it.
 * - `matters.delete`: "Deletes the specified matter. Returns the matter with updated state." The
 *   response is `$ref: Matter`, `Matter.state` includes `DELETED`, and `matters.undelete` exists
 *   — so it is a reversible soft delete, not a permanent one.
 */
import { describe, expect, it } from 'vitest'
import { GoogleVaultBlock } from '@/blocks/blocks/google_vault'
import { addMattersPermissionsTool } from '@/tools/google_vault/add_matters_permissions'
import { deleteMattersTool } from '@/tools/google_vault/delete_matters'

/** Every string the block renders in the canvas sentence for one operation. */
function canvasSentenceFor(operation: string): string {
  const byOperation = (GoogleVaultBlock.canvasPresentation?.sentences as any)?.byOperation ?? {}
  const entries = byOperation[operation] ?? []
  expect(entries.length).toBeGreaterThan(0)
  return entries
    .map((entry: unknown) => (typeof entry === 'string' ? entry : ((entry as any)?.text ?? '')))
    .join(' ')
}

describe('the matter-permission surface does not offer the role the API refuses', () => {
  it('the block role dropdown lists COLLABORATOR only', () => {
    const subBlock = GoogleVaultBlock.subBlocks.find((entry) => entry.id === 'role')
    expect(subBlock).toBeDefined()

    const ids = (subBlock?.options as Array<{ id: string }>).map((option) => option.id)
    expect(ids).toEqual(['COLLABORATOR'])
  })

  it('the role param description does not advertise OWNER', () => {
    const description = addMattersPermissionsTool.params.role.description ?? ''

    expect(description).toContain('COLLABORATOR')
    expect(description.toUpperCase()).not.toContain('OWNER')
  })

  it('the block role input description does not advertise OWNER', () => {
    const description = (GoogleVaultBlock.inputs as any).role?.description ?? ''

    expect(description.toUpperCase()).not.toContain('OWNER')
  })

  it('the tool description does not promise ownership transfer', () => {
    expect(addMattersPermissionsTool.description.toLowerCase()).not.toContain('owner')
  })
})

describe('deleting a matter is described as the reversible soft delete it is', () => {
  it('the tool description does not call the delete permanent', () => {
    const description = deleteMattersTool.description.toLowerCase()

    expect(description).not.toContain('permanent')
  })

  it('the block canvas sentence does not call the delete permanent', () => {
    expect(canvasSentenceFor('delete_matters').toLowerCase()).not.toContain('permanent')
  })

  it('the block still exposes the undelete operation that makes it reversible', () => {
    const operation = GoogleVaultBlock.subBlocks.find((entry) => entry.id === 'operation')
    const ids = (operation?.options as Array<{ id: string }>).map((option) => option.id)

    expect(ids).toContain('undelete_matters')
  })
})
