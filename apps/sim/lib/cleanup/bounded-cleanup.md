# Manual cleanup limits

The existing cron Lambda can call these endpoints with query parameters:

- `/api/logs/cleanup?workflowLogs=25&jobLogs=25`
- `/api/cron/cleanup-soft-deletes?files=10&legacyFiles=10`

Use the existing cron authentication. Each request returns HTTP 202 with `runId` and queues one job. The worker uses the existing retention rules and cleanup functions. Limits are integers from 0 to 5000; omitted types are zero. At least one positive limit is required. Calls without parameters retain scheduled dispatch.

Log types: `workflowLogs`, `jobLogs`, `largeValues`, `legacyLargeValues`, `orphanSnapshots`, `staleReferences`, `staleDependencies`, `largeValueTombstones`.

Soft-delete types: `workflows`, `chats`, `legacyFiles`, `files`, `knowledgeBases`, `folders`, `userTables`, `memories`, `mcpServers`, `workflowMcpServers`, `orphanKnowledgeBaseBindings`.

Each type has one budget across all workspace and organization chunks in that job. Limits count selected root rows, including rows restored or unsuccessfully deleted after selection. Existing child cascades and attached-file cleanup still follow the selected parents; the limit is not a cap on every physical row affected by a cascade.

Log and soft-delete tasks share a queue with concurrency one. Jobs have one attempt so automatic retries cannot reset a spent row budget. Each new API call creates a new job; inspect the returned run before repeating a call whose response was lost.

Deploy the worker before the API. Keep schedules disabled while draining the backlog. Start with small limits for one type, inspect the job logs and database load, then repeat and increase counts gradually. Storage, billing, and concurrent-restore behavior follow the existing cleanup implementation.
