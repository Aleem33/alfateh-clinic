# v3.1.90 — Complete local records and fewer redundant reads

Repeated page, focus, and reconnect scans were downloading full sales histories, while Firebase's evictable cache could omit older records offline. Operational pages now read the complete IndexedDB mirror; one shared synchronization service reconciles Firestore changes.

- Initial synchronization shows progress and protects incomplete records from appearing as empty lists or zero totals.
- Medicines, batches, sales, returns, reports, purchases, and supplier panels use shared local records.
- Offline sale storage waits for a committed local transaction. Reconnection confirms the original write before replaying a missing sale, avoiding double stock deductions.
- New writes include revision metadata. Ordinary deletion becomes a recoverable tombstone with existing role restrictions.
- Logout, account changes, reset generations, and rejected edits have explicit recovery handling. Read diagnostics stay on the device.

Validation: 150 unit tests, 20 Firestore emulator tests, TypeScript, production build, and a two-profile Electron billing smoke test. The smoke test verifies online billing, offline billing, closing/reopening while offline, reconnection, another profile receiving both sales, and exact stock after restart.

This is stage 1 of the two-release transition. Legacy cloud listeners remain active while PCs build their mirrors. Incremental-only mode is disabled in this build and cannot be enabled by remote flags; stage 2 requires server enforcement and compatibility validation described in FIRESTORE_READ_REDUCTION.md. Existing cloud documents are not migrated, merged, or deleted by this update.
