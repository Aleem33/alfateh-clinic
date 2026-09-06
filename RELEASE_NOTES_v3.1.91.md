# v3.1.91 — Guarded incremental synchronization

- Adds stage 2 changed-document synchronization capability with durable local checkpoints, paged bootstrap catch-up, timestamp-boundary overlap, bounded reconnects, and recovery of rejected edits.
- Prevents a failed local commit from allowing later snapshots to skip unpersisted entries.
- Requires server-confirmed compatibility control and deployed-rule verification before activation. Installation alone does not activate stage 2.
- Adds conditional protocol-2 write enforcement and admin-owned reset safeguards while retaining current permissions when enforcement is off.
- Fixes out-of-order device readiness reports and avoids unnecessary full downloads before a new PC receives sync control.
- Provides a read-only rollout audit and guarded activation/rollback tooling.

No historical business records are merged, rewritten, or deleted. Offline sale IDs and the existing durable outbox are preserved. Production activation remains a separate readiness-verified operation; do not clear application caches or local databases to resolve a readiness warning.
