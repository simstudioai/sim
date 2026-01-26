# Bug Report: Parameterized LIMIT/OFFSET Returns Empty Column Metadata

**iris-pgwire version:** 1.2.21  
**Severity:** Critical (breaks all ORM queries with `.limit()` or pagination)  
**Reported:** 2026-01-25

---

## Summary

When a SELECT query uses a parameterized LIMIT or OFFSET clause (`LIMIT $1`, `OFFSET $1`), iris-pgwire returns **empty column metadata** (`columns: []`) in the RowDescription message. This causes postgres.js (and likely other PostgreSQL clients) to return empty row objects `{}` instead of the actual data.

---

## Reproduction

### Environment
- IRIS: `intersystemsdc/iris-community:latest` (ARM64)
- iris-pgwire: 1.2.21
- Client: postgres.js (any recent version)
- Connection: `postgresql://_SYSTEM:SYS@localhost:5435/USER`

### Minimal Test Script

```typescript
import postgres from 'postgres'

const sql = postgres('postgresql://_SYSTEM:SYS@localhost:5435/USER', {
  prepare: false,
})

// TEST 1: LIMIT as literal - WORKS
const r1 = await sql.unsafe('SELECT "id", "name" FROM "table" LIMIT 1')
console.log(r1.columns)  // [{name: "id"}, {name: "name"}] ✓
console.log(r1[0])       // { id: "...", name: "..." } ✓

// TEST 2: LIMIT as parameter - FAILS
const r2 = await sql.unsafe('SELECT "id", "name" FROM "table" LIMIT $1', [1])
console.log(r2.columns)  // [] ✗ EMPTY!
console.log(r2[0])       // {} ✗ EMPTY!

// TEST 3: OFFSET as parameter - FAILS
const r3 = await sql.unsafe('SELECT "id", "name" FROM "table" LIMIT 1 OFFSET $1', [0])
console.log(r3.columns)  // [] ✗ EMPTY!
console.log(r3[0])       // {} ✗ EMPTY!

// TEST 4: WHERE with parameter (no LIMIT param) - WORKS
const r4 = await sql.unsafe('SELECT "id", "name" FROM "table" WHERE "value" > $1', [50])
console.log(r4.columns)  // [{name: "id"}, {name: "name"}] ✓
console.log(r4[0])       // { id: "...", name: "..." } ✓
```

### Run Full Reproduction Script

```bash
bun run iris-pgwire-bugs/reproduce_limit_bug.ts
```

### Expected Output

```
TEST 2 (LIMIT $1):
  columns: [ "id", "name" ]
  row[0]: { id: "id-001", name: "First Row" }
  Status: PASS
```

### Actual Output

```
TEST 2 (LIMIT $1):
  columns: []
  row[0]: {}
  Status: FAIL
```

---

## Test Results Summary

| Test | Query | Status |
|------|-------|--------|
| TEST 1 | `LIMIT 1` (literal) | PASS |
| TEST 2 | `LIMIT $1` (parameter) | **FAIL** |
| TEST 3 | `WHERE $1 LIMIT $2` | **FAIL** |
| TEST 4 | `WHERE $1` (no LIMIT param) | PASS |
| TEST 5 | `LIMIT 1 OFFSET $1` | **FAIL** |

**Pattern:** Any query with a parameterized LIMIT or OFFSET fails. Parameters in WHERE clause work correctly.

---

## Technical Analysis

### What's Happening

1. Client sends: `SELECT "id", "name" FROM "table" LIMIT $1` with params `[1]`
2. Server executes query correctly (returns `count: 1`)
3. Server sends RowDescription with **empty field list** instead of column metadata
4. Client receives DataRow but can't map values to column names
5. Result: empty objects `{}`

### Protocol-Level Evidence

The postgres.js result object shows:
```javascript
{
  count: 1,                    // Server knows 1 row was returned
  command: "SELECT",
  columns: [],                 // <-- BUG: Empty column metadata!
  statement: {
    string: 'SELECT "id", "name" FROM "table" LIMIT $1',
    types: [705],              // Parameter type (unknown/text)
    columns: []                // Also empty here
  }
}
```

### Likely Root Cause

The issue appears to be in how iris-pgwire handles the Describe/Parse phase when LIMIT or OFFSET has a parameter:
- When LIMIT is a literal (`LIMIT 1`), column metadata is correctly extracted
- When LIMIT is a parameter (`LIMIT $1`), column metadata is lost

This may be related to:
1. How IRIS SQL prepares statements with parameterized LIMIT/OFFSET
2. How iris-pgwire extracts column metadata from prepared statement descriptors
3. Timing of when column metadata is captured vs when parameters are bound

---

## Impact

### Drizzle ORM (and likely other ORMs)

Drizzle ORM parameterizes ALL `.limit()` calls:
```typescript
db.select().from(table).limit(1)
// Generates: SELECT ... LIMIT $1 with params [1]
```

This means **every Drizzle query with `.limit()` returns empty objects on IRIS**.

### Affected Queries

Any query with parameterized:
- `LIMIT $n` (confirmed)
- `OFFSET $n` (confirmed)

### Working Queries

- `LIMIT <literal>` (e.g., `LIMIT 1`)
- `OFFSET <literal>` (e.g., `OFFSET 0`)
- `WHERE column = $1` (parameters in WHERE work fine)
- `INSERT ... VALUES ($1, $2, ...)` (parameters in VALUES work fine)

---

## Suggested Fix Location

Based on the package structure, likely in one of:
- `iris_executor.py` - Query execution and result handling
- `protocol.py` - PostgreSQL wire protocol message handling  
- `sql_translator/` - SQL parsing/transformation

The fix should ensure column metadata from the parsed statement is preserved and sent in RowDescription even when LIMIT/OFFSET use parameters.

---

## Files

- `LIMIT_PARAMETER_BUG.md` - This bug report
- `reproduce_limit_bug.ts` - Standalone reproduction script
