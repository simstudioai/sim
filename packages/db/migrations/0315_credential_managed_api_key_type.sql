-- Adds the `managed_api_key` credential type, for Credential Group options that collect an
-- API key from each invited person instead of an OAuth grant. Purely additive: no existing
-- row changes type, and every type-discriminated read path filters explicitly.
--
-- Postgres cannot use a new enum value in the same transaction that adds it, so this must be
-- released BEFORE any code writes it, and separately from 0313 which adds the column and the
-- constraints that describe such a row.
ALTER TYPE "public"."credential_type" ADD VALUE IF NOT EXISTS 'managed_api_key';
