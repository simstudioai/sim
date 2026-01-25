# sim Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-01-14

## Active Technologies
- TypeScript (Node.js, Next.js 16.1.0 canary) + Drizzle ORM, Postgres.js driver, iris-pgwire, Docker Compose (002-drizzle-namespace-fix)
- PostgreSQL (reference backend) and IRIS via pgwire (primary backend) (002-drizzle-namespace-fix)

- TypeScript (Next.js 14+), InterSystems ObjectScript (for IRIS initialization) + `iris-pgwire` (IRIS bridge), `intersystemsdc/iris-community:latest` (IRIS container), IPM/ZPM (IRIS package manager) (001-iris-database-backend)

## Project Structure

```text
backend/
frontend/
tests/
```

## Commands

npm test && npm run lint

## Code Style

TypeScript (Next.js 14+), InterSystems ObjectScript (for IRIS initialization): Follow standard conventions

## Recent Changes
- 002-drizzle-namespace-fix: Added TypeScript (Node.js, Next.js 16.1.0 canary) + Drizzle ORM, Postgres.js driver, iris-pgwire, Docker Compose
- 002-drizzle-namespace-fix: Added TypeScript (Node.js, Next.js 16.1.0 canary) + Drizzle ORM, Postgres.js driver, iris-pgwire, Docker Compose
- 001-iris-backend-pivot: Added [if applicable, e.g., PostgreSQL, CoreData, files or N/A]


<!-- MANUAL ADDITIONS START -->

## IRIS Technical Reference (v1.1.0+)

### 1. DBAPI Connection Patterns
For both Embedded and External Python, use the following robust pattern:
```python
try:
    import iris.dbapi as iris_dbapi  # Standard for Embedded and newer External
except ImportError:
    import intersystems_iris.dbapi._DBAPI as iris_dbapi  # Deep Fallback
```

**Connection Parameters:**
- **External:** `iris_dbapi.connect(hostname="...", port=..., namespace="...", username="...", password="...")`
- **Embedded:** Usually use direct execution (see below), but if using DB-API, arguments are required.

### 2. SQL Execution
- **Embedded Python (Direct):** Use `iris.sql.exec(query, *params)` where `params` are variadic arguments.
- **DB-API (External/Embedded):** Use `cursor.execute(query, params_tuple)` where `params_tuple` is a single tuple/list.
- **Placeholder Style:** Always use `?` for positional parameters.

### 3. Case Sensitivity & Schema
- **Schema:** Use `SQLUser` (exact case) for standard user tables.
- **Identifiers:** Unquoted identifiers are mapped to **UPPERCASE**. Quoted identifiers (e.g., `"workflow"`) are **case-sensitive**.
- **Reserved Words:** Tables named after reserved words (e.g., `user`) **MUST** be quoted: `SQLUser."USER"`.

<!-- MANUAL ADDITIONS END -->
