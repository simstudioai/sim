import type { createTableDefinition } from '@sim/testing'
import type { TableDefinition } from '@/lib/table/types'

/**
 * Compile-time tie between the shared table fixture and the domain type it stands in for.
 *
 * `createTableDefinition` returns a `TableDefinitionFixture` declared inside `@sim/testing`,
 * which cannot import from the apps workspace, so the two shapes are only structurally
 * related. The fixture then flows into untyped `vi.fn().mockResolvedValue(...)` calls, which
 * erase the type entirely — and `tsconfig.json` excludes test files, so no assertion placed
 * in one would ever be checked. Without this probe a new required field on
 * {@link TableDefinition} is a production type error and a silent no-op across every route
 * test, leaving them to exercise a table shape that no longer exists.
 *
 * Type-only by construction: `@sim/testing` is a devDependency, so this file must never emit
 * a runtime import.
 */
type AssertAssignableToTableDefinition<T extends TableDefinition> = T

export type TableFixtureMatchesDomainType = AssertAssignableToTableDefinition<
  ReturnType<typeof createTableDefinition>
>
