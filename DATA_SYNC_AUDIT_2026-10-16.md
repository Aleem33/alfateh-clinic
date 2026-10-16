# Data and synchronization audit — v3.1.116

Scope: Firestore write gateway, IndexedDB mirror, incremental and legacy listeners,
sales and return outboxes, billing/return submission, purchase entry in POS/HMS/
supplier panels, authentication boundaries, backup and restore, and existing
business-date, archive, stock-allocation and synchronization rules.

## Confirmed causes corrected

| Cause | Effect | Correction |
| --- | --- | --- |
| A failed return stopped its entire queue | Later independent returns appeared missing on other PCs | Replay attempts each return independently; failed records retain their recovery copy and error |
| A sale server-check failure stopped the confirmation pass | Other already-uploaded sales remained pending | Isolate server-check failures per sale |
| Transaction writes emitted no confirmation activities | Recovery succeeded but old rejection warnings remained | Emit document IDs and fields for the successful transaction attempt only |
| Rejected auto-ID creation did not retain its actual document ID | Recovery could not identify the affected entry | Allocate the document reference before sending the create |
| Rejection recovery depended on the mirror seeing the local snapshot first | A fast rollback could remove the submitted create before recovery captured it | Preserve the submitted payload with the rejection event and persist it independently of the operational snapshot |
| A server read can still contain a pending local write | An unconfirmed document could be mistaken for a completed upload | Require both an existing document and `hasPendingWrites === false` before discarding its recovery copy |
| Return completion relied on connectivity flags | A connection change around commit could discard recovery too early | Explicit server confirmation, followed by local persistence, then removal of the recovery copy |
| Return buttons used asynchronous React state as their only lock | Rapid repeated clicks could create duplicate returns | Synchronous submission lock and active-operation exclusion during replay |
| Purchase return commit errors kept the completed form available | Staff could submit another return while the first was still queued | Keep the first exact ID in the durable queue, close the saved form, and show queued status |
| Supplier return history excluded its independent queue | Preserved returns disappeared from history after an authoritative rollback | Merge pending purchase returns by exact ID with the complete mirror, with a pending label |
| New medicine stock was committed before its purchase invoice | Invoice failure left stock without a corresponding purchase | Stage the new batch and invoice in one atomic batch in POS, HMS and supplier entry; reuse staged identities within an invoice |
| Legacy snapshots replaced full local histories on each change | Long persistence queues and UI stalls looked like missing or late entries | Establish the baseline once, then persist changed/removed documents only; establish baseline readiness only after persistence succeeds |
| A terminated legacy listener had no general recovery path | Permission or transport interruption left that collection stopped | Reattach recoverable listener errors with bounded delay and preserve the mirror |
| Listener errors remained after their own collection recovered | A successful device remained marked with a stale sync issue | Clear a listener error after that collection is confirmed, while keeping actual rejected writes flagged |
| Sync could begin using a persisted Firebase account before an active app session | Upload attempts could run under a different identity | Require the active session UID to match cloud authentication before draining outboxes |
| Billing/return audit identity preferred a stale cloud account during offline login | Entries could show the wrong operator | Prefer the verified active local session identity |
| Mirror record/checkpoint writes used default IndexedDB durability | A crash could lose the latest acknowledged local transaction | Use strict durability for mirror record and checkpoint transactions |
| Restoring an old backup overwrote existing IDs | Current stock, balances, prices or deletion state could revert | Validate the whole backup first; restore missing records transactionally while retaining existing IDs and prohibiting sync-control imports |
| A stored `_id` field could override the real document ID during backup export | An exported record could be assigned to the wrong document on restore | Write the authoritative Firestore ID last in every exported record |

## Protections reviewed and retained

- Firestore remains authoritative. No production records are merged, deleted,
  repriced or bulk-rewritten by this release.
- Sale/return recovery checks the original document ID and waits for the SDK queue
  before replaying. Its business date, paid/bonus allocation and original amounts
  remain part of the saved operation.
- Offline stock shortages retain the complete financial record and create an
  explicit reconciliation issue. Physical stock must be counted by an admin;
  the application cannot infer a missing physical quantity from conflicting
  offline snapshots.
- Incremental checkpoints overlap timestamp boundaries and advance with local
  persistence; paged bootstrap must complete before operational screens use it.
- Firestore role, archival and non-negative-stock restrictions remain enforced.
- Application updates do not clear IndexedDB or the offline outboxes.
- Full backups cover 37 business collections and reject unconfirmed queues rather
  than silently presenting an incomplete export as a complete backup.

## Verification

Focused regression tests cover queue isolation, active submissions, explicit cloud
confirmation, rejection before mirror delivery, transaction retries, atomic new
purchase batches, retaining unchanged legacy rows, and safe backup restoration.
Release verification also runs TypeScript, the full unit suite, Firestore emulator
permission tests, legacy and incremental online/offline renderer smoke tests,
production build and receipt printing isolation.

Local results: TypeScript passed; 253 unit tests passed; all 68 Firestore
permission tests passed in the emulator; both legacy and incremental renderer
smoke tests passed; production build and thermal print isolation passed.
No changes to Firestore security rules were required for this release.

## Operational limits

This is a source-code and emulator audit; it does not inspect each staff laptop's
private IndexedDB or establish that every historical production entry is already
uploaded. Queued entries still need the originating laptop's database to reconnect.
Keep that laptop's application data until its queues are confirmed. A deleted disk
or cleared application profile can only be recovered from another surviving copy
or backup. This release does not claim recovery of entries whose every copy has
already been erased.
