# Feature Specification: Namespace Resolution for Migrations

**Feature Branch**: `002-drizzle-namespace-fix`  
**Created**: 2026-01-23  
**Status**: Draft  
**Input**: User description: "figure out what the correct way to fix this problem with drizzle and unspecified namespace"

## Clarifications

### Session 2026-01-23

- Q: Default schema target → A: Configurable default with SQLUser fallback
- Q: Migration metadata schema → A: Keep metadata in its current schema
- Q: Explicit schemas → A: Honor explicit schemas

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run migrations without schema conflicts (Priority: P1)

As a developer running database migrations against the primary backend, I want unqualified schema references to resolve consistently so migrations complete without schema name conflicts.

**Why this priority**: Migrations must succeed for the primary backend stack to boot and for development workflows to continue.

**Independent Test**: Run migrations against the primary backend and verify they complete without schema errors.

**Acceptance Scenarios**:

1. **Given** a migration contains unqualified create-table statements, **When** migrations run against the primary backend, **Then** tables are created in the intended default schema without name conflicts.
2. **Given** a migration contains schema-qualified references to the default schema, **When** migrations run, **Then** they resolve to the same schema as unqualified references.

---

### User Story 2 - Consistent runtime schema resolution (Priority: P2)

As a developer using the primary backend, I want runtime queries with unqualified schema references to resolve to the same default schema as migrations.

**Why this priority**: Prevents runtime errors when queries or ORM-generated SQL omit schema names.

**Independent Test**: Start the primary backend stack and execute standard application flows that use unqualified tables.

**Acceptance Scenarios**:

1. **Given** runtime SQL omits schema names, **When** the application executes common queries, **Then** the queries resolve to the default schema without errors.

---

### User Story 3 - Maintain reference backend compatibility (Priority: P3)

As a developer running the reference backend stack, I want the namespace fix to avoid changing baseline behavior.

**Why this priority**: Keeps the reference backend as a stable baseline while enabling the primary backend.

**Independent Test**: Run the reference backend stack and ensure migrations and runtime queries behave as before.

**Acceptance Scenarios**:

1. **Given** the reference backend stack is running, **When** migrations run, **Then** schema behavior matches the current baseline.

---

### Edge Cases

- Migrations that mix qualified and unqualified schema references should still resolve to a single intended schema.
- Queries that reference alternate schemas should not be forced into the default schema.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST resolve unqualified schema references to a configurable default schema with SQLUser as the fallback for the primary backend.
- **FR-002**: The system MUST ensure migration-generated tables do not conflict with existing schema mappings on the primary backend while keeping migration metadata in its current schema.
- **FR-003**: The system MUST preserve existing schema behavior for the reference backend.
- **FR-004**: The system MUST apply consistent schema resolution for both migration and runtime SQL on the primary backend.
- **FR-005**: The system MUST honor explicitly provided schema names without remapping them to the default schema.

### Key Entities *(include if feature involves data)*

- **Default Schema**: The designated schema used when SQL does not specify a schema.
- **Migration Schema**: The schema where migration metadata is stored.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Primary backend migrations complete successfully without schema name conflict errors.
- **SC-002**: Core runtime flows (e.g., login, workspace creation) and migration smoke tests on the primary backend succeed without schema-related errors in 100% of cases.
- **SC-003**: Reference backend migrations complete with no change in schema behavior.

## Assumptions

- The primary backend should treat a configurable default schema as the target for unqualified SQL, with SQLUser as the fallback.
- The reference backend remains the baseline for expected schema behavior, including migration metadata schema placement.

## Dependencies

- The migration runner can apply a configurable default schema for unqualified statements.
