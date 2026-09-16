# GitLab personal-token ownership migration

New personal GitLab connections belong to the organization and the connecting Sim user. A workspace is an execution context, not the credential owner. Tokens remain private to their owner; moving them does not grant workflow access.

Deploy the organization-token application changes completely before running this command. The application supports existing workspace tokens during this transition. The schema already contains the organization owner column and unique index, so this is a data migration rather than a new Drizzle schema migration.

From `apps/sim`, with the intended database and its existing encryption key configured:

```sh
bun run scripts/migrate-gitlab-personal-tokens.ts --organization-id=<organization-id>
bun run scripts/migrate-gitlab-personal-tokens.ts --organization-id=<organization-id> --apply
```

The first command is a dry run. It validates the existing encrypted bindings and the destination organization without changing credentials or enrollments. Review that result before applying.

The command pages through at most 100 candidate IDs at a time and commits each credential independently. It preserves the credential ID, provider account, scopes, expiry, and revocation fields; re-encrypts the secret with organization ownership; and binds it to the owner's organization enrollment. A verified legacy enrollment can seed a new organization enrollment without issuing an invitation. Existing organization setup and workspace access policies remain unchanged.

Migration stops on duplicate provider identities, missing organization setup, missing or unverified membership, revoked or conflicting enrollments, invalid ciphertext, or a concurrent identity change. It does not pick a token to discard, reactivate revoked enrollment access, or recreate organization policies. Resolve the reported condition before retrying. Previously committed credentials are skipped on rerun.

Run the command separately for each organization. Tokens in workspaces with no organization need an explicit destination decision; the command does not assign one. Old workspace groups remain available for other legacy connections. After every organization is migrated and old application versions are retired, the legacy personal-token index and workspace-envelope support can be removed in a later change.

Verification:

- One credential ID appears for its owner in multiple workspaces in the organization.
- Reconnect and rotation update that same credential.
- Other people, including workspace administrators, cannot use the token.
- Deleting the original workspace does not delete the migrated credential.
- Disconnect removes the organization connection across its workspaces.

The migrated encrypted payload cannot be read by older application code that expects workspace ownership. Do not roll back to that code after applying this data migration without a corresponding data rollback or reconnect procedure.
