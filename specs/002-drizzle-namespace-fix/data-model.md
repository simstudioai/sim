# Data Model: Namespace Resolution for Migrations

## Default Schema

- **Purpose**: Schema used when SQL does not specify a schema.
- **Key Attributes**: name, backend scope, resolution precedence.
- **Relationships**: Applied to unqualified tables for the primary backend.

## Migration Schema

- **Purpose**: Schema storing migration metadata and history.
- **Key Attributes**: name, backend scope, isolation rules.
- **Relationships**: Remains unchanged across backends to preserve migration tracking.
