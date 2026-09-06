# Firestore read reduction rollout

## Release 1: compatibility and complete local mirror

The application keeps Firestore authoritative and records complete, role-permitted collections in the `alfateh-local-mirror` IndexedDB database. Existing cloud records are not migrated, merged, or rewritten. Old records without revision or deletion fields remain readable.

- Page navigation, window focus, and auth readiness no longer request full sales/return history scans. Pages subscribe to the shared local repository.
- Legacy server listeners remain active during this release and reconcile complete server snapshots into the mirror. Cached SDK snapshots cannot replace complete history; only local pending edits are applied from cached deliveries.
- Initial synchronization is visible and gates operational pages until the permitted mirror is complete. Forms already open remain mounted during synchronization restarts.
- New gateway writes carry server `syncUpdatedAt` and protocol version 2. Ordinary deletion creates a recoverable tombstone; rules preserve each role's previous deletion authority. Existing old clients remain compatible during this stage.
- Local diagnostics estimate document deliveries by collection, source, route, and reconnect. They are not billing counters: SDK query sharing, metadata events, and minimum query charges can make them differ from the Firebase console. Diagnostics are not uploaded.
- The durable sale outbox waits for IndexedDB transaction completion. Reconnection drains Firebase's original pending batch before checking and replaying any missing sale ID, preventing double stock deductions.
- Rejected edits are flagged and recovery snapshots retained in collection metadata where available. Server reconciliation remains authoritative for operational totals; the durable sale outbox remains the recovery source for unconfirmed sales.

`syncClients/{deviceId}` records protocol, app version, role, and mirror readiness. `syncControl/current` defaults to generation 1 with incremental mode disabled. Creation is server-confirmed and transaction-protected so a new device cannot overwrite an existing control document.

## Release 2: v3.1.91 capability and activation prerequisites

The v3.1.91 build supports incremental mode. Installing it does **not** activate the mode: server-confirmed control must enable it, require protocol 2 writes, confirm enforcement version 2, and not be in rollback/reset. Existing disabled control remains disabled. Pending local control edits cannot activate it.

Before activation:

1. Every operational PC must install the compatibility release and finish its initial synchronization. Compare permitted collection counts and sales, stock, purchase, return, and customer balances with Firestore. Review pending/rejected changes.
2. Deploy the emulator-tested conditional rules requiring current server revision metadata for every write, including all admin allow paths, and preventing ordinary physical deletion while enforcement is enabled. With the flag off, existing write permissions remain compatible. Permanent deletion in enforced mode requires an admin-owned, scope-matching reset marker. Tracked writes in the same server millisecond remain valid; the mirror overlaps that timestamp boundary.
3. Validate the incremental listener across long reconnects and reset generations, including bounded cursor reattachment and timestamp ties. Run multi-device billing tests in incremental mode and check read diagnostics against actual Firebase usage.
4. Publish the second release. Set `trackedWritesRequired`, `incrementalEnabled`, `minimumProtocolVersion`, and `rulesEnforcementVersion` only after deployed rules and client readiness are verified. Activation must also increment `datasetGeneration` to establish a fresh baseline: older clients could have changed records without advancing their revision before enforcement began. This changes sync metadata, not historical business documents.

The incremental prototype bootstraps in 250-document pages, persists each page and cursor transactionally, and captures a revision watermark before paging. Local checkpoints never use pending server-timestamp estimates. Interrupted pages resume from the last successful transaction. Rebuilding pauses for unresolved local writes.

## Stage 2 runtime safeguards

Publishing capability and activating it are separate steps. The operator's readiness confirmation must agree with current server device reports. Do not override incomplete/stale device reports or clear caches to pass the readiness checks. Client registration now serializes reports to prevent a delayed not-ready result from overwriting ready, and ignores old-account/old-generation results.

