# Upload sessions

Upload sessions keep their control-plane state in PostgreSQL and upload directly to their final
storage key. Files up to and including 50 MiB use one create-only signed `PUT`; larger files use a
provider multipart upload. Completion accepts only the upload ID and token, lists parts from the
storage provider, validates their count and byte sizes, completes the provider upload, and verifies
the final object's upload ID, byte size, and content type before running the domain finalizer.

Production S3 and GCS buckets must abort incomplete multipart uploads after two days. Azure
automatically garbage-collects uncommitted blocks after seven days. Local storage keeps multipart
parts under `.multipart/` and applies an equivalent 25-hour bounded cleanup sweep in `cleanup.ts`.
The local sweep retains its process-local directory cursor between bounded runs, so a large set of
fresh entries cannot indefinitely hide expired entries later in the directory.

Local cleanup currently runs opportunistically when that same Sim process creates an upload
session. The repository has no scheduler that safely reaches every process-local filesystem in a
multi-replica self-hosted deployment: an HTTP cron request can land on only one replica, while the
Trigger workers do not own the web replica's disk. Operators using non-shared local disks must
therefore ensure uploads continue to trigger the sweep on each replica or invoke the exported
bounded sweep from their own per-replica maintenance hook. Cloud deployments should use the
provider lifecycle rules above instead.

The cron cleanup claims expired database sessions with a lease before aborting provider multipart
state or conditionally deleting an uploaded object that still carries that session's identity.
Sessions already in domain finalization are retained for an idempotent completion retry; cleanup
must not delete an object after its domain resource may have been created.
