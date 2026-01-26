import re
import os

def patch_sql(sql: str) -> str:
    """
    Patches SQL statements to handle schema mapping for IRIS.
    Unqualified references are mapped to DB_DEFAULT_SCHEMA.
    Explicitly qualified references are preserved.
    """
    db_type = os.environ.get("DB_TYPE", "postgres")
    if db_type != "iris":
        return sql

    default_schema = os.environ.get("DB_DEFAULT_SCHEMA", "SQLUser")
    metadata_schema = os.environ.get("DB_METADATA_SCHEMA", "drizzle")

    # Regex to match unqualified table names after common SQL keywords
    # Matches: KEYWORD "table_name"
    # Does NOT match: "schema"."table_name"
    pattern = r'(\b(?:FROM|INTO|TABLE|UPDATE|JOIN|REFERENCES)\s+)"([^".]+)"'

    def replacement(match):
        keyword_prefix = match.group(1)
        table_name = match.group(2)
        
        # If the table is the metadata table, use the metadata schema
        if table_name.startswith("__drizzle_migrations"):
            return f'{keyword_prefix}"{metadata_schema}"."{table_name}"'
            
        # Otherwise use the default schema
        return f'{keyword_prefix}"{default_schema}"."{table_name}"'

    patched_sql = re.sub(pattern, replacement, sql, flags=re.IGNORECASE)
    return patched_sql