- A paged download stays incomplete until the first authoritative delta delivery catches changes made during paging. Restart after the last page resumes catch-up without downloading the pages again.
- Incremental queries retain document-ID ordering but overlap the saved timestamp boundary, including lower-ID records with the same revision. This deliberately rereads a small boundary set rather than risking a skipped update.
- Cached snapshots contribute pending local edits only. The first server delivery persists every document in the bounded result, including metadata-only confirmations.
- Reconnects and busy queries reattach from the last persisted checkpoint. Queries are never result-limited. No error automatically starts an unbounded collection listener; explicit rollback still selects legacy synchronization.
- Removed query records are reconciled individually against the server, because a rejected edit can revert to a revision before the query cursor. Unresolved IDs survive restart, and rejected entries are retained in recovery metadata instead of counted in live totals.
- Any failed local commit fences later deliveries from that attachment. A retry resumes from disk; a newer snapshot cannot advance the checkpoint past unpersisted records.

The isolated smoke harness accepts `--incremental`, seeds only the demo project's control document, and uses the real conditional rules and shipping build gate. CI tests both modes, including online/offline checkout, restart, synchronization to a second profile, and exact stock. The rules suite tests compatibility with enforcement off, every mirrored collection with enforcement on, cashier batches, admin catch-all, bulk writes, and reset/activation guards. These tests do not replace verification on customer PCs.

## Guarded rollout audit

Set `FIREBASE_TOOLS_PATH` to the installed `firebase-tools` package directory and use an existing Firebase CLI login with project administration access. Tokens are used only for the official APIs and are never printed. The tool reads only sync-control/client metadata and deployed rules, not business records.

`node scripts/sync-rollout.mjs --project al-fateh-clinic` is read-only. It reports app/protocol versions, mirror readiness, freshness, activation blockers, and whether deployed rules exactly match the local tested file.

Only after all PCs are confirmed ready, run the same command with `--activate --confirm-all-devices-ready`. It rejects incomplete/old/stale clients, a rules mismatch, a reset, or missing explicit confirmation. It changes one control document with an update-time precondition and server timestamps, incrementing generation for a fresh baseline. A failed or uncertain mutation is not automatically retried. Inspect control state first.

For explicit rollback, use `--rollback`: it selects full legacy listeners without deleting cloud records, mirrors, or outboxes and leaves tracked-write enforcement intact. Reactivation requires a fresh generation and another readiness audit. Never replace enforced rules with legacy rules while incremental mode remains enabled.

The target of changed-record-only reconnect reads is a release-2 acceptance target, not a claim about release 1: legacy full listeners can still incur initial and reconnect query costs.

## Rollback and recovery

Set `rollbackToLegacy: true` or `incrementalEnabled: false` to select legacy synchronization in compatible releases. Never clear IndexedDB or Firebase persistence to fix a synchronization warning; preserve the sale outbox and error details for recovery.

An explicit Admin Reset uses a transaction lock, selects legacy mode, and increments dataset generation before deletion. Finalization increments generation again after successful or partial deletion. A failed finalization keeps the lock and legacy selection for administrator review. Routine updates do not invoke reset.

No new composite indexes are deployed in release 1. Remaining bounded operational queries use existing field indexes. Indexes do not reduce the cost of an unbounded collection listener by themselves.

## Validation

- `npm run lint`
- `npm test`
- `npm run test:rules` (local demo Firestore emulator)
- `npm run test:smoke` (two isolated Electron profiles, demo emulator only)
- `npx --yes firebase-tools@13.35.1 emulators:exec --only firestore --project demo-alfateh-clinic "node scripts/renderer-smoke.mjs --incremental"` (shipping stage 2 runtime; production control is unchanged)
- `npm run build`

The renderer smoke test bills online, bills offline, reopens billing and suppliers, reconnects, verifies two distinct sales and exact stock, confirms the second profile sees both sales, and reloads the first profile. It blocks non-local network requests, uses synthetic data, and suppresses printing. It does not validate physical printer output, a real Wi-Fi router, operating-system crashes, or customer PCs.

Publish rules before the desktop tag. Verify CI, installer, portable executable, blockmap, and `latest.yml`. Keep the release commit and tag aligned with `origin/main`.
