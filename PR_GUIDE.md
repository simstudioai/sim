# PR Guide: User-Defined Tables Feature

## Overview

This PR introduces a complete **User-Defined Tables** feature to Sim Studio, allowing users to create, manage, and query custom data tables within their workflows. Tables act as persistent data stores that can be read from and written to by workflow blocks.

**Branch:** `lakees/db`
**Target:** `main`
**Total Changes:** ~32,000 lines added across 101 files

---

## Table of Contents

1. [Feature Summary](#feature-summary)
2. [Architecture Overview](#architecture-overview)
3. [Database Schema](#database-schema)
4. [File-by-File Documentation](#file-by-file-documentation)
5. [Key Design Decisions](#key-design-decisions)
6. [Testing the Feature](#testing-the-feature)
7. [Review Checklist](#review-checklist)

---

## Feature Summary

### What This Feature Does

- **Create custom tables** with defined schemas (columns with types, required/unique constraints)
- **CRUD operations** on table rows via UI and workflows
- **Advanced querying** with MongoDB-style filters (`$eq`, `$gt`, `$in`, `$contains`, etc.)
- **Sorting and pagination** for large datasets
- **Bulk operations** for updating/deleting rows by filter
- **Visual query builders** for non-technical users
- **Workflow integration** via a new "Table" block

### User Journeys

1. **Tables Management UI** (`/workspace/:id/tables`)
   - View all tables in workspace
   - Create tables with custom schemas
   - Delete tables
   - Navigate to table data viewer

2. **Table Data Viewer** (`/workspace/:id/tables/:tableId`)
   - Browse rows with pagination
   - Filter/sort rows using visual builder or JSON
   - Add, edit, delete individual rows
   - Bulk delete selected rows
   - View schema details

3. **Workflow Integration**
   - Use the "Table" block to perform 10 different operations
   - Visual filter/sort builders in workflow editor
   - AI-powered wand for generating row data/filters

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend                                 │
├─────────────────────────────────────────────────────────────────┤
│  Tables List UI     │  Table Data Viewer  │  Table Block (WF)   │
│  /tables            │  /tables/[tableId]  │  Panel Editor       │
└─────────┬───────────┴──────────┬──────────┴──────────┬──────────┘
          │                      │                      │
          ▼                      ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    React Query Hooks                             │
│                    (hooks/queries/use-tables.ts)                 │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                       API Routes                                 │
│  /api/table          - List/Create tables                        │
│  /api/table/[id]     - Get/Delete table                          │
│  /api/table/[id]/rows       - Query/Insert rows                  │
│  /api/table/[id]/rows/[row] - Get/Update/Delete row              │
│  /api/table/[id]/rows/upsert - Upsert row                        │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Service Layer                                 │
│                    (lib/table/service.ts)                        │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Database (PostgreSQL)                         │
│  user_table_definitions  │  user_table_rows                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### Migration Files

| File | Description |
|------|-------------|
| `0139_awesome_killer_shrike.sql` | Initial schema with `deleted_at` and `row_count` columns |
| `0140_steady_moondragon.sql` | Simplified schema (removes unused columns) |

### Tables

#### `user_table_definitions`
Stores table metadata and schemas.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | Primary key (`tbl_xxx` format) |
| `workspace_id` | TEXT | FK to workspace |
| `name` | TEXT | Table name (unique per workspace) |
| `description` | TEXT | Optional description |
| `schema` | JSONB | Column definitions |
| `max_rows` | INT | Maximum allowed rows (default: 10,000) |
| `created_by` | TEXT | FK to user |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |

#### `user_table_rows`
Stores actual row data.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | Primary key (`row_xxx` format) |
| `table_id` | TEXT | FK to table definition |
| `workspace_id` | TEXT | FK to workspace (denormalized for perf) |
| `data` | JSONB | Row data as key-value pairs |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |
| `created_by` | TEXT | FK to user (nullable) |

### Indexes

- GIN index on `data` column for fast JSONB queries
- B-tree indexes on `table_id`, `workspace_id`
- Unique constraint on `(workspace_id, name)` for tables

---

## File-by-File Documentation

### Database Layer

#### `packages/db/schema.ts` (Modified)
Adds Drizzle ORM schema definitions for the two new tables with all relations and constraints.

#### `packages/db/migrations/*.sql`
SQL migrations for creating the tables with proper indexes and foreign keys.

---

### Core Library (`apps/sim/lib/table/`)

#### `index.ts`
Barrel export for the table library. Re-exports all public APIs.

#### `types.ts`
Core TypeScript interfaces defining:
- `ColumnDefinition` - Schema for a single column
- `TableSchema` - Array of column definitions
- `TableDefinition` - Full table metadata
- `TableRow` - Row data structure
- `FilterOperators` - MongoDB-style filter operators
- `QueryFilter` - Filter query structure
- `QueryOptions` - Pagination, filter, sort options
- `QueryResult` - Paginated query response

#### `constants.ts`
System limits and validation patterns:
- `TABLE_LIMITS.MAX_TABLES_PER_WORKSPACE` = 100
- `TABLE_LIMITS.MAX_ROWS_PER_TABLE` = 10,000
- `TABLE_LIMITS.MAX_COLUMNS_PER_TABLE` = 50
- `TABLE_LIMITS.MAX_ROW_SIZE_BYTES` = 1MB
- `COLUMN_TYPES` = ['string', 'number', 'boolean', 'date', 'json']
- `NAME_PATTERN` = Column/table name validation regex

#### `service.ts`
**Core business logic layer.** Contains all table operations:
- `getTableById()` - Fetch single table
- `listTables()` - List workspace tables
- `createTable()` - Create with validation
- `deleteTable()` - Hard delete with rows
- `insertRow()` - Single row insert
- `batchInsertRows()` - Bulk insert (up to 1000)
- `queryRows()` - Filter/sort/paginate
- `getRowById()` - Single row fetch
- `updateRow()` - Full row replacement
- `deleteRow()` - Single row delete
- `updateRowsByFilter()` - Bulk update
- `deleteRowsByFilter()` - Bulk delete

#### `query-builder.ts`
**SQL query builder for JSONB operations.** Converts MongoDB-style filters to PostgreSQL SQL:
- `buildFilterClause()` - Converts filter object to SQL WHERE
- `buildSortClause()` - Converts sort object to SQL ORDER BY
- Uses JSONB containment (`@>`) for equality (GIN-indexed)
- Uses text extraction (`->>`) for comparisons

#### `query-builder.test.ts`
Unit tests for query builder covering all operators and edge cases.

#### `schema-context.ts`
React context for sharing table schema across components. Used by workflow blocks to access column definitions.

---

### Validation (`apps/sim/lib/table/validation/`)

#### `schema.ts`
Schema and row validation:
- `validateTableName()` - Name format validation
- `validateTableSchema()` - Column definitions validation
- `validateRowAgainstSchema()` - Row data type checking
- `validateRowSize()` - Row size limit check

#### `helpers.ts`
Validation helper utilities:
- `getUniqueColumns()` - Extract columns with unique constraint
- `validateUniqueConstraints()` - Check for duplicate values
- Type conversion and coercion helpers

#### `schema.test.ts`
Comprehensive unit tests for all validation functions.

---

### Filter Builder (`apps/sim/lib/table/filters/`)

#### `constants.ts`
Filter/sort UI constants:
- `COMPARISON_OPERATORS` - UI labels for operators
- `LOGICAL_OPERATORS` - AND/OR options
- `SORT_DIRECTIONS` - ASC/DESC options
- `FilterCondition` / `SortCondition` types

#### `use-builder.ts`
Reusable hooks for filter/sort builders:
- `useFilterBuilder()` - Manage filter conditions
- `useSortBuilder()` - Manage sort settings

#### `builder-utils.ts`
Utilities for converting visual builder state to query format:
- `conditionsToFilter()` - Convert FilterCondition[] to QueryFilter
- `sortConditionsToSort()` - Convert SortCondition[] to SortSpec

---

### Hooks (`apps/sim/lib/table/hooks/`)

#### `use-table-columns.ts`
Hook to fetch and format table columns for dropdowns:
- Fetches table schema via API
- Returns columns as `{ value, label }` options

---

### API Routes (`apps/sim/app/api/table/`)

#### `route.ts` (GET, POST)
- **GET**: List all tables in workspace
- **POST**: Create new table with schema validation

#### `utils.ts`
Shared API utilities:
- `checkTableAccess()` - Read permission check
- `checkTableWriteAccess()` - Write permission check
- `checkAccessWithFullTable()` - Combined check + data fetch
- Error response helpers (`badRequestResponse`, `notFoundResponse`, etc.)

#### `[tableId]/route.ts` (GET, DELETE)
- **GET**: Fetch single table details
- **DELETE**: Delete table and all rows

#### `[tableId]/rows/route.ts` (GET, POST)
- **GET**: Query rows with filters/sorting/pagination
- **POST**: Insert single row or batch insert

#### `[tableId]/rows/[rowId]/route.ts` (GET, PUT, DELETE)
- **GET**: Fetch single row
- **PUT**: Update row (full replacement or partial)
- **DELETE**: Delete single row

#### `[tableId]/rows/upsert/route.ts` (POST)
- **POST**: Insert or update based on unique column match

---

### Tools (`apps/sim/tools/table/`)

Workflow tool definitions for the Table block:

| File | Tool ID | Description |
|------|---------|-------------|
| `query-rows.ts` | `table_query_rows` | Query with filters |
| `insert-row.ts` | `table_insert_row` | Insert single row |
| `batch-insert-rows.ts` | `table_batch_insert_rows` | Insert multiple rows |
| `upsert-row.ts` | `table_upsert_row` | Insert or update |
| `update-row.ts` | `table_update_row` | Update by ID |
| `update-rows-by-filter.ts` | `table_update_rows_by_filter` | Bulk update |
| `delete-row.ts` | `table_delete_row` | Delete by ID |
| `delete-rows-by-filter.ts` | `table_delete_rows_by_filter` | Bulk delete |
| `get-row.ts` | `table_get_row` | Get by ID |
| `get-schema.ts` | `table_get_schema` | Get table schema |
| `list.ts` | `table_list` | List all tables |
| `create.ts` | `table_create` | Create new table |

#### `types.ts`
TypeScript types for tool parameters and responses.

---

### Block Definition (`apps/sim/blocks/blocks/`)

#### `table.ts`
**Complete Table block configuration** with:
- 10 operations as dropdown options
- Conditional sub-blocks based on operation
- Visual filter/sort builders
- JSON editor alternatives
- AI wand configuration for generating data
- Parameter transformers for each operation
- Conditional outputs based on operation

---

### React Query Hooks (`apps/sim/hooks/queries/`)

#### `use-tables.ts`
- `useTablesList()` - Fetch workspace tables
- `useCreateTable()` - Create mutation
- `useDeleteTable()` - Delete mutation

---

### UI Components

#### Tables List Page (`apps/sim/app/workspace/[workspaceId]/tables/`)

| File | Description |
|------|-------------|
| `page.tsx` | Next.js page entry |
| `layout.tsx` | Layout wrapper |
| `tables.tsx` | Main tables list component with search |
| `error.tsx` | Error boundary |

#### Tables Components (`tables/components/`)

| File | Description |
|------|-------------|
| `table-card.tsx` | Card component for each table in grid |
| `create-table-modal.tsx` | Modal for creating tables with schema builder |

---

#### Table Data Viewer (`tables/[tableId]/`)

| File | Description |
|------|-------------|
| `page.tsx` | Next.js page entry |
| `error.tsx` | Error boundary |

#### Table Data Viewer Components (`[tableId]/components/`)

| File | Description |
|------|-------------|
| `table-action-bar.tsx` | Action bar for bulk operations |
| `table-query-builder.tsx` | Visual filter/sort builder |
| `table-row-modal.tsx` | Modal for add/edit/delete rows |

#### Table Data Viewer Core (`[tableId]/table-data-viewer/`)

| File | Description |
|------|-------------|
| `table-data-viewer.tsx` | Main viewer component |
| `constants.ts` | Pagination constants |
| `types.ts` | Viewer-specific types |
| `utils.ts` | Utility functions |

#### Table Data Viewer Components (`table-data-viewer/components/`)

| File | Description |
|------|-------------|
| `table-header-bar.tsx` | Header with name, count, actions |
| `table-cell-renderer.tsx` | Smart cell rendering by type |
| `table-body-states.tsx` | Loading/empty states |
| `table-pagination.tsx` | Pagination controls |
| `row-context-menu.tsx` | Right-click menu |
| `cell-viewer-modal.tsx` | Modal for viewing long values |
| `schema-viewer-modal.tsx` | Modal for viewing schema |

#### Table Data Viewer Hooks (`table-data-viewer/hooks/`)

| File | Description |
|------|-------------|
| `use-table-data.ts` | Data fetching with pagination |
| `use-row-selection.ts` | Row selection state |
| `use-context-menu.ts` | Context menu state |

---

### Workflow Block Sub-components

#### Filter/Sort Builders (`sub-block/components/`)

| File | Description |
|------|-------------|
| `filter-format/filter-format.tsx` | Visual filter builder component |
| `filter-format/components/filter-condition-row.tsx` | Single filter row |
| `filter-format/components/empty-state.tsx` | Empty state UI |
| `sort-format/sort-format.tsx` | Visual sort builder component |
| `sort-format/components/sort-condition-row.tsx` | Single sort row |
| `sort-format/components/empty-state.tsx` | Empty state UI |
| `table-selector/table-selector.tsx` | Table dropdown with schema preview |

---

### Modified Files

| File | Changes |
|------|---------|
| `blocks/registry.ts` | Register Table block |
| `blocks/types.ts` | Add new sub-block types |
| `tools/registry.ts` | Register all table tools |
| `tools/params.ts` | Add table param extraction |
| `tools/types.ts` | Update tool type definitions |
| `tools/error-extractors.ts` | Add table error handling |
| `components/icons.tsx` | Add TableIcon |
| `components/ui/dialog.tsx` | Fix dialog styling |
| `sub-block.tsx` | Add filter/sort/table-selector cases |
| `workflow-block.tsx` | Add table schema context |
| `use-wand.ts` | Add table schema context for AI |
| `sidebar.tsx` | Add Tables link to navigation |
| `code.tsx` | Add table-schema generation type |
| `input-format.tsx` | Support table output reference |
| `table.tsx` | Minor fixes |
| `tool-input.tsx` | Support table references |

---

## Key Design Decisions

### 1. JSONB for Row Data
**Decision:** Store row data as JSONB rather than separate columns.

**Why:**
- Flexible schema per table without DDL changes
- GIN index enables fast equality queries
- Native PostgreSQL JSON operators
- Simpler migrations

**Tradeoffs:**
- Less efficient for numeric range queries
- No column-level constraints enforced by DB

### 2. MongoDB-Style Query Syntax
**Decision:** Use MongoDB-style operators (`$eq`, `$gt`, `$in`, etc.)

**Why:**
- Familiar to many developers
- Expressive and composable
- Easy to serialize to JSON
- Supports logical operators (`$and`, `$or`)

### 3. Visual Query Builders
**Decision:** Provide both visual builders and JSON editors

**Why:**
- Lower barrier for non-technical users
- Power users can use JSON directly
- Builders generate valid JSON

### 4. Workspace-Level Access Control
**Decision:** Tables inherit workspace permissions

**Why:**
- Consistent with other workspace resources
- Simpler permission model
- Table creator always has full access

### 5. Hard Deletes
**Decision:** No soft delete for tables/rows

**Why:**
- Simpler implementation
- User-defined data doesn't need audit trail
- Reduces storage costs

---

## Testing the Feature

### Manual Testing Steps

1. **Create a table**
   - Go to `/workspace/:id/tables`
   - Click "Create Table"
   - Add columns with different types
   - Verify validation (name format, required fields)

2. **Add rows**
   - Open a table
   - Click "Add Row"
   - Test type validation (e.g., number in string field)
   - Test required field validation

3. **Query rows**
   - Add multiple rows
   - Use filter builder to filter
   - Use sort builder to sort
   - Test pagination

4. **Edit/Delete rows**
   - Edit a row, verify update
   - Delete a row, verify removal
   - Select multiple, bulk delete

5. **Workflow integration**
   - Create workflow with Table block
   - Test each operation
   - Test visual filter builder
   - Test AI wand for generating data

### Automated Tests

```bash
# Run table library tests
bun test apps/sim/lib/table/

# Run specific test files
bun test apps/sim/lib/table/query-builder.test.ts
bun test apps/sim/lib/table/validation/schema.test.ts
```

---

## Review Checklist

### Security
- [ ] SQL injection prevention in query builder
- [ ] Access control on all API routes
- [ ] Workspace ID verification
- [ ] Row size limits enforced

### Performance
- [ ] GIN index on JSONB data
- [ ] Batch operations use transactions
- [ ] Pagination limits enforced
- [ ] Row count computed efficiently

### Code Quality
- [ ] TypeScript types complete
- [ ] Error messages helpful
- [ ] Logging consistent
- [ ] No console.log statements

### UI/UX
- [ ] Loading states shown
- [ ] Error states handled
- [ ] Empty states informative
- [ ] Responsive on different screens

### Edge Cases
- [ ] Empty table handling
- [ ] Maximum limits (tables, rows, columns)
- [ ] Invalid filter/sort handling
- [ ] Concurrent modification handling

---

## How to Process This PR

### Recommended Review Order

1. **Start with the database layer**: Review `packages/db/migrations/*` and `packages/db/schema.ts` to understand the new table entities and relationships.

2. **Review the table library**: Read `apps/sim/lib/table/*` to see how schema validation, query building, and service calls are structured.

3. **Review API routes**: Inspect `apps/sim/app/api/table/*` to verify request validation, query handling, and error patterns.

4. **Review tools and blocks**: Check `apps/sim/blocks/blocks/table.ts`, `apps/sim/tools/table/*`, and registry/type updates.

5. **Review UI entry points**: Check the tables pages in `apps/sim/app/workspace/[workspaceId]/tables/*` and the detail view in `apps/sim/app/workspace/[workspaceId]/tables/[tableId]/*`.

6. **Review data viewer internals**: Scan the viewer components and hooks in `apps/sim/app/workspace/[workspaceId]/tables/[tableId]/table-data-viewer/*`.

7. **Review workflow editor updates**: Verify editor changes for table input formats and UI in the `w/[workflowId]` components.

8. **Run tests and checks**:
   - `bun run test` (or run targeted table tests)
   - `bun run type-check`
   - `bun run lint:check`

---

## Navigation Guide for Reviewers

### Quick Links by Area

| Area | Key Files |
|------|-----------|
| **Database** | `packages/db/schema.ts`, `packages/db/migrations/0140_*.sql` |
| **Types** | `apps/sim/lib/table/types.ts` |
| **Service Layer** | `apps/sim/lib/table/service.ts` |
| **Query Builder** | `apps/sim/lib/table/query-builder.ts` |
| **Validation** | `apps/sim/lib/table/validation/schema.ts` |
| **API Routes** | `apps/sim/app/api/table/route.ts`, `apps/sim/app/api/table/utils.ts` |
| **Block Definition** | `apps/sim/blocks/blocks/table.ts` |
| **Tools** | `apps/sim/tools/table/query-rows.ts` (example) |
| **Tables UI** | `apps/sim/app/workspace/[workspaceId]/tables/tables.tsx` |
| **Data Viewer** | `apps/sim/app/workspace/.../table-data-viewer/table-data-viewer.tsx` |
| **Filter Builder** | `apps/sim/lib/table/filters/use-builder.ts` |

### Start Here (Top 5 Files)

1. `apps/sim/lib/table/types.ts` - Core type definitions
2. `apps/sim/lib/table/service.ts` - Business logic
3. `apps/sim/app/api/table/utils.ts` - API utilities
4. `apps/sim/blocks/blocks/table.ts` - Block configuration
5. `apps/sim/app/workspace/[workspaceId]/tables/[tableId]/table-data-viewer/table-data-viewer.tsx` - Main UI
