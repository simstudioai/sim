# Upload sessions

Upload sessions use a signed, stateless control-plane token and an immutable staging object. Files
up to and including 50 MiB use one signed `PUT`; larger files use multipart upload. Completion
verifies the staged object's upload ID, byte size, and content type before promoting it to a
create-only final key.

The `upload-sessions/` prefix is temporary. Production S3 and GCS buckets must expire objects under
that prefix after two days and abort incomplete multipart uploads after two days. Azure containers
must expire committed blobs under that prefix after two days; Azure automatically garbage-collects
uncommitted blocks after seven days. These policies exceed the 24-hour token lifetime, preserve a
retry window, and bound abandoned provider state. Local storage applies the equivalent 25-hour
policy with the bounded cleanup sweep in `cleanup.ts`. The local sweep retains process-local
directory cursors between bounded runs, so a large set of fresh entries cannot indefinitely hide
expired entries later in either directory.

Local cleanup currently runs opportunistically when that same Sim process creates an upload
session. The repository has no scheduler that safely reaches every process-local filesystem in a
multi-replica self-hosted deployment: an HTTP cron request can land on only one replica, while the
Trigger workers do not own the web replica's disk. Operators using non-shared local disks must
therefore ensure uploads continue to trigger the sweep on each replica or invoke the exported
bounded sweep from their own per-replica maintenance hook. Cloud deployments should use the
provider lifecycle rules above instead.

Final objects are not covered by the staging lifecycle. Completion retains staging until the
domain finalizer succeeds, then conditionally deletes only the exact staging version it verified.
Abort is also staging-only and must never delete a promoted final object.
