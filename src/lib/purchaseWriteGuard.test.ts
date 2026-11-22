import { describe, expect, it } from 'vitest';
import { purchaseGuardId, purchaseEditKey, purchasePayload } from './purchaseWriteGuard';
describe('stable purchase write identity',()=>{
  it('uses identical markers for a repeated receipt, but not another receipt',async()=>{
    expect(await purchaseGuardId('create:purchases/a')).toBe(await purchaseGuardId('create:purchases/a'));
    expect(await purchaseGuardId('create:purchases/a')).not.toBe(await purchaseGuardId('create:purchases/b'));
  });
  it('binds edits to the original saved revision',()=>{
    expect(purchaseEditKey({id:'p',updatedAt:'v1'})).toBe(purchaseEditKey({id:'p',updatedAt:'v1'}));
    expect(purchaseEditKey({id:'p',updatedAt:'v2'})).not.toBe(purchaseEditKey({id:'p',updatedAt:'v1'}));
  });
  it('ignores retry timestamps but detects changed quantities and prices',()=>{
    const line={medicineId:'m',totalUnitsAdded:125,totalCost:5630.5};
    expect(purchasePayload({...line,createdAt:'a',invoiceId:'a'})).toBe(purchasePayload({...line,createdAt:'b',invoiceId:'b'}));
    expect(purchasePayload(line)).not.toBe(purchasePayload({...line,totalUnitsAdded:250}));
    expect(purchasePayload(line)).not.toBe(purchasePayload({...line,totalCost:0}));
  });
});
