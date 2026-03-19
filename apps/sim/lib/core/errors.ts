/**
 * Thrown when a create/rename operation would violate a workspace-scoped
 * unique name constraint (e.g. tables, knowledge bases, files).
 */
export class DuplicateNameError extends Error {
  constructor(entity: string, name: string) {
    super(`A ${entity} named "${name}" already exists in this workspace`)
  }
}
