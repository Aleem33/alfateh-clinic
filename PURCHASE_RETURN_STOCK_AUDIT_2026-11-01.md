# Arq-e-gulab stock / purchase return investigation

## Read-only production findings

Batch AGU311225, supplier MIAN TRADER, has stock 333 individual units and unitsPerBox 30: 11 boxes plus 3 loose units. The batch has one bonus unit and a zero current cost price. A separate empty-batch record has zero stock; it was not merged or removed.

The linked purchase currently records zero paid units and one bonus unit, following an edit on 1 November 2026. Two cloud purchase returns already exist against this purchase: 10 paid units on 12 October and 2 paid units on 31 October. Thus the present purchase quantity is below its already recorded paid returns. Another return cannot safely be enabled by ignoring this contradiction. A purchase quantity is a historical receipt of goods, not an absolute current stock count. Editing it applies a delta, not a physical stock reset.

The current edited records do not establish the original opening stock or prove the cause of the whole balance discrepancy. The user cannot yet confirm whether the actual count is one bottle or one box, or whether goods were physically returned. No live record, quantity, cost, refund, sale, purchase or return was changed during this investigation.

## Scoped code fixes

- Check existing confirmed and queued purchase returns before saving purchase quantity edits; reject reductions below the already returned paid or bonus quantities. Wait for return history to load before editing. Unchanged-quantity cost/metadata repairs on old inconsistent records remain possible.
- Show an explicit review explanation for a purchase whose edited quantities contradict its historical returns, rather than only disabling its Return button.
- Distinguish supplier returns from verified physical-stock corrections and display individual-unit totals next to box/loose quantities.
- Normalize legacy paid/bonus quantities without counting bonus units as paid stock. Reject negative/fractional new return inputs.
- If a legacy purchase link is resolved unambiguously to a medicine batch, save and deduct from that same resolved ID. Never display one batch but write against a missing old ID.
- Preserve all existing business records; no data migration or automatic stock correction.

## Validation

296 unit tests, TypeScript and production build passed. The Electron/Firestore-emulator regression passed online/offline billing, durable restart/reconnect, second-device stock/history, existing recovery/report scenarios, blocked purchase quantity reduction, explicit 333-stock/1-purchased/12-returned conflict with unchanged stock, and a successful legacy purchase return against the correct batch.

## Remaining operational verification

Staff must count individual bottles for this exact batch and confirm the actual pack size and whether the old supplier returns represented physical goods. Then an administrator can make the verified stock correction in Medicines, retaining historical purchases/returns. Do not fabricate an additional supplier refund, guess one unit versus 30 units, rewrite the old purchase, or delete the prior returns to make the figures fit.

Changes are local on codex/purchase-return-stock-safety; no new desktop release or deployment was requested in this turn.
