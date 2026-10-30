# Role access audit — v3.1.117

## Scope and data safety

Reviewed pharmacy and hospital routing/navigation, role creation and linked staff records, login/offline credentials, synchronization collection permissions, Firestore mutations and lab-report Storage access. Tests run against isolated demo projects, never the clinic's production records. No business-data migration, stock correction, record deletion, or account creation is part of deployment.

## Supported roles

| Role | Intended operational access |
| --- | --- |
| Admin | All existing pages, user administration, medicine/purchase editing, archive/restore and backup/reset controls |
| Pharmacist | Pharmacy inventory, supplier purchases/returns, POS billing, held bills, sales history, customer returns and hospital pharmacy |
| Cashier | POS billing, held bills, sales history, customer returns, patient Rx and hospital billing |
| Doctor | Clinical pages, own assigned OPD/appointments filtering, prescriptions/templates and lab order/results; no lab catalog editing |
| Nurse | Patients, appointments, OPD, IPD, token display and lab orders/results; no templates, medicine editing or administration |
| Receptionist | Clinical registration, appointments, OPD/IPD, token display, billing, scheduling and lab ordering/viewing; no lab result/catalog editing |
| Accountant | Hospital billing, expenses and reports; no expense deletion or stock editing |
| Lab technician / legacy `lab` | Laboratory results and test catalog; no clinical prescribing, new lab orders or billing |

Shared collection read scopes already used by the application are retained. Page visibility is not a new per-patient/doctor confidentiality boundary: existing Firestore clinical data remains shared as before. Unsupported roles receive a clear denial instead of a redirect/synchronization loop.

## Confirmed mismatches fixed

1. Pharmacist was labelled Inventory & Billing but could not open POS billing or customer returns. Enabled the matching routes and the required held-bill, customer-credit and return writes, while keeping medicine/purchase edits and archive controls admin-only.
2. Cashier dispensing of an HMS prescription failed because pharmacy-order updates only allowed pharmacists. Cashiers can now set dispensing status, timestamp and their own UID, not alter prescriptions.
3. Nurse/accountant (and legacy lab) accounts had no valid HMS landing route. Added role-specific working pages and consistent navigation; an account without POS access gets a clear access-denied view.
4. Doctor lab catalog editing, lab technician new-order creation, receptionist result entry, patient deletion and accountant expense deletion were offered despite server restrictions. Hid/guarded those actions rather than broadening those privileges.
5. OPD template saving was visible to receptionists. Restricted it to admin/doctor, matching the server.
6. Online login could enroll cached old permissions. Login now reads the server profile, resumes the Firestore network if a previous offline session disabled it, and rejects disabled/deleted/unconfigured roles.
7. Added a server-confirmed own-profile listener for live role/permission changes and revocation. Harmless metadata/name changes do not deliberately reset data; existing pending queues remain intact.
8. Firestore and Storage previously did not consistently reject `active:false` and `disabled:true`. All operational access now verifies an enabled supported profile; users can still read their own disabled profile so revocation can be explained. PDF upload permissions match lab-result editing roles.
9. Linked staff role/status changes did not update the actual login profile. Staff/profile updates now share one batch; new staff/profile document creation is also atomic. User-registration failures are no longer silently treated as successful staff logins. Account creation stays online and admin-only using secondary Auth, without signing out the admin.
10. Own-admin demotion/removal/disable controls are guarded to avoid accidental self-lockout. POS user management preserves all supported existing role choices instead of showing hospital roles as an inappropriate cashier selection.
11. HMS dashboard and global-search links could lead staff to unauthorized pages; filtered/guarded them. Non-admin dashboard no longer requests admin-only audit history. Notification read actions only modify notifications the current role owns or administers.
12. Offline UI tests exposed raw SDK lookups of absent optional hospital settings/schedules. These now read the verified complete mirror, where absence can be safely confirmed offline, instead of failing or guessing from an incomplete SDK cache.

## Validation

- Unit tests, TypeScript and production build.
- Firestore emulator matrix for all nine supported role values: every permitted bootstrap collection plus expected denied collections, shared-PC heartbeat registration, pharmacy dispensing/returns, clinical entries, lab/catalog boundaries, accountant operations and disabled-account rejection.
- Actual Electron page-render/navigation audit for every allowed POS/HMS page, online and with Firestore network disabled, plus unauthorized direct-URL handling.
- Actual Electron admin/cashier/pharmacist online/offline billing and customer-return scenarios with rapid checkout presses, persisted offline restart, reconnect and second-PC stock/history comparison.
- Existing admin synchronization/rollback, report, stock-shortfall recovery and thermal-print regression checks.

## Operational limits

Each new user must sign in online on each PC at least once before secure offline login is available. A PC must finish initial synchronization before offline entries. Remote role/password revocation cannot reach a disconnected PC until it reconnects. If an account's role is reduced while it has pending entries requiring its previous permissions, those entries remain preserved; reconnect with an authorized administrator to complete reconciliation. Firebase Authentication creation and Firestore profile creation are separate services: a failure between them is reported and must be checked, not hidden by deleting/recreating accounts or business records. Tests cannot guarantee protection against physical device/disk loss; keep verified backups and do not clear app data to resolve login/sync warnings.
