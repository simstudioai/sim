---
description: "Task list for namespace resolution"
---

# Tasks: Namespace Resolution for Migrations

**Input**: Design documents from `/specs/002-drizzle-namespace-fix/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: Not requested in the feature specification.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm current schema resolution touchpoints.

- [ ] T001 Inventory current schema resolution code paths in packages/db/index.ts and packages/db/drizzle.config.ts
- [ ] T002 Inventory IRIS schema translation touchpoints in iris/sim_sql_patch.py and iris/patch_pgwire_protocol.py

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Define configurable default schema inputs and shared environment wiring.

- [ ] T003 Add DB_DEFAULT_SCHEMA and DB_METADATA_SCHEMA entries to apps/sim/.env.example
- [ ] T004 Add DB_DEFAULT_SCHEMA and DB_METADATA_SCHEMA entries to packages/db/.env.example
- [ ] T005 Update apps/sim/lib/core/config/env.ts to surface DB_DEFAULT_SCHEMA and DB_METADATA_SCHEMA
- [ ] T006 Update packages/db/index.ts to read DB_DEFAULT_SCHEMA/DB_METADATA_SCHEMA and default to SQLUser and current metadata schema
- [ ] T006a Ensure packages/db runtime config honors explicit schemas in connection initialization (not just IRIS patch). Validation: ensure explicit schema queries bypass default schema mapping in runtime config.

**Checkpoint**: Configuration values available to both migration and runtime layers.

---

## Phase 3: User Story 1 - Run migrations without schema conflicts (Priority: P1) 🎯 MVP

**Goal**: Migrations on the primary backend resolve unqualified schemas to a configurable default schema without conflicts.

**Independent Test**: Run migrations on the primary backend; tables land in the default schema without schema conflict errors.

### Implementation for User Story 1

- [ ] T007 [US1] Update packages/db/drizzle.config.ts to apply DB_DEFAULT_SCHEMA and keep DB_METADATA_SCHEMA unchanged
- [ ] T008 [US1] Update docker-compose.iris.yml to pass default schema configuration for migrations (DB_DEFAULT_SCHEMA)
- [ ] T009 [US1] Update iris/sim_sql_patch.py to map unqualified schema references to DB_DEFAULT_SCHEMA when DB_TYPE=iris
- [ ] T009a [US1] Validate migration runner respects DB_DEFAULT_SCHEMA by verifying table location in IRIS

**Checkpoint**: Primary backend migrations succeed without schema conflicts.

---

## Phase 4: User Story 2 - Consistent runtime schema resolution (Priority: P2)

**Goal**: Runtime queries on the primary backend resolve unqualified schemas to the same default schema used by migrations.

**Independent Test**: Start the primary backend stack and execute a runtime flow that uses unqualified tables.

### Implementation for User Story 2

- [ ] T010 [US2] Update packages/db/index.ts to apply DB_DEFAULT_SCHEMA for runtime connections on the primary backend
- [ ] T011 [US2] Update apps/sim/lib/core/config/env.ts to provide runtime access to DB_DEFAULT_SCHEMA
- [ ] T012 [US2] Update iris/sim_sql_patch.py to ensure explicit schemas are not remapped

**Checkpoint**: Runtime queries on the primary backend resolve to the default schema without errors.

---

## Phase 5: User Story 3 - Maintain reference backend compatibility (Priority: P3)

**Goal**: Reference backend behavior remains unchanged.

**Independent Test**: Run the reference backend stack and confirm migrations and runtime behavior are unchanged.

### Implementation for User Story 3

- [ ] T013 [US3] Add guards in packages/db/index.ts so DB_DEFAULT_SCHEMA only applies to primary backend connections
- [ ] T014 [US3] Add guards in packages/db/drizzle.config.ts so metadata schema behavior remains unchanged on the reference backend
- [ ] T015 [US3] Update apps/sim/.env.example and packages/db/.env.example comments to clarify primary vs reference backend usage

**Checkpoint**: Reference backend migrations and runtime queries behave as before.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation and validation alignment.

- [ ] T016 [P] Update specs/002-drizzle-namespace-fix/quickstart.md with any additional verification steps discovered during implementation
- [ ] T017 [P] Run quickstart verification steps for both stacks and record results

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on Setup completion
- **User Stories (Phases 3-5)**: Depend on Foundational phase completion
- **Polish (Phase 6)**: Depends on desired user stories being complete

### User Story Dependencies

- **US1 (P1)**: Starts after Foundational phase
- **US2 (P2)**: Starts after Foundational phase; builds on US1 configuration
- **US3 (P3)**: Starts after Foundational phase; validates reference backend neutrality

### Parallel Opportunities

- T003 and T004 can run in parallel
- T005 and T006 can run in parallel after T003/T004
- T007, T008, T009 can proceed in parallel once Foundational is complete
- T010, T011, T012 can proceed in parallel once US1 is complete
- T013 and T014 can run in parallel; T015 follows after
- T016 and T017 can run in parallel once implementation finishes

---

## Parallel Example: User Story 1

```bash
# Parallel execution example (independent files)
# T007: packages/db/drizzle.config.ts
# T008: docker-compose.iris.yml
# T009: iris/sim_sql_patch.py
```

---

## Implementation Strategy

- **MVP**: Complete Phase 3 (US1) to unblock primary backend migrations.
- **Incremental**: Add US2 runtime alignment, then US3 compatibility checks.
- **Finalize**: Polish with quickstart validation once both stacks are stable.
