DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workspace_files_workspace_binding_check'
      AND conrelid = 'workspace_files'::regclass
  ) THEN
    ALTER TABLE workspace_files ADD CONSTRAINT workspace_files_workspace_binding_check
      CHECK (context NOT IN ('workspace', 'chat', 'mothership', 'execution', 'workspace-logos')
        OR workspace_id IS NOT NULL) NOT VALID;
  END IF;
END $$;
