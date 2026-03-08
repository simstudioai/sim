# Tables UI Capabilities

## Main Page (List View)

### Header
- Icon (blue table icon in rounded badge) + title "Tables"
- Description subtitle: "Create and manage data tables for your workflows."

### Actions Bar
- **Search**: Debounced (300ms) text input filtering by table name and description
- **Create Table**: Button with permission gate (`canEdit`), tooltip when disabled

### Content Grid
- Responsive card grid: 1 col (mobile) → 2 → 3 → 4 (xl)
- States: loading (8 skeleton cards), error (message), empty (search-aware message)

### Context Menu (Background)
- Right-click on empty area → "Create table" (permission-gated)

---

## Table Card

### Display
- **Name**: Truncated, bold
- **Short ID**: Badge showing `tb-{first 8 chars}`
- **Column count**: Icon + count
- **Row count**: Icon + count
- **Last updated**: Relative time, absolute date on tooltip hover
- **Description**: 2-line clamp or "No description"

### Interactions
- Click → navigate to table detail (`/workspace/{id}/tables/{tableId}`)
- Right-click → context menu

### Context Menu (Card)
- View Schema → opens schema modal
- Copy ID → clipboard
- Delete → confirmation modal (permission-gated)

### Modals
- **Delete Confirmation**: Shows table name + row count warning, "cannot be undone"
- **Schema Viewer**: Read-only table of columns with name, type badge, constraints (required/unique)

---

## Create Table Modal

### Form Fields
- **Name**: Required, enforces lowercase + underscores pattern
- **Description**: Optional textarea
- **Columns**: Dynamic list (minimum 1)

### Column Editor
- Column name (text input)
- Type selector: `string` | `number` | `boolean` | `date` | `json`
- Required toggle (checkbox)
- Unique toggle (checkbox)
- Add/remove columns (minimum 1 enforced)

### Validation
- Name required
- At least one column
- No duplicate column names

---

## Table Detail Page (Inner View)

### Header Bar
- Breadcrumb: "Tables" (back link) → table name
- Row count badge
- View Schema button (Info icon)
- Refresh button (RefreshCw icon)

### Query Builder
- **Add Filter**: Column selector → operator → value, logical AND/OR chaining
- **Add Sort**: Column selector → direction (asc/desc)
- **Apply**: Execute query
- **Clear All**: Reset filters/sorts
- **Add Row**: Opens add row modal

### Data Grid
- Sticky header row with column names, type badges, required markers
- Row selection via checkboxes
- Select-all checkbox in header
- Cell rendering by type:
  - **String**: Truncated at 50 chars, click to view full, double-click to inline edit
  - **Number**: Double-click to inline edit
  - **Date**: Double-click to inline edit
  - **Boolean**: Single-click to toggle
  - **JSON**: Click to view formatted, double-click to edit in modal
  - **Null**: Shows "—", double-click to edit

### Inline Cell Editor
- Input field for string/number/date
- Enter to save, Escape to cancel, blur to save

### Action Bar (Selection)
- Shows selected count
- Clear selection button
- Delete selected button

### Row Context Menu
- Edit row
- Delete row

### Pagination
- Previous/Next buttons
- "Page X of Y (N rows)" label
- Hidden when single page
- 100 rows per page

### Modals (Detail)
- **Add Row**: Form with field per column, typed inputs (text/textarea/checkbox)
- **Edit Row**: Pre-filled form, update button
- **Delete Row(s)**: Confirmation dialog
- **Cell Viewer**: Full content display with copy button (JSON pretty-printed, date formatted)

---

## Underlying Considerations

### Data Layer
- React Query for all data fetching (no Zustand store)
- Hooks: `useTablesList`, `useTable`, `useTableRows`, `useCreateTable`, `useDeleteTable`, `useCreateTableRow`, `useUpdateTableRow`, `useDeleteTableRow`, `useDeleteTableRows`
- Optimistic updates on row mutations
- Query key factory pattern (`tableKeys`)

### API Surface
| Endpoint | Methods | Purpose |
|----------|---------|---------|
| `/api/table` | GET, POST | List tables, create table |
| `/api/table/[tableId]` | GET, DELETE | Get table, delete table |
| `/api/table/[tableId]/rows` | GET, POST, PUT, DELETE | Query/insert/update/delete rows |
| `/api/table/[tableId]/rows/[rowId]` | GET, PATCH, DELETE | Single row CRUD |
| `/api/table/[tableId]/rows/upsert` | POST | Upsert by unique column |

### Table Service (`lib/table/service.ts`)
- Used by executor, background jobs, and tests
- Full CRUD: `getTableById`, `listTables`, `countTables`, `createTable`, `deleteTable`
- Row operations: `insertRow`, `batchInsertRows`, `upsertRow`, `queryRows`, `getRowById`, `updateRow`, `deleteRow`
- Bulk operations: `updateRowsByFilter`, `deleteRowsByFilter`, `deleteRowsByIds`

### Permissions
- Create/delete gated by `canEdit` from `useUserPermissionsContext()`
- API routes enforce workspace access via `checkAccess()`
- Page-level: `hideTablesTab` permission config

### File Structure
```
tables/
├── page.tsx                    # Server component (auth, permissions)
├── tables.tsx                  # Client list view
├── layout.tsx                  # Flex layout wrapper
├── lib/
│   └── utils.ts                # formatRelativeTime, formatAbsoluteDate
├── components/
│   ├── index.ts                # Barrel exports
│   ├── table-card.tsx           # Card component
│   ├── table-context-menu.tsx   # Card context menu
│   ├── tables-list-context-menu.tsx  # Background context menu
│   ├── create-modal.tsx         # Create table form
│   ├── empty-state.tsx          # Empty state display
│   ├── error-state.tsx          # Error state display
│   └── loading-state.tsx        # Skeleton loading
└── [tableId]/
    ├── page.tsx                 # Detail server component
    ├── lib/
    │   ├── constants.ts         # ROWS_PER_PAGE, STRING_TRUNCATE_LENGTH
    │   └── utils.ts             # getTypeBadgeVariant, cleanCellValue, formatValueForInput
    ├── hooks/
    │   ├── use-table-data.ts    # Combined table + rows hook
    │   ├── use-row-selection.ts # Selection state
    │   └── use-context-menu.ts  # Context menu state
    └── components/
        ├── index.ts
        ├── table-viewer.tsx      # Main detail view
        ├── header-bar.tsx
        ├── action-bar.tsx
        ├── query-builder/
        │   ├── index.tsx
        │   ├── filter-row.tsx
        │   └── sort-row.tsx
        ├── cell-renderer.tsx
        ├── inline-cell-editor.tsx
        ├── cell-viewer-modal.tsx
        ├── row-modal.tsx
        ├── schema-modal.tsx
        ├── context-menu.tsx
        ├── table-row-cells.tsx
        ├── body-states.tsx
        └── pagination.tsx
```
