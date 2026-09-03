import React, { useState, useEffect, useMemo, useRef } from 'react';
import { collection, onSnapshot, addDoc, deleteDoc, doc, updateDoc, increment, writeBatch } from '@/lib/firestore';
import { printOrShare, printPageOrShare } from '../lib/nativeUtils';
import { db, auth, handleFirestoreError, OperationType, getNextPosReceiptNo } from '../../firebase';
import { formatCurrency } from '../lib/utils';
import { getSaleReceiptNo } from '../lib/receiptNumbers';
import { waitForOnlineWrite } from '../../lib/offlineWrite';
import {
  Search, Plus, Minus, Trash2, Printer, ShoppingCart, Tag,
  User, UserCheck, UserX, ChevronDown, Percent, DollarSign,
  UserPlus, Check, X, Pill, ClipboardList, CheckCircle, PauseCircle, PlayCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import { groupMedicineBatches, normalizeMedicineText, searchMedicines } from '../../lib/medicineIndex';
import { subscribeToMedicines } from '../../lib/medicineStore';
import { calculateBillDiscount, normalizeBillDiscountValue, type BillDiscountType } from '../lib/billDiscount';
import { PHARMACY_RECEIPT_NAME, PHARMACY_RETURN_POLICY_URDU } from '../lib/receiptBrand';
import { cartItemUnits, findCartStockProblem } from '../lib/billingCart';
import { aggregateSaleStockAdjustments, queuePendingPosSale, removePendingPosSale } from '../lib/offlineSalesOutbox';
import { allocateCartBonusCost } from '../lib/bonusInventory';
import { isCloudOnline } from '../../lib/lanCoordinator';
import { clinicDateKey, clinicTimeLabel, recordClinicDateTimeLabel } from '../../lib/clinicDate';
import { getTrustedClockReading, trustedNow, trustedNowISO } from '../../lib/trustedClock';

export function Billing() {
  const [medicines, setMedicines]       = useState<any[]>([]);
  const [customers, setCustomers]       = useState<any[]>([]);
  const [search, setSearch]             = useState('');
  const [cart, setCart]                 = useState<any[]>([]);
  const [qtyInputs, setQtyInputs]       = useState<Record<string, string>>({});
  const [orderDiscountType, setOrderDiscountType] = useState<BillDiscountType>('rs');
  const [orderDiscountValue, setOrderDiscountValue] = useState(0);
  const [customerType, setCustomerType] = useState<'customer' | 'hospital'>('customer');
  const [lastReceipt, setLastReceipt]   = useState<any>(null);
  const [showPrintAlert, setShowPrintAlert] = useState(false);
  const [stockError, setStockError]     = useState('');
  const [pharmacyOrders, setPharmacyOrders] = useState<any[]>([]);
  const [showRxModal, setShowRxModal] = useState(false);
  const [rxSearch, setRxSearch] = useState('');
  const [batchSelector, setBatchSelector] = useState<any[] | null>(null);
  const [heldBills, setHeldBills] = useState<any[]>([]);
  const [showHeldBills, setShowHeldBills] = useState(false);
  const [showHoldModal, setShowHoldModal] = useState(false);
  const [holdLabel, setHoldLabel] = useState('');
  const [isHoldingBill, setIsHoldingBill] = useState(false);
  const [billingNotice, setBillingNotice] = useState('');

  // Mobile: which tab is active
  const [mobileTab, setMobileTab] = useState<'medicines' | 'cart'>('medicines');

  // Customer selection
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
  const [customerSearch, setCustomerSearch]     = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const customerDropdownRef = useRef<HTMLDivElement>(null);

  // Create new customer inline
  const [showCreateForm, setShowCreateForm]   = useState(false);
  const [newCustName, setNewCustName]         = useState('');
  const [newCustPhone, setNewCustPhone]       = useState('');
  const [savingCustomer, setSavingCustomer]   = useState(false);

  // Partial payment
  const [amountPaid, setAmountPaid] = useState<number | ''>('');

  useEffect(() => {
    const unsub1 = subscribeToMedicines(
      setMedicines,
      err => handleFirestoreError(err, OperationType.GET, 'medicines'),
    );
    const unsub2 = onSnapshot(collection(db, 'customers'), snap => {
      setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => handleFirestoreError(err, OperationType.GET, 'customers'));
    const unsub3 = onSnapshot(collection(db, 'pharmacyOrders'), snap => {
      setPharmacyOrders(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter((o: any) => o.status === 'pending')
          .sort((a: any, b: any) => (b.createdAt > a.createdAt ? 1 : -1))
      );
    }, err => handleFirestoreError(err, OperationType.GET, 'pharmacyOrders'));
    const unsub4 = onSnapshot(collection(db, 'heldBills'), snap => {
      setHeldBills(snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a: any, b: any) =>
          String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))
        ));
    }, err => handleFirestoreError(err, OperationType.GET, 'heldBills'));
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      if (customerDropdownRef.current && !customerDropdownRef.current.contains(e.target as Node))
        setShowCustomerDropdown(false);
    };
    // mousedown for desktop, touchstart for Android WebView
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, []);

  const filteredMedicines = searchMedicines(medicines, search, { inStockOnly: true });

  const medicineGroups = useMemo(() => groupMedicineBatches(filteredMedicines), [filteredMedicines]);

  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    (c.phone || '').includes(customerSearch)
  ).slice(0, 8);

  const getBoxPrice = (med: any): number => Number(med.retailPrice || med.price || med.costPrice || 0);
  const getUnitPrice = (med: any): number => {
    const explicitUnitPrice = Number(med.unitPrice || 0);
    if (explicitUnitPrice > 0) return explicitUnitPrice;
    const boxPrice = getBoxPrice(med);
    const unitsPerBox = Number(med.unitsPerBox || 1);
    return unitsPerBox > 1 && boxPrice > 0 ? boxPrice / unitsPerBox : boxPrice;
  };

  const handleCreateCustomer = async () => {
    if (!newCustName.trim()) return;
    setSavingCustomer(true);
    try {
      const docRef = await addDoc(collection(db, 'customers'), {
        name: newCustName.trim(), phone: newCustPhone.trim(),
        creditBalance: 0, createdAt: trustedNowISO(),
      });
      setSelectedCustomer({ id: docRef.id, name: newCustName.trim(), phone: newCustPhone.trim(), creditBalance: 0 });
      setShowCreateForm(false); setNewCustName(''); setNewCustPhone('');
      setCustomerSearch(''); setShowCustomerDropdown(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'customers');
    } finally { setSavingCustomer(false); }
  };

  const addToCart = (med: any, sellType: 'box' | 'unit') => {
    setCart(prev => {
      const cartItemId = `${med.id}-${sellType}`;
      const existing   = prev.find(item => item.cartItemId === cartItemId);
      const price      = sellType === 'box' ? getBoxPrice(med) : getUnitPrice(med);
      const unitsToAdd = sellType === 'box' ? (med.unitsPerBox || 1) : 1;
      const currentUnitsInCart = prev
        .filter(i => i.medicineId === med.id)
        .reduce((sum, i) => sum + (i.quantity * (i.sellType === 'box' ? i.unitsPerBox : 1)), 0);
      if (currentUnitsInCart + unitsToAdd > med.stock) {
        setStockError('Not enough stock available for ' + med.name + '!');
        setTimeout(() => setStockError(''), 3500);
        return prev;
      }
      if (existing) {
        return prev.map(item => {
          if (item.cartItemId !== cartItemId) return item;
          const newQ = item.quantity + 1;
          const disc = computeItemDiscountRs(item.discountType, item.discountValue, newQ, item.price);
          return { ...item, quantity: newQ, itemDiscount: disc, total: Math.max(0, newQ * item.price - disc) };
        });
      }
      return [...prev, {
        cartItemId, medicineId: med.id, name: med.name, sellType, price,
        costPrice: med.costPrice || 0, quantity: 1,
        batchNo: med.batchNo || '', expiryDate: med.expiryDate || '',
        supplierName: med.supplierName || '',
        discountType: 'rs' as 'rs' | 'pct', discountValue: 0, itemDiscount: 0,
        total: price, unitsPerBox: med.unitsPerBox || 1,
      }];
    });
    // Auto-switch to cart tab on mobile after adding
    setMobileTab('cart');
  };

  function computeItemDiscountRs(type: 'rs' | 'pct', value: number, qty: number, price: number): number {
    if (!value) return 0;
    const maxDiscount = qty * price;
    if (type === 'pct') return Math.min(maxDiscount, (value / 100) * maxDiscount);
    return Math.min(maxDiscount, Math.max(0, value));
  }

  const updateQuantity = (cartItemId: string, delta: number) => {
    setQtyInputs(prev => {
      const next = { ...prev };
      delete next[cartItemId];
      return next;
    });
    setCart(prev => prev.map(item => {
      if (item.cartItemId !== cartItemId) return item;
      const med = medicines.find(m => m.id === item.medicineId);
      if (!med) return item;
      const newQ = Math.max(1, item.quantity + delta);
      const otherUnits = prev
        .filter(i => i.medicineId === med.id && i.cartItemId !== cartItemId)
        .reduce((sum, i) => sum + (i.quantity * (i.sellType === 'box' ? i.unitsPerBox : 1)), 0);
      if (otherUnits + newQ * (item.sellType === 'box' ? item.unitsPerBox : 1) > med.stock) return item;
      const disc = computeItemDiscountRs(item.discountType, item.discountValue, newQ, item.price);
      return { ...item, quantity: newQ, itemDiscount: disc, total: Math.max(0, newQ * item.price - disc) };
    }));
  };

  const setQuantity = (cartItemId: string, quantity: number) => {
    setCart(prev => prev.map(item => {
      if (item.cartItemId !== cartItemId) return item;
      const med = medicines.find(m => m.id === item.medicineId);
      if (!med) return item;
      const newQ = Math.max(1, Math.floor(Number(quantity) || 1));
      const otherUnits = prev
        .filter(i => i.medicineId === med.id && i.cartItemId !== cartItemId)
        .reduce((sum, i) => sum + (i.quantity * (i.sellType === 'box' ? i.unitsPerBox : 1)), 0);
      if (otherUnits + newQ * (item.sellType === 'box' ? item.unitsPerBox : 1) > med.stock) {
        setStockError('Not enough stock available for ' + med.name + '!');
        setTimeout(() => setStockError(''), 3500);
        return item;
      }
      const disc = computeItemDiscountRs(item.discountType, item.discountValue, newQ, item.price);
      return { ...item, quantity: newQ, itemDiscount: disc, total: Math.max(0, newQ * item.price - disc) };
    }));
  };

  const handleQuantityInput = (cartItemId: string, value: string) => {
    setQtyInputs(prev => ({ ...prev, [cartItemId]: value }));
    if (value.trim() === '') return;
    const nextQuantity = Number(value);
    if (Number.isFinite(nextQuantity) && nextQuantity >= 1) setQuantity(cartItemId, nextQuantity);
  };

  const commitQuantityInput = (cartItemId: string) => {
    const value = qtyInputs[cartItemId];
    if (value !== undefined && value.trim() === '') setQuantity(cartItemId, 1);
    setQtyInputs(prev => {
      const next = { ...prev };
      delete next[cartItemId];
      return next;
    });
  };

  const updateItemDiscount = (cartItemId: string, type: 'rs' | 'pct', value: number) => {
    setCart(prev => prev.map(item => {
      if (item.cartItemId !== cartItemId) return item;
      const disc = computeItemDiscountRs(type, value, item.quantity, item.price);
      return { ...item, discountType: type, discountValue: value, itemDiscount: disc, total: Math.max(0, item.quantity * item.price - disc) };
    }));
  };

  const removeFromCart = (cartItemId: string) => {
    setQtyInputs(prev => {
      const next = { ...prev };
      delete next[cartItemId];
      return next;
    });
    setCart(prev => prev.filter(item => item.cartItemId !== cartItemId));
  };

  const grossSubtotal        = cart.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const totalItemDiscounts   = cart.reduce((sum, item) => sum + (item.itemDiscount || 0), 0);
  const subtotalAfterItemDisc = cart.reduce((sum, item) => sum + item.total, 0);
  const orderDiscountAmount  = calculateBillDiscount(subtotalAfterItemDisc, orderDiscountType, orderDiscountValue);
  const grandTotal           = Math.max(0, subtotalAfterItemDisc - orderDiscountAmount);
  const effectiveAmountPaid  = amountPaid === '' ? grandTotal : Math.min(Number(amountPaid), grandTotal);
  const pendingAmount        = Math.max(0, grandTotal - effectiveAmountPaid);

  const clearCurrentBill = () => {
    setCart([]);
    setQtyInputs({});
    setOrderDiscountType('rs');
    setOrderDiscountValue(0);
    setAmountPaid('');
    setSelectedCustomer(null);
    setCustomerSearch('');
    setCustomerType('customer');
    setMobileTab('medicines');
  };

  const showNotice = (message: string) => {
    setBillingNotice(message);
    setTimeout(() => setBillingNotice(''), 4000);
  };

  const handleHoldBill = async () => {
    if (cart.length === 0 || isHoldingBill) return;
    setIsHoldingBill(true);
    try {
      const now = trustedNowISO();
      const fallbackLabel = selectedCustomer?.name || `Held bill ${clinicTimeLabel(trustedNow())}`;
      await waitForOnlineWrite(addDoc(collection(db, 'heldBills'), {
        label: holdLabel.trim() || fallbackLabel,
        items: cart,
        customerType,
        customer: selectedCustomer ? {
          id: selectedCustomer.id,
          name: selectedCustomer.name,
          phone: selectedCustomer.phone || '',
          creditBalance: Number(selectedCustomer.creditBalance || 0),
        } : null,
        orderDiscountType,
        orderDiscountValue,
        amountPaid,
        grossSubtotal,
        totalItemDiscounts,
        subtotal: subtotalAfterItemDisc,
        orderDiscount: orderDiscountAmount,
        total: grandTotal,
        createdAt: now,
        updatedAt: now,
        createdBy: auth.currentUser?.uid || '',
      }));
      clearCurrentBill();
      setHoldLabel('');
      setShowHoldModal(false);
      showNotice('Bill held safely. You can resume it from Held Bills.');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'heldBills');
    } finally {
      setIsHoldingBill(false);
    }
  };

  const handleResumeBill = async (heldBill: any) => {
    if (cart.length > 0) {
      setStockError('Hold or finish the current bill before resuming another bill.');
      setTimeout(() => setStockError(''), 4500);
      return;
    }
    const heldItems = Array.isArray(heldBill.items) ? heldBill.items : [];
    setCart(heldItems);
    setQtyInputs({});
    setCustomerType(heldBill.customerType === 'hospital' ? 'hospital' : 'customer');
    setOrderDiscountType(heldBill.orderDiscountType === 'pct' ? 'pct' : 'rs');
    setOrderDiscountValue(Number(heldBill.orderDiscountValue || 0));
    setAmountPaid(heldBill.amountPaid === '' || heldBill.amountPaid == null ? '' : Number(heldBill.amountPaid));
    const currentCustomer = heldBill.customer?.id
      ? customers.find(customer => customer.id === heldBill.customer.id)
      : null;
    setSelectedCustomer(currentCustomer || heldBill.customer || null);
    setCustomerSearch('');
    setShowHeldBills(false);
    setMobileTab('cart');
    try {
      await waitForOnlineWrite(deleteDoc(doc(db, 'heldBills', heldBill.id)));
      showNotice(`${heldBill.label || 'Held bill'} resumed.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `heldBills/${heldBill.id}`);
    }
    const stockProblem = findCartStockProblem(heldItems, medicines);
    if (stockProblem) setStockError(stockProblem);
  };

  const handlePrint = () => {
    if (window !== window.top) {
      setShowPrintAlert(true); setTimeout(() => setShowPrintAlert(false), 5000);
    } else { printPageOrShare('Receipt'); }
  };

  const loadPrescription = (order: any) => {
    const newItems: any[] = [];
    for (const rx of (order.prescriptions || [])) {
      const matchingBatches = medicines.filter(
        m => m.name.toLowerCase().trim() === rx.name.toLowerCase().trim() && m.stock > 0
      );
      if (matchingBatches.length > 1) {
        setStockError(`${rx.name} has multiple batches. Search it and select the batch to sell.`);
        setTimeout(() => setStockError(''), 5000);
        continue;
      }
      const med = matchingBatches[0];
      if (!med) continue;
      const cartItemId = `${med.id}-unit`;
      if (newItems.find(i => i.cartItemId === cartItemId) || cart.find(i => i.cartItemId === cartItemId)) continue;
      const price = getUnitPrice(med);
      newItems.push({
        cartItemId,
        medicineId: med.id,
        name: med.name,
        sellType: 'unit',
        price,
        costPrice: med.costPrice || 0,
        batchNo: med.batchNo || '',
        expiryDate: med.expiryDate || '',
        supplierName: med.supplierName || '',
        quantity: 1,
        discountType: 'rs' as 'rs' | 'pct',
        discountValue: 0,
        itemDiscount: 0,
        total: price,
        unitsPerBox: med.unitsPerBox || 1,
        rxNote: `${rx.scheduleText || [rx.dosage, rx.frequency].filter(Boolean).join(' ')} ${rx.duration || ''}`.trim(),
      });
    }
    setCart(prev => [...prev, ...newItems]);
    setCustomerType('hospital');
    setShowRxModal(false);
    setMobileTab('cart');
    updateDoc(doc(db, 'pharmacyOrders', order.id), {
      status: 'dispensed',
      dispensedAt: trustedNowISO(),
      dispensedBy: auth.currentUser?.uid || '',
    }).catch(error => handleFirestoreError(error, OperationType.UPDATE, `pharmacyOrders/${order.id}`));
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    const stockProblem = findCartStockProblem(cart, medicines);
    if (stockProblem) {
      setStockError(stockProblem);
      return;
    }
    try {
      const receiptNo = await getNextPosReceiptNo();
      const saleClock = await getTrustedClockReading();
      const saleTimestamp = saleClock.nowIso;
      const saleItems = allocateCartBonusCost(cart, medicines);
      const saleData: any = {
        receiptNo,
        items: saleItems, grossSubtotal, totalItemDiscounts,
        subtotal: subtotalAfterItemDisc,
        orderDiscount: orderDiscountAmount,
        orderDiscountType,
        orderDiscountValue: normalizeBillDiscountValue(orderDiscountType, orderDiscountValue),
        discount: orderDiscountAmount + totalItemDiscounts, total: grandTotal,
        amountPaid: effectiveAmountPaid, pendingAmount,
        date: saleTimestamp,
        trustedDate: saleTimestamp,
        businessDate: clinicDateKey(saleTimestamp),
        timeSource: saleClock.source,
        customerType,
        cashierId: auth.currentUser?.uid,
      };
      if (selectedCustomer) {
        saleData.customerId    = selectedCustomer.id;
        saleData.customerName  = selectedCustomer.name;
        saleData.customerPhone = selectedCustomer.phone || '';
      }
      const batch = writeBatch(db);
      const docRef = doc(collection(db, 'sales'));
      const stockAdjustments = aggregateSaleStockAdjustments(saleItems);
      const movements: Array<{ id: string; data: Record<string, any> }> = [];
      batch.set(docRef, saleData);
      for (const item of saleItems) {
        const unitsToDeduct = item.quantity * (item.sellType === 'box' ? item.unitsPerBox : 1);
        const movementRef = doc(collection(db, 'stockMovements'));
        const movementData = {
          type: 'sale',
          saleId: docRef.id,
          receiptNo,
          medicineId: item.medicineId,
          medicineName: item.name,
          batchNo: item.batchNo || '',
          quantity: -unitsToDeduct,
          paidUnits: -Number(item.paidUnitsSold || 0),
          bonusUnits: -Number(item.bonusUnitsSold || 0),
          deviceReceiptNo: receiptNo,
          createdAt: saleTimestamp,
          cashierId: auth.currentUser?.uid || '',
        };
        movements.push({ id: movementRef.id, data: movementData });
        batch.set(movementRef, movementData);
      }
      stockAdjustments.forEach(adjustment => {
        batch.update(doc(db, 'medicines', adjustment.medicineId), {
          stock: increment(-adjustment.units),
          ...(adjustment.bonusUnits ? { bonusStockUnits: increment(-adjustment.bonusUnits) } : {}),
        });
      });
      if (selectedCustomer && pendingAmount > 0) {
        batch.update(doc(db, 'customers', selectedCustomer.id), { creditBalance: increment(pendingAmount) });
      }
      await queuePendingPosSale({
        saleId: docRef.id,
        saleData,
        movements,
        stockAdjustments,
        ...(selectedCustomer && pendingAmount > 0
          ? { customerAdjustment: { customerId: selectedCustomer.id, pendingAmount } }
          : {}),
        createdAt: saleTimestamp,
      });
      await waitForOnlineWrite(batch.commit());
      if (isCloudOnline()) await removePendingPosSale(docRef.id);
      setLastReceipt({ ...saleData, id: docRef.id });
      setCart([]); setOrderDiscountType('rs'); setOrderDiscountValue(0); setAmountPaid('');
      setSelectedCustomer(null); setCustomerSearch('');
      setMobileTab('medicines');
      setTimeout(handlePrint, 500);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'sales');
    }
  };

  const formatStock = (stock: number, unitsPerBox: number) => {
    if (!unitsPerBox || unitsPerBox <= 1) return `${stock} Units`;
    const boxes = Math.floor(stock / unitsPerBox);
    const loose = stock % unitsPerBox;
    if (boxes > 0 && loose > 0) return `${boxes} Box, ${loose} Loose`;
    if (boxes > 0) return `${boxes} Box`;
    return `${loose} Loose`;
  };

  // ── Shared panel components ───────────────────────────────────────────────

  const MedicinesPanel = () => (
    <div className="flex-1 min-h-0 flex flex-col bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-4 border-b border-gray-100">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search medicines by name or batch..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
            />
          </div>
          <button
            onClick={() => { setShowRxModal(true); setRxSearch(''); }}
            className="relative flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 shrink-0"
          >
            <ClipboardList className="w-4 h-4" />
            Load Rx
            {pharmacyOrders.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                {pharmacyOrders.length > 9 ? '9+' : pharmacyOrders.length}
              </span>
            )}
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-500">Showing {medicineGroups.length} medicines across {filteredMedicines.length} in-stock batch records.</p>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <div className="hidden sm:grid grid-cols-[minmax(0,2fr)_minmax(90px,1fr)_minmax(110px,1fr)_auto] gap-3 px-4 py-2 bg-gray-50 border-b border-gray-100 text-[11px] font-bold uppercase tracking-wide text-gray-500 sticky top-0 z-10">
          <span>Medicine</span><span>Batch / Stock</span><span>Price</span><span className="text-center">Action</span>
        </div>
        <div className="divide-y divide-gray-100">
          {medicineGroups.map(group => {
            const med = group.batches[0];
            const hasMultipleBatches = group.batches.length > 1;
            const retailPrices = group.batches.map((batch: any) => getBoxPrice(batch));
            const minRetail = Math.min(...retailPrices);
            const maxRetail = Math.max(...retailPrices);
            return (
              <div key={group.key} className={`grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(90px,1fr)_minmax(110px,1fr)_auto] gap-2 sm:gap-3 items-center px-4 py-3 hover:bg-blue-50/50 transition-colors ${hasMultipleBatches ? 'border-l-4 border-l-orange-400' : 'border-l-4 border-l-transparent'}`}>
                <div className="min-w-0">
                  <h3 className="font-bold text-gray-900 text-sm leading-tight truncate">{group.name}</h3>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-purple-700 bg-purple-50 border border-purple-100 rounded px-1.5 py-0.5">{group.form || 'Medicine'}</span>
                    <span className="text-[11px] text-gray-500 truncate">{hasMultipleBatches ? `${group.batches.length} batches available` : (med.supplierName || 'No supplier')}</span>
                  </div>
                </div>
                <div className="text-xs">
                  <p className="font-semibold text-orange-700">{hasMultipleBatches ? `${group.batches.length} batches` : `Batch ${med.batchNo || 'N/A'}`}</p>
                  <p className="text-gray-500 mt-0.5">{hasMultipleBatches ? `${group.totalStock} total units` : formatStock(med.stock, med.unitsPerBox)}</p>
                </div>
                <div className="text-xs">
                  <p className="font-bold text-blue-700">
                  {hasMultipleBatches
                    ? `Retail ${formatCurrency(minRetail)}${minRetail !== maxRetail ? ` – ${formatCurrency(maxRetail)}` : ''}`
                    : formatCurrency(getBoxPrice(med))}
                  </p>
                  {!hasMultipleBatches && Number(med.costPrice || 0) > 0 && <p className="text-[10px] text-amber-700 mt-0.5">Cost {formatCurrency(med.costPrice)}</p>}
                </div>
                <div className="sm:min-w-[132px]">
                  {hasMultipleBatches ? (
                  <button onClick={() => setBatchSelector(group.batches)}
                    className="w-full bg-orange-600 text-white px-3 py-2 rounded-md text-xs font-bold hover:bg-orange-700">
                    Select Batch ({group.batches.length})
                  </button>
                ) : med.unitsPerBox > 1 ? (
                  <div className="flex gap-1.5">
                    <button onClick={() => addToCart(med, 'box')}
                      className="flex-1 bg-blue-50 text-blue-700 py-1.5 rounded-md text-[11px] font-bold hover:bg-blue-100 border border-blue-100 text-center leading-snug">
                      + Box<br /><span className="font-normal text-[10px]">{formatCurrency(getBoxPrice(med))}</span>
                    </button>
                    <button onClick={() => addToCart(med, 'unit')}
                      className="flex-1 bg-green-50 text-green-700 py-1.5 rounded-md text-[11px] font-bold hover:bg-green-100 border border-green-100 text-center leading-snug">
                      + Unit<br /><span className="font-normal text-[10px]">{formatCurrency(getUnitPrice(med))}</span>
                    </button>
                  </div>
                ) : (
                  <button onClick={() => addToCart(med, 'box')}
                    className="w-full bg-blue-50 text-blue-700 py-2 rounded-md text-xs font-bold hover:bg-blue-100 border border-blue-100">
                    Add - {formatCurrency(getBoxPrice(med))}
                  </button>
                )}
              </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  const CartPanel = () => (
    <div className="flex-1 min-h-0 md:w-96 md:flex-none bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col overflow-hidden">
      {/* Cart header */}
      <div className="p-4 border-b border-gray-100 bg-gray-50 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-gray-900 hidden md:block">Current Sale</h2>
          <div className="flex gap-2 ml-auto">
            <button type="button" onClick={() => setShowHeldBills(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100">
              <PlayCircle className="w-4 h-4" /> Held ({heldBills.length})
            </button>
            <button type="button" disabled={cart.length === 0} onClick={() => { setHoldLabel(selectedCustomer?.name || ''); setShowHoldModal(true); }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-orange-700 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 disabled:opacity-40 disabled:cursor-not-allowed">
              <PauseCircle className="w-4 h-4" /> Hold Bill
            </button>
          </div>
        </div>

        {/* Sale type toggle */}
        <div className="flex bg-white rounded-lg p-1 border border-gray-200">
          <button onClick={() => setCustomerType('customer')}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${customerType === 'customer' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}>
            Customer
          </button>
          <button onClick={() => setCustomerType('hospital')}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${customerType === 'hospital' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}>
            Hospital
          </button>
        </div>

        {/* Customer selection */}
        <div ref={customerDropdownRef} className="relative">
          <div className="flex items-center gap-1.5 mb-1">
            <User className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-xs font-medium text-gray-500">
              Customer <span className="text-gray-400 font-normal">(optional)</span>
            </span>
            {selectedCustomer && (
              <button onClick={() => { setSelectedCustomer(null); setCustomerSearch(''); setShowCreateForm(false); }}
                className="ml-auto text-xs text-red-500 hover:text-red-700 flex items-center gap-0.5">
                <UserX className="w-3 h-3" /> Remove
              </button>
            )}
          </div>

          {selectedCustomer ? (
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              <UserCheck className="w-4 h-4 text-blue-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-blue-800 truncate">{selectedCustomer.name}</p>
                {selectedCustomer.phone && <p className="text-xs text-blue-500">{selectedCustomer.phone}</p>}
                {(selectedCustomer.creditBalance || 0) > 0 && (
                  <p className="text-xs text-red-600 font-medium mt-0.5">Outstanding: {formatCurrency(selectedCustomer.creditBalance)}</p>
                )}
              </div>
            </div>
          ) : showCreateForm ? (
            <div className="border border-blue-300 bg-blue-50 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-blue-700 flex items-center gap-1">
                  <UserPlus className="w-3.5 h-3.5" /> New Customer
                </span>
                <button onClick={() => { setShowCreateForm(false); setNewCustName(''); setNewCustPhone(''); }}
                  className="text-gray-400 hover:text-gray-600"><X className="w-3.5 h-3.5" /></button>
              </div>
              <input type="text" placeholder="Full name *" value={newCustName}
                onChange={e => setNewCustName(e.target.value)} autoFocus
                className="w-full px-2.5 py-1.5 border border-blue-200 rounded-md text-xs focus:outline-none focus:border-blue-400 bg-white" />
              <input type="text" placeholder="Phone number (optional)" value={newCustPhone}
                onChange={e => setNewCustPhone(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreateCustomer(); }}
                className="w-full px-2.5 py-1.5 border border-blue-200 rounded-md text-xs focus:outline-none focus:border-blue-400 bg-white" />
              <div className="flex gap-2 pt-1">
                <button onClick={() => { setShowCreateForm(false); setNewCustName(''); setNewCustPhone(''); }}
                  className="flex-1 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-md hover:bg-gray-100">Cancel</button>
                <button onClick={handleCreateCustomer} disabled={!newCustName.trim() || savingCustomer}
                  className="flex-1 py-1.5 text-xs font-bold bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1">
                  {savingCustomer ? <span className="animate-pulse">Saving…</span> : <><Check className="w-3 h-3" /> Save & Select</>}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" placeholder="Search customer by name/phone…" value={customerSearch}
                  onChange={e => { setCustomerSearch(e.target.value); setShowCustomerDropdown(true); }}
                  onFocus={() => setShowCustomerDropdown(true)}
                  className="w-full pl-8 pr-8 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
                <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
              {showCustomerDropdown && (customerSearch.length > 0 || filteredCustomers.length > 0) && (
                <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-40 mt-1 max-h-52 overflow-y-auto">
                  {filteredCustomers.map(c => (
                    <button key={c.id}
                      onPointerDown={e => { e.preventDefault(); setSelectedCustomer(c); setCustomerSearch(''); setShowCustomerDropdown(false); }}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center justify-between gap-2 border-b border-gray-50 last:border-0">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{c.name}</p>
                        {c.phone && <p className="text-xs text-gray-400">{c.phone}</p>}
                      </div>
                      {c.creditBalance > 0 && <span className="text-xs text-red-600 font-medium shrink-0">Due {formatCurrency(c.creditBalance)}</span>}
                    </button>
                  ))}
                  <button onPointerDown={e => { e.preventDefault(); setNewCustName(customerSearch); setShowCreateForm(true); setShowCustomerDropdown(false); }}
                    className="w-full text-left px-3 py-2.5 hover:bg-green-50 flex items-center gap-2 text-green-700 border-t border-gray-100 bg-green-50/50">
                    <UserPlus className="w-4 h-4 shrink-0" />
                    <div>
                      <p className="text-xs font-bold">{customerSearch.trim() ? `Create "${customerSearch.trim()}"` : 'Create new customer'}</p>
                      <p className="text-[10px] text-gray-400">Add to customer list & select</p>
                    </div>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Cart items */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-2">
        {cart.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 py-12">
            <ShoppingCart className="w-12 h-12 mb-2 opacity-20" />
            <p className="text-sm">Cart is empty</p>
            <button onClick={() => setMobileTab('medicines')}
              className="mt-3 text-xs text-blue-600 underline md:hidden">
              Browse medicines →
            </button>
          </div>
        ) : cart.map(item => (
          <div key={item.cartItemId} className="p-3 border border-gray-100 rounded-lg bg-white hover:border-gray-200 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 text-sm truncate">{item.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${item.sellType === 'box' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                    {item.sellType}
                  </span>
                  <span className="text-[10px] text-gray-400">{formatCurrency(item.price)} each</span>
                  <span className="text-[10px] font-semibold text-orange-700">Batch: {item.batchNo || 'N/A'}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className="font-bold text-sm text-gray-900 whitespace-nowrap">{formatCurrency(item.total)}</span>
                <button onClick={() => removeFromCart(item.cartItemId)} className="p-1 text-red-400 hover:bg-red-50 rounded">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {/* Qty */}
            <div className="flex items-center border border-gray-200 rounded-md bg-gray-50 w-fit">
              <button onClick={() => updateQuantity(item.cartItemId, -1)} className="px-2 py-1.5 hover:bg-gray-200 text-gray-600 rounded-l-md">
                <Minus className="w-3 h-3" />
              </button>
              <input
                type="number"
                min="1"
                step="1"
                value={qtyInputs[item.cartItemId] ?? String(item.quantity)}
                onChange={e => handleQuantityInput(item.cartItemId, e.target.value)}
                onBlur={() => commitQuantityInput(item.cartItemId)}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                className="w-12 text-center text-sm font-semibold bg-white border-x border-gray-200 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <button onClick={() => updateQuantity(item.cartItemId, 1)} className="px-2 py-1.5 hover:bg-gray-200 text-gray-600 rounded-r-md">
                <Plus className="w-3 h-3" />
              </button>
            </div>
            {/* Discount */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <div className="flex items-center bg-gray-100 rounded-md p-0.5 shrink-0">
                  <button onClick={() => updateItemDiscount(item.cartItemId, 'rs', item.discountType === 'pct' ? 0 : item.discountValue)}
                    className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold transition-all ${item.discountType === 'rs' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                    <DollarSign className="w-2.5 h-2.5" />Rs
                  </button>
                  <button onClick={() => updateItemDiscount(item.cartItemId, 'pct', item.discountType === 'rs' ? 0 : item.discountValue)}
                    className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold transition-all ${item.discountType === 'pct' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                    <Percent className="w-2.5 h-2.5" />%
                  </button>
                </div>
                <Tag className="w-3 h-3 text-orange-400 shrink-0" />
                <span className="text-[11px] text-gray-500 shrink-0">{item.discountType === 'pct' ? 'Disc %' : 'Disc Rs.'}</span>
                <input type="number" min="0" step={item.discountType === 'pct' ? '0.1' : '1'}
                  max={item.discountType === 'pct' ? '100' : undefined}
                  value={item.discountValue || ''} placeholder="0"
                  onChange={e => updateItemDiscount(item.cartItemId, item.discountType, parseFloat(e.target.value) || 0)}
                  className="flex-1 min-w-0 text-right text-xs p-1 border border-orange-200 rounded focus:outline-none focus:border-orange-400 bg-orange-50" />
              </div>
              {item.itemDiscount > 0 && (
                <div className="flex justify-between items-center text-[11px] text-orange-600">
                  <span>{item.discountType === 'pct' ? `${item.discountValue}% = -${formatCurrency(item.itemDiscount)}` : `-${formatCurrency(item.itemDiscount)} discount`}</span>
                  <span className="text-gray-500">Net: {formatCurrency(item.total)}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Totals + Checkout */}
      <div className="p-4 border-t border-gray-100 bg-gray-50 space-y-2">
        <div className="flex justify-between text-sm text-gray-600">
          <span>Subtotal</span><span>{formatCurrency(grossSubtotal)}</span>
        </div>
        {totalItemDiscounts > 0 && (
          <div className="flex justify-between text-sm text-orange-600">
            <span>Item Discounts</span><span>-{formatCurrency(totalItemDiscounts)}</span>
          </div>
        )}
        <div className="flex justify-between items-center text-sm text-gray-600">
          <span>Bill Discount</span>
          <div className="flex items-center gap-1.5">
            <select
              value={orderDiscountType}
              onChange={e => {
                const type = e.target.value as BillDiscountType;
                setOrderDiscountType(type);
                setOrderDiscountValue(0);
              }}
              className="p-1 border border-gray-200 rounded text-xs font-semibold bg-white focus:outline-none focus:border-blue-400"
              aria-label="Bill discount type"
            >
              <option value="rs">Rs</option>
              <option value="pct">%</option>
            </select>
            <input type="number" min="0" max={orderDiscountType === 'pct' ? 100 : undefined}
              step={orderDiscountType === 'pct' ? '0.1' : '1'}
              value={orderDiscountValue || ''} placeholder="0"
              onChange={e => setOrderDiscountValue(normalizeBillDiscountValue(orderDiscountType, Number(e.target.value)))}
              className="w-20 p-1 text-right border border-gray-200 rounded focus:outline-none focus:border-blue-400 text-sm bg-white" />
          </div>
        </div>
        {orderDiscountAmount > 0 && (
          <div className="flex justify-between text-sm text-red-500">
            <span>Bill Discount ({orderDiscountType === 'pct' ? `${normalizeBillDiscountValue('pct', orderDiscountValue)}%` : 'Rs'})</span><span>-{formatCurrency(orderDiscountAmount)}</span>
          </div>
        )}
        <div className="pt-2 border-t border-gray-200 flex justify-between items-center">
          <span className="font-bold text-gray-900">Total</span>
          <span className="text-2xl font-bold text-blue-600">{formatCurrency(grandTotal)}</span>
        </div>
        <div className="border border-dashed border-gray-300 rounded-lg p-3 space-y-2 bg-white">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Payment</p>
          <div className="flex justify-between items-center text-sm text-gray-600">
            <span>Amount Paid (Rs)</span>
            <input type="number" min="0" step="1" value={amountPaid}
              placeholder={formatCurrency(grandTotal)}
              onChange={e => setAmountPaid(e.target.value === '' ? '' : parseFloat(e.target.value))}
              className="w-28 p-1.5 text-right border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 text-sm font-medium bg-gray-50" />
          </div>
          {pendingAmount > 0 ? (
            <div className="flex justify-between items-center text-sm font-bold text-red-700 bg-red-50 px-3 py-2 rounded-lg border border-red-100">
              <span>Pending Amount</span><span>{formatCurrency(pendingAmount)}</span>
            </div>
          ) : amountPaid !== '' ? (
            <div className="text-xs text-green-700 bg-green-50 px-3 py-2 rounded-lg">✓ Fully Paid</div>
          ) : null}
          {pendingAmount > 0 && selectedCustomer && (
            <p className="text-xs text-orange-600 bg-orange-50 px-2 py-1.5 rounded">
              {formatCurrency(pendingAmount)} will be added to <strong>{selectedCustomer.name}'s</strong> outstanding balance.
            </p>
          )}
          {pendingAmount > 0 && !selectedCustomer && (
            <p className="text-xs text-gray-400 italic">Select a customer above to track this pending amount.</p>
          )}
        </div>
        <button onClick={handleCheckout} disabled={cart.length === 0}
          className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed mt-1">
          <Printer className="w-5 h-5" /> Checkout & Print
        </button>
      </div>
    </div>
  );

  return (
    <>
      {showPrintAlert && (
        <div className="fixed top-4 right-4 bg-blue-600 text-white px-6 py-3 rounded-lg shadow-lg z-50">
          <p className="font-medium">Printing is blocked in this preview.</p>
          <p className="text-sm opacity-90">Press Ctrl+P / Cmd+P to print.</p>
        </div>
      )}
      {stockError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-red-600 text-white px-6 py-3 rounded-lg shadow-lg z-50 flex items-center gap-3">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <span className="font-medium">{stockError}</span>
        </div>
      )}

      {billingNotice && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg z-[60] flex items-center gap-2">
          <CheckCircle className="w-5 h-5" />
          <span className="font-medium">{billingNotice}</span>
        </div>
      )}

      {showHoldModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 print:hidden">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <h2 className="font-bold text-gray-900 text-lg">Hold Current Bill</h2>
                <p className="text-xs text-gray-500 mt-1">The complete cart, customer, discounts, and payment state will be saved.</p>
              </div>
              <button type="button" onClick={() => setShowHoldModal(false)} className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <label className="block">
                <span className="text-sm font-semibold text-gray-700">Name or note (optional)</span>
                <input autoFocus value={holdLabel} onChange={event => setHoldLabel(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Enter') handleHoldBill(); }}
                  placeholder="Example: Ahmed - coming back"
                  className="mt-1.5 w-full border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-orange-400" />
              </label>
              <div className="flex justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
                <span>{cart.length} item(s)</span><strong>{formatCurrency(grandTotal)}</strong>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowHoldModal(false)} className="flex-1 py-2.5 border border-gray-200 rounded-lg font-semibold text-gray-600">Cancel</button>
                <button type="button" onClick={handleHoldBill} disabled={isHoldingBill}
                  className="flex-1 py-2.5 bg-orange-600 text-white rounded-lg font-bold disabled:opacity-50">
                  {isHoldingBill ? 'Saving...' : 'Hold Bill'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showHeldBills && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 print:hidden">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <h2 className="font-bold text-gray-900 text-lg">Held Bills</h2>
                <p className="text-xs text-gray-500 mt-1">Held bills do not reserve stock. Stock is checked again before checkout.</p>
              </div>
              <button type="button" onClick={() => setShowHeldBills(false)} className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="overflow-y-auto p-4 space-y-3">
              {heldBills.length === 0 ? (
                <div className="py-12 text-center text-gray-400"><PauseCircle className="w-10 h-10 mx-auto mb-2 opacity-40" /><p>No held bills</p></div>
              ) : heldBills.map(heldBill => (
                <div key={heldBill.id} className="border border-gray-200 rounded-xl p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-bold text-gray-900 truncate">{heldBill.label || 'Held bill'}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {(heldBill.items || []).length} item(s)
                      {heldBill.customer?.name ? ` - ${heldBill.customer.name}` : ''}
                      {heldBill.createdAt ? ` - ${recordClinicDateTimeLabel({ date: heldBill.createdAt })}` : ''}
                    </p>
                    <p className="text-sm font-semibold text-blue-700 mt-1">{formatCurrency(Number(heldBill.total || 0))}</p>
                  </div>
                  <button type="button" onClick={() => handleResumeBill(heldBill)}
                    className="shrink-0 flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-indigo-700">
                    <PlayCircle className="w-4 h-4" /> Resume
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {batchSelector && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 print:hidden">
          <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <h2 className="font-bold text-gray-900 text-lg">Select Batch — {batchSelector[0]?.name}</h2>
                <p className="text-xs text-gray-500 mt-1">Choose the exact batch to sell. Stock will be deducted only from that batch.</p>
              </div>
              <button type="button" onClick={() => setBatchSelector(null)} aria-label="Close batch selector" className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto p-4 space-y-3">
              {batchSelector.map(batch => (
                <div key={batch.id} className="border border-gray-200 rounded-xl p-4 hover:border-orange-300 bg-white">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-orange-700 bg-orange-50 border border-orange-200 rounded-md px-2 py-1 text-sm">Batch {batch.batchNo || 'N/A'}</span>
                        <span className="text-sm font-semibold text-blue-700">{formatStock(batch.stock, batch.unitsPerBox)}</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-1 mt-2 text-xs text-gray-600">
                        <span>Expiry: <strong className="text-gray-900">{batch.expiryDate ? format(new Date(batch.expiryDate), 'MMM dd, yyyy') : 'N/A'}</strong></span>
                        <span>Supplier: <strong className="text-gray-900">{batch.supplierName || 'No supplier'}</strong></span>
                        <span>Cost / Box: <strong className="text-gray-900">{formatCurrency(batch.costPrice || 0)}</strong></span>
                        <span>Retail / Box: <strong className="text-blue-700">{formatCurrency(getBoxPrice(batch))}</strong></span>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button type="button" onClick={() => { addToCart(batch, 'box'); setBatchSelector(null); }}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-blue-700">
                        Add Box
                      </button>
                      {Number(batch.unitsPerBox || 1) > 1 && (
                        <button type="button" onClick={() => { addToCart(batch, 'unit'); setBatchSelector(null); }}
                          className="bg-green-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-green-700">
                          Add Unit
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showRxModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 print:hidden">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <h2 className="font-bold text-gray-900 text-lg">Pending Prescriptions</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {pharmacyOrders.length} prescription{pharmacyOrders.length !== 1 ? 's' : ''} waiting - select one to load into cart
                </p>
              </div>
              <button onClick={() => setShowRxModal(false)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg" aria-label="Close prescriptions">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 border-b border-gray-100">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={rxSearch}
                  onChange={e => setRxSearch(e.target.value)}
                  placeholder="Search by patient name or MRN..."
                  className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {pharmacyOrders.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                  <ClipboardList className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p className="text-sm font-medium">No pending prescriptions</p>
                  <p className="text-xs mt-1">Doctors send prescriptions from the Hospital OPD</p>
                </div>
              ) : (
                pharmacyOrders
                  .filter(o => !rxSearch ||
                    o.patientName?.toLowerCase().includes(rxSearch.toLowerCase()) ||
                    o.patientMRN?.includes(rxSearch))
                  .map(order => {
                    const matchCount = (order.prescriptions || []).filter((rx: any) =>
                      medicines.some(m => normalizeMedicineText(m.name) === normalizeMedicineText(rx.name) && m.stock > 0)
                    ).length;
                    return (
                      <div key={order.id} className="border border-gray-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-sm transition-all">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-gray-900">{order.patientName}</span>
                              <span className="text-xs font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{order.patientMRN}</span>
                              {order.patientAge && <span className="text-xs text-gray-500">{order.patientAge}y - {order.patientGender}</span>}
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">Dr. {order.doctorName} - {order.department}</p>
                            {order.diagnosis && <p className="text-xs text-blue-600 mt-1 font-medium">Dx: {order.diagnosis}</p>}
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {(order.prescriptions || []).map((rx: any, i: number) => {
                                const inStock = medicines.some(m => normalizeMedicineText(m.name) === normalizeMedicineText(rx.name) && m.stock > 0);
                                return (
                                  <span key={i} className={`text-xs px-2 py-0.5 rounded-full font-medium ${inStock ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-400 line-through'}`}>
                                    {rx.name}
                                  </span>
                                );
                              })}
                            </div>
                            <p className="text-[11px] text-gray-400 mt-1.5">
                              {matchCount} of {order.prescriptions?.length || 0} medicines in stock
                            </p>
                          </div>
                          <button
                            onClick={() => loadPrescription(order)}
                            disabled={matchCount === 0}
                            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                          >
                            <CheckCircle className="w-4 h-4" />
                            Load
                          </button>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Printable Receipt */}
      <div className="thermal-receipt hidden print:block bg-white text-black font-mono">
        <div className="text-center mb-3">
          <h2 className="text-lg font-bold">{PHARMACY_RECEIPT_NAME}</h2>
          <p>Receipt</p>
          <p>{recordClinicDateTimeLabel(lastReceipt || { date: trustedNowISO() })}</p>
          {lastReceipt && <p className="text-xs mt-1">Receipt No: {getSaleReceiptNo(lastReceipt)}</p>}
          <p className="text-xs mt-1 uppercase font-bold border border-black inline-block px-2 py-0.5">
            {lastReceipt?.customerType || customerType}
          </p>
          {lastReceipt?.customerName && <p className="text-xs mt-1">Customer: {lastReceipt.customerName}</p>}
        </div>
        <table className="w-full mb-3 text-[10px]">
          <colgroup>
            <col style={{ width: '42%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '26%' }} />
          </colgroup>
          <thead>
            <tr className="border-b border-black border-dashed">
              <th className="text-left pb-1">Item</th>
              <th className="text-right pb-1">Price</th>
              <th className="text-center pb-1">Qty</th>
              <th className="text-right pb-1">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(lastReceipt?.items || cart).map((item: any) => (
              <tr key={item.cartItemId} className="border-b border-dashed border-gray-400">
                <td className="py-1 pr-1 font-semibold">{item.name}</td>
                <td className="text-right py-1 whitespace-nowrap">{formatCurrency(item.price)}</td>
                <td className="text-center py-1 whitespace-nowrap">{cartItemUnits(item)}</td>
                <td className="text-right py-1 whitespace-nowrap">{formatCurrency(item.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-black border-dashed pt-2 space-y-1" style={{ breakInside: 'avoid' }}>
          <div className="flex justify-between"><span>Subtotal:</span><span>{formatCurrency(lastReceipt?.grossSubtotal ?? grossSubtotal)}</span></div>
          {(lastReceipt?.totalItemDiscounts ?? totalItemDiscounts) > 0 && (
            <div className="flex justify-between"><span>Item Discounts:</span><span>-{formatCurrency(lastReceipt?.totalItemDiscounts ?? totalItemDiscounts)}</span></div>
          )}
          {(lastReceipt?.orderDiscount ?? orderDiscountAmount) > 0 && (
            <div className="flex justify-between"><span>Bill Discount:</span><span>-{formatCurrency(lastReceipt?.orderDiscount ?? orderDiscountAmount)}</span></div>
          )}
          <div className="flex justify-between font-bold text-base mt-2 pt-2 border-t border-black">
            <span>Total:</span><span>{formatCurrency(lastReceipt?.total ?? grandTotal)}</span>
          </div>
          {(lastReceipt?.pendingAmount ?? pendingAmount) > 0 && (
            <>
              <div className="flex justify-between"><span>Paid:</span><span>{formatCurrency(lastReceipt?.amountPaid ?? effectiveAmountPaid)}</span></div>
              <div className="flex justify-between font-bold border-t border-dashed pt-1 mt-1">
                <span>Pending:</span><span>{formatCurrency(lastReceipt?.pendingAmount ?? pendingAmount)}</span>
              </div>
            </>
          )}
        </div>
        <div className="text-center mt-5 text-[10px]">
          <p>Thank you for your visit!</p>
          <p>Get Well Soon</p>
        </div>
        <div dir="rtl" className="receipt-policy text-center mt-3 pt-2 border-t border-dashed border-black text-[10px] leading-relaxed" style={{ fontFamily: "'Noto Nastaliq Urdu','Noto Naskh Arabic','Segoe UI',Arial,sans-serif" }}>
          {PHARMACY_RETURN_POLICY_URDU.map(line => <p key={line}>{line}</p>)}
        </div>
      </div>

      {/* ── DESKTOP LAYOUT: side-by-side ── */}
      <div className="hidden md:flex h-full min-h-0 gap-6 print:hidden">
        {MedicinesPanel()}
        <div className="w-96 min-h-0 flex flex-col">
          {CartPanel()}
        </div>
      </div>

      {/* ── MOBILE LAYOUT: tab switcher ── */}
      <div className="flex md:hidden flex-col h-full min-h-0 print:hidden">
        {/* Tab bar */}
        <div className="flex bg-white rounded-xl shadow-sm border border-gray-100 mb-3 p-1 gap-1 shrink-0">
          <button
            onClick={() => setMobileTab('medicines')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-colors ${mobileTab === 'medicines' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            <Pill className="w-4 h-4" /> Medicines
          </button>
          <button
            onClick={() => setMobileTab('cart')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-colors ${mobileTab === 'cart' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            <ShoppingCart className="w-4 h-4" />
            Cart
            {cart.length > 0 && (
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${mobileTab === 'cart' ? 'bg-white text-blue-600' : 'bg-blue-600 text-white'}`}>
                {cart.length}
              </span>
            )}
          </button>
        </div>

        {/* Both panels stay mounted — only visibility toggled — so search input never loses focus */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <div className={mobileTab === 'medicines' ? 'flex flex-col flex-1 min-h-0 overflow-hidden' : 'hidden'}>
            {MedicinesPanel()}
          </div>
          <div className={mobileTab === 'cart' ? 'flex flex-col flex-1 min-h-0 overflow-hidden' : 'hidden'}>
            {CartPanel()}
          </div>
        </div>
      </div>
    </>
  );
}
