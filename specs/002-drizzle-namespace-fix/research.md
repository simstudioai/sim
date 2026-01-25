# Research: Namespace Resolution for Migrations

## Decision 1: Default schema resolution for primary backend

**Decision**: Use a configurable default schema for unqualified SQL, with SQLUser as the fallback.

**Rationale**: Keeps migrations and runtime SQL consistent on the primary backend without diverging from the reference backend’s behavior.

**Alternatives considered**:
- Hardcode SQLUser for all cases (no configurability).
- Rewrite migration SQL to always qualify schemas (higher maintenance risk).

## Decision 2: Preserve migration metadata schema

**Decision**: Keep migration metadata in its current schema.

**Rationale**: Maintains alignment with the reference backend and avoids disrupting existing tooling.

**Alternatives considered**:
- Move metadata into the default schema (baseline divergence).

## Decision 3: Honor explicit schemas

**Decision**: Do not remap explicitly provided schema names.

**Rationale**: Preserves developer intent and avoids surprising behavior when alternate schemas are referenced.

**Alternatives considered**:
- Force remap to default schema (breaks explicit schema usage).
