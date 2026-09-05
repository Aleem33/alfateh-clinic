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

## Release 2: activation prerequisites

`INCREMENTAL_ROLLOUT_READY` is deliberately false in this release. Remote flags alone cannot enable the new protocol. The paged bootstrap and incremental checkpoint implementation are included for testing, not active production use.

Before activation:

1. Every operational PC must install the compatibility release and finish its initial synchronization. Compare permitted collection counts and sales, stock, purchase, return, and customer balances with Firestore. Review pending/rejected changes.
2. Deploy and emulator-test rules requiring tracked metadata for every write, including all admin allow paths, and preventing ordinary physical deletion. Verify old clients actually receive a rejection for untracked writes. The proposed all-collection enforcement was not applied in this change because automatic approval review rejected its authorization scope.
3. Validate the incremental listener across long reconnects and reset generations, including bounded cursor reattachment and timestamp ties. Run multi-device billing tests in incremental mode and check read diagnostics against actual Firebase usage.
4. Publish a second release enabling the build gate. Set `trackedWritesRequired`, `incrementalEnabled`, and `minimumProtocolVersion` only after server enforcement is effective and client compatibility is confirmed.

The incremental prototype bootstraps in 250-document pages, persists each page and cursor transactionally, and captures a revision watermark before paging. Local checkpoints never use pending server-timestamp estimates. Interrupted pages resume from the last successful transaction. Rebuilding pauses for unresolved local writes.

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
- `npm run build`

The renderer smoke test bills online, bills offline, reopens billing and suppliers, reconnects, verifies two distinct sales and exact stock, confirms the second profile sees both sales, and reloads the first profile. It blocks non-local network requests, uses synthetic data, and suppresses printing. It does not validate physical printer output, a real Wi-Fi router, operating-system crashes, or customer PCs.

Publish rules before the desktop tag. Verify CI, installer, portable executable, blockmap, and `latest.yml`. Keep the release commit and tag aligned with `origin/main`.
