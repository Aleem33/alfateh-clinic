// Explicit, narrowly scoped incident repair. Default is read-only.
// Never restores a backup or deletes/rewrites purchases, sales or returns.
const fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const PROJECT='al-fateh-clinic', MEDICINE='EN2TZ75YdGxHTNWzIpOW', PURCHASE='6nlEWGLBmAJcjOyHPyHi';
const INCIDENT='grasil-071p012-PUR-R0N2-000289-duplicate-stock-v1';
const ROOT=`projects/${PROJECT}/databases/(default)/documents`;
const endpoint=`https://firestore.googleapis.com/v1/${ROOT}`;
const decode=v=>v.stringValue??(v.integerValue!==undefined?Number(v.integerValue):v.doubleValue??v.booleanValue??v.timestampValue??(v.mapValue?Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,v])=>[k,decode(v)])):v.arrayValue?(v.arrayValue.values||[]).map(decode):null));
const unpack=d=>({id:d.name.split('/').pop(),...Object.fromEntries(Object.entries(d.fields||{}).map(([k,v])=>[k,decode(v)]))});
const encode=v=>v===null?{nullValue:null}:typeof v==='string'?{stringValue:v}:typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?(Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v}):Array.isArray(v)?{arrayValue:{values:v.map(encode)}}:{mapValue:{fields:fields(v)}};
const fields=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,encode(v)]));
async function main(){
  const backupPath=process.argv.find(value=>value.endsWith('.json'));
  if(!backupPath)throw Error('Supply the verified 2026-11-14 backup JSON path.');
  const raw=fs.readFileSync(backupPath);
  if(crypto.createHash('sha256').update(raw).digest('hex')!=='a6519baf6e0d1b0a33f20b5e5a489fd25b6b8b7c309fd4cd119ce802fb7ff3e4')throw Error('Unexpected backup: aborting.');
  const backup=JSON.parse(raw.toString().replace(/^\uFEFF/,''));
  const auth=require(path.join(process.env.APPDATA,'npm/node_modules/firebase-tools/lib/auth.js'));
  const token=await auth.getAccessToken(auth.getGlobalDefaultAccount().tokens.refresh_token,[]);
  const request=async(route,body)=>{
    const response=await fetch(endpoint+route,{method:'POST',headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error(`Firestore HTTP ${response.status}: repair not confirmed. Re-run read-only to check before retrying.`);
    return response.json();
  };
  const snapshots=await request(':batchGet',{documents:[`${ROOT}/medicines/${MEDICINE}`,`${ROOT}/purchases/${PURCHASE}`,`${ROOT}/stockMovements/${INCIDENT}`]});
  const completed=snapshots.find(row=>row.found?.name===`${ROOT}/stockMovements/${INCIDENT}`)?.found;
  if(completed){
    if(process.argv.includes('--apply') && process.argv.includes('--complete-audit')) {
      const saved=unpack(completed);
      if(saved.quantity!==-125 || saved.stockBefore-saved.stockAfter!==125)throw Error('Unexpected correction audit.');
      const name=`${ROOT}/stockMovements/${INCIDENT}-duplicate-application`;
      const existing=await request(':batchGet',{documents:[name]});
      if(!existing.some(row=>row.found))await request(':commit',{writes:[
        {verify:completed.name,currentDocument:{updateTime:completed.updateTime}},
        {update:{name,fields:fields({type:'duplicate-purchase-application-audit',medicineId:MEDICINE,medicineName:'grasil 50 mg',batchNo:'071p012',purchaseId:PURCHASE,incidentId:INCIDENT,quantity:125,paidUnits:125,bonusUnits:0,auditOnly:true,createdAt:saved.originalPurchase.createdAt,recordedAt:new Date().toISOString(),reason:'Document the previously unrecorded duplicate application. Paired with the -125 correction; this audit does not add stock or supplier payable.',syncProtocolVersion:2})},updateTransforms:[{fieldPath:'syncUpdatedAt',setToServerValue:'REQUEST_TIME'}],currentDocument:{exists:false}},
      ]});
      console.log('PAIRED_AUDIT_VERIFIED: no stock or invoice changes.');
    }
    console.log('ALREADY_CORRECTED: no further stock writes performed.');return;
  }
  const medicineDoc=snapshots.find(row=>row.found?.name===`${ROOT}/medicines/${MEDICINE}`)?.found;
  const purchaseDoc=snapshots.find(row=>row.found?.name===`${ROOT}/purchases/${PURCHASE}`)?.found;
  if(!medicineDoc || !purchaseDoc)throw Error('Incident medicine/purchase is missing.');
  const medicine=unpack(medicineDoc), purchase=unpack(purchaseDoc), readTime=snapshots[0].readTime;
  if(purchase.totalUnitsAdded!==125 || purchase.boxesPurchased!==25 || purchase.totalCost!==5630.5 || medicine.unitsPerBox!==5 || medicine.batchNo!=='071p012')throw Error('Incident details changed; manual investigation required.');
  const query=async collection=>{
    const result=await request(':runQuery',{readTime,structuredQuery:{from:[{collectionId:collection}],where:{fieldFilter:{field:{fieldPath:'medicineId'},op:'EQUAL',value:{stringValue:MEDICINE}}}}});
    return result.filter(row=>row.document).map(row=>unpack(row.document));
  };
  const purchases=await query('purchases'), movements=await query('stockMovements');
  const baselineMedicine=backup.collections.medicines.find(row=>row._id===MEDICINE);
  const previousPurchases=new Map(backup.collections.purchases.filter(row=>row.medicineId===MEDICINE).map(row=>[row._id,row]));
  const previousMovements=new Map(backup.collections.stockMovements.filter(row=>row.medicineId===MEDICINE).map(row=>[row._id,row]));
  const received=row=>Number(row.totalUnitsAdded ?? row.unitsAdded ?? 0);
  const movement=row=>Number(row.appliedQuantity ?? row.quantity ?? 0);
  // Compare IDs, not creation dates: late uploads and changes to older records
  // must be included in the reconciliation.
  const purchaseDelta=purchases.reduce((sum,row)=>sum+received(row)-(previousPurchases.has(row.id)?received(previousPurchases.get(row.id)):0),0);
  const movementDelta=movements.reduce((sum,row)=>sum+movement(row)-(previousMovements.has(row.id)?movement(previousMovements.get(row.id)):0),0);
  if([...previousPurchases.keys()].some(id=>!purchases.some(row=>row.id===id)) || [...previousMovements.keys()].some(id=>!movements.some(row=>row.id===id)))throw Error('Historical records missing; no automatic repair permitted.');
  const expected=Number(baselineMedicine.stock)+purchaseDelta+movementDelta;
  const excess=Number(medicine.stock)-expected;
  const summary={incident:INCIDENT,readTime,baselineStock:baselineMedicine.stock,purchaseDelta,movementDelta,currentStock:medicine.stock,ledgerStock:expected,excessUnits:excess,purchaseAmountUnchanged:purchase.totalCost};
  console.log(JSON.stringify(summary));
  if(excess!==125 || expected<0 || expected<Number(medicine.bonusStockUnits || 0))throw Error('Ledger does not prove the exact 125-unit excess; refusing repair.');
  if(!process.argv.includes('--apply')){console.log('DRY_RUN: no production writes.');return;}
  const now=new Date().toISOString();
  const audit={...summary,type:'stock-correction',medicineId:MEDICINE,medicineName:'grasil 50 mg',batchNo:'071p012',purchaseId:PURCHASE,purchaseBillNo:purchase.purchaseBillNo,quantity:-125,paidUnits:-125,bonusUnits:0,stockBefore:medicine.stock,stockAfter:expected,stockValueReduction:5630.5,reason:'Remove one duplicate purchase-stock application; retain the original 25-box purchase and all sales/returns.',createdAt:now,createdBy:'authorized-incident-repair',originalMedicine:medicine,originalPurchase:purchase,syncProtocolVersion:2};
  await request(':commit',{writes:[
    {verify:purchaseDoc.name,currentDocument:{updateTime:purchaseDoc.updateTime}},
    {update:{name:medicineDoc.name,fields:fields({stock:expected,updatedAt:now,syncProtocolVersion:2})},updateMask:{fieldPaths:['stock','updatedAt','syncProtocolVersion']},updateTransforms:[{fieldPath:'syncUpdatedAt',setToServerValue:'REQUEST_TIME'}],currentDocument:{updateTime:medicineDoc.updateTime}},
    ...['stockMovements','auditLogs'].map(collection=>({update:{name:`${ROOT}/${collection}/${INCIDENT}`,fields:fields(audit)},updateTransforms:[{fieldPath:'syncUpdatedAt',setToServerValue:'REQUEST_TIME'}],currentDocument:{exists:false}})),
    {update:{name:`${ROOT}/stockMovements/${INCIDENT}-duplicate-application`,fields:fields({type:'duplicate-purchase-application-audit',medicineId:MEDICINE,medicineName:'grasil 50 mg',batchNo:'071p012',purchaseId:PURCHASE,incidentId:INCIDENT,quantity:125,paidUnits:125,bonusUnits:0,auditOnly:true,createdAt:purchase.createdAt,recordedAt:now,reason:'Previously unrecorded duplicate stock application, paired with the correction. Audit only; no supplier payable.',syncProtocolVersion:2})},updateTransforms:[{fieldPath:'syncUpdatedAt',setToServerValue:'REQUEST_TIME'}],currentDocument:{exists:false}},
  ]});
  console.log('CORRECTION_COMMITTED: exactly 125 excess units removed atomically; original records retained.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
