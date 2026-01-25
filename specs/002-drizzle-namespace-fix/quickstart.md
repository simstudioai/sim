# Quickstart: Namespace Resolution for Migrations

## Goal

Verify that unqualified schema references resolve to the primary backend default schema while the reference backend remains unchanged.

## Steps

1. Start the primary backend stack and run migrations.
2. Confirm migrations complete without schema conflict errors.
3. Start the reference backend stack and run migrations.
4. Confirm migrations complete with the same behavior as before.
