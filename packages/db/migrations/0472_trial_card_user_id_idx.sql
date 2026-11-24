-- Indexes trial_card(user_id). The trial-card claim reads a card's and an account's claims with
-- `fingerprint = $1 OR user_id = $2`, and user_id references user(id) ON DELETE SET NULL, so each
-- deleted user runs `WHERE user_id = $1`. Without this index both read the whole table, which only
-- grows: a claim outlives its account.
--
-- Replay-safety: as 0467. The build is CONCURRENTLY below an embedded COMMIT, and a replay moves
-- only an INVALID index left by a failed build aside to be dropped, keeping a valid one.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('trial_card_user_id_idx_failed')
      AND (indisvalid OR indrelid <> to_regclass('trial_card'))
  ) THEN
    RAISE EXCEPTION 'Refusing to drop unexpected recovery index trial_card_user_id_idx_failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('trial_card_user_id_idx')
      AND indrelid = to_regclass('trial_card') AND NOT indisvalid
  ) THEN
    ALTER INDEX "trial_card_user_id_idx" RENAME TO "trial_card_user_id_idx_failed";
  END IF;
END $$;--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "trial_card_user_id_idx_failed";--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "trial_card_user_id_idx" ON "trial_card" USING btree ("user_id");--> statement-breakpoint
SET lock_timeout = '5s';
