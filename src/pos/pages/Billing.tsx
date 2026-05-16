import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, doc, updateDoc, increment } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../../firebase';
import { formatCurrency } from '../lib/utils';
import { printReceipt } from '../../hms/lib/pdf';
import { Search, Plus, Minus, Trash2, Printer, ShoppingCart, Tag, ClipboardList, X, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';

export function Billing() {
  const [medicines, setMedicines] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<any[]>([]);
  const [orderDiscount, setOrderDiscount] = useState(0);
  const [customerType, setCustomerType] = useState<'customer' | 'hospital'>('customer');
  const [lastReceipt, setLastReceipt] = useState<any>(null);
  const [showPrintAlert, setShowPrintAlert] = useState(false);
  const [stockError, setStockError] = useState('');
  // Pharmacy Rx orders
  const [pharmacyOrders, setPharmacyOrders] = useState<any[]>([]);
  const [showRxModal, setShowRxModal] = useState(false);
  const [rxSearch, setRxSearch] = useState('');

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'medicines'), (snapshot) => {
      const meds = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setMedicines(meds);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'medicines'));
    const unsubRx = onSnapshot(collection(db, 'pharmacyOrders'), snap => {
      setPharmacyOrders(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter((o: any) => o.status === 'pending')
          .sort((a: any, b: any) => (b.createdAt > a.createdAt ? 1 : -1))
      );
    });
    return () => { unsub(); unsubRx(); };
  }, []);

  const filteredMedicines = medicines.filter(m =>
    m.stock > 0 && (
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      (m.batchNo || '').toLowerCase().includes(search.toLowerCase())
    )
  );

  const addToCart = (med: any, sellType: 'box' | 'unit') => {
    setCart(prev => {
      const cartItemId = `${med.id}-${sellType}`;
      const existing = prev.find(item => item.cartItemId === cartItemId);
      const price = sellType === 'box' ? (med.retailPrice || med.price) : (med.unitPrice || med.price);
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
        return prev.map(item =>
          item.cartItemId === cartItemId
            ? { ...item, quantity: item.quantity + 1, total: Math.max(0, (item.quantity + 1) * item.price - item.itemDiscount) }
            : item
        );
      }

      return [...prev, {
        cartItemId,
        medicineId: med.id,
        name: med.name,
        sellType,
        price,
        costPrice: med.costPrice || 0,
        quantity: 1,
        itemDiscount: 0,
        total: price,
        unitsPerBox: med.unitsPerBox || 1,
      }];
    });
  };

  const updateQuantity = (cartItemId: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.cartItemId !== cartItemId) return item;
      const med = medicines.find(m => m.id === item.medicineId);
      if (!med) return item;
      const newQ = Math.max(1, item.quantity + delta);
      const otherUnits = prev
        .filter(i => i.medicineId === med.id && i.cartItemId !== cartItemId)
        .reduce((sum, i) => sum + (i.quantity * (i.sellType === 'box' ? i.unitsPerBox : 1)), 0);
      if (otherUnits + newQ * (item.sellType === 'box' ? item.unitsPerBox : 1) > med.stock) return item;
      return { ...item, quantity: newQ, total: Math.max(0, newQ * item.price - item.itemDiscount) };
    }));
  };

  const updateItemDiscount = (cartItemId: string, discountRs: number) => {
    setCart(prev => prev.map(item => {
      if (item.cartItemId !== cartItemId) return item;
      const maxDiscount = item.quantity * item.price;
      const safeDiscount = Math.min(Math.max(0, discountRs), maxDiscount);
      return { ...item, itemDiscount: safeDiscount, total: Math.max(0, item.quantity * item.price - safeDiscount) };
    }));
  };

  const removeFromCart = (cartItemId: string) => {
    setCart(prev => prev.filter(item => item.cartItemId !== cartItemId));
  };

  const grossSubtotal = cart.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const totalItemDiscounts = cart.reduce((sum, item) => sum + (item.itemDiscount || 0), 0);
  const subtotalAfterItemDisc = cart.reduce((sum, item) => sum + item.total, 0);
  const orderDiscountAmount = subtotalAfterItemDisc * (orderDiscount / 100);
  const grandTotal = Math.max(0, subtotalAfterItemDisc - orderDiscountAmount);

  // Load a pharmacy prescription order into the cart
  const loadPrescription = (order: any) => {
    const newItems: any[] = [];
    for (const rx of (order.prescriptions || [])) {
      const med = medicines.find(
        m => m.name.toLowerCase().trim() === rx.name.toLowerCase().trim() && m.stock > 0
      );
      if (!med) continue;
      const cartItemId = `${med.id}-unit`;
      if (newItems.find(i => i.cartItemId === cartItemId) || cart.find(i => i.cartItemId === cartItemId)) continue;
      newItems.push({
        cartItemId,
        medicineId: med.id,
        name: med.name,
        sellType: 'unit',
        price: med.unitPrice || med.price,
        costPrice: med.costPrice || 0,
        quantity: 1,
        itemDiscount: 0,
        total: med.unitPrice || med.price,
        unitsPerBox: med.unitsPerBox || 1,
        rxNote: `${rx.dosage} · ${rx.frequency} · ${rx.duration}`,
      });
    }
    setCart(prev => [...prev, ...newItems]);
    setCustomerType('hospital');
    setShowRxModal(false);
    // Mark as dispensed
    updateDoc(doc(db, 'pharmacyOrders', order.id), {
      status: 'dispensed',
      dispensedAt: new Date().toISOString(),
      dispensedBy: auth.currentUser?.uid || '',
    }).catch(console.error);
  };

  const handlePrint = (receipt?: any) => {
    const r = receipt || lastReceipt;
    if (!r) return;
    const settings = JSON.parse(localStorage.getItem('posSettings') || '{}');
    printReceipt({
      shopName:      settings.shopName      || 'Al-Fateh Clinic Pharmacy',
      shopAddress:   settings.shopAddress   || '',
      shopPhone:     settings.shopPhone     || '',
      receiptNo:     r.id || 'SALE',
      date:          new Date(r.date).toLocaleDateString(),
      cashier:       auth.currentUser?.email?.split('@')[0] || '',
      items: (r.items || []).map((item: any) => ({
        name:  item.name,
        qty:   item.quantity,
        price: item.price,
        total: item.quantity * item.price,
      })),
      subtotal:      r.subtotal      || 0,
      discount:      r.discount      || 0,
      total:         r.total         || 0,
      paid:          r.total         || 0,
      change:        0,
      paymentMethod: 'Cash',
    });
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    try {
      const saleData = {
        items: cart,
        grossSubtotal,
        totalItemDiscounts,
        subtotal: subtotalAfterItemDisc,
        orderDiscount: orderDiscountAmount,
        discount: orderDiscountAmount + totalItemDiscounts,
        total: grandTotal,
        date: new Date().toISOString(),
        customerType,
        cashierId: auth.currentUser?.uid,
      };
      const docRef = await addDoc(collection(db, 'sales'), saleData);
      for (const item of cart) {
        const unitsToDeduct = item.quantity * (item.sellType === 'box' ? item.unitsPerBox : 1);
        await updateDoc(doc(db, 'medicines', item.medicineId), { stock: increment(-unitsToDeduct) });
      }
      const receipt = { ...saleData, id: docRef.id };
      setLastReceipt(receipt);
      setCart([]);
      setOrderDiscount(0);
      setTimeout(() => handlePrint(receipt), 300);
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

  return (
    <>
      {showPrintAlert && (
        <div className="fixed top-4 right-4 bg-blue-600 text-white px-6 py-3 rounded-lg shadow-lg z-50">
          <p className="font-medium">Printing is blocked in this preview.</p>
          <p className="text-sm opacity-90">Press Ctrl+P / Cmd+P to print.</p>
        </div>
      )}

      {stockError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-red-600 text-white px-6 py-3 rounded-lg shadow-lg z-50 flex items-center gap-3 animate-bounce-in">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
          <span className="font-medium">{stockError}</span>
        </div>
      )}

      {/* Printable Receipt */}
      <div className="hidden print:block w-[80mm] mx-auto bg-white text-black text-sm font-mono p-4">
        <div className="text-center mb-4">
          <h2 className="text-xl font-bold">Al-Fateh Pharmacy</h2>
          <p>Receipt</p>
          <p>{lastReceipt?.date ? format(new Date(lastReceipt.date), 'dd/MM/yyyy HH:mm') : format(new Date(), 'dd/MM/yyyy HH:mm')}</p>
          {lastReceipt?.id && <p className="text-xs mt-1">ID: {lastReceipt.id.slice(0, 8)}</p>}
          <p className="text-xs mt-1 uppercase font-bold border border-black inline-block px-2 py-0.5">
            {lastReceipt?.customerType || customerType}
          </p>
        </div>
        <table className="w-full mb-4">
          <thead>
            <tr className="border-b border-black border-dashed">
              <th className="text-left pb-1">Item</th>
              <th className="text-center pb-1">Qty</th>
              <th className="text-right pb-1">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-dashed">
            {(lastReceipt?.items || cart).map((item: any) => (
              <tr key={item.cartItemId}>
                <td className="py-1">
                  <div className="line-clamp-1">{item.name}</div>
                  <div className="text-xs text-gray-500">{item.sellType === 'box' ? '(Box)' : '(Unit)'} @ {formatCurrency(item.price)}</div>
                  {item.itemDiscount > 0 && <div className="text-xs">Disc: -{formatCurrency(item.itemDiscount)}</div>}
                </td>
                <td className="text-center py-1">{item.quantity}</td>
                <td className="text-right py-1">{formatCurrency(item.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-black border-dashed pt-2 space-y-1">
          <div className="flex justify-between"><span>Subtotal:</span><span>{formatCurrency(lastReceipt?.grossSubtotal || grossSubtotal)}</span></div>
          {(lastReceipt?.totalItemDiscounts || totalItemDiscounts) > 0 && (
            <div className="flex justify-between"><span>Item Discounts:</span><span>-{formatCurrency(lastReceipt?.totalItemDiscounts || totalItemDiscounts)}</span></div>
          )}
          {(lastReceipt?.orderDiscount || orderDiscountAmount) > 0 && (
            <div className="flex justify-between"><span>Order Discount:</span><span>-{formatCurrency(lastReceipt?.orderDiscount || orderDiscountAmount)}</span></div>
          )}
          <div className="flex justify-between font-bold text-lg mt-2 pt-2 border-t border-black">
            <span>Total:</span>
            <span>{formatCurrency(lastReceipt?.total || grandTotal)}</span>
          </div>
        </div>
        <div className="text-center mt-8 text-xs">
          <p>Thank you for your visit!</p>
          <p>Get Well Soon</p>
        </div>
      </div>

      {/* Pharmacy Rx Modal */}
      {showRxModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <h2 className="font-bold text-gray-900 text-lg">Pending Prescriptions</h2>
                <p className="text-xs text-gray-400 mt-0.5">{pharmacyOrders.length} prescription{pharmacyOrders.length !== 1 ? 's' : ''} waiting · Select one to load into cart</p>
              </div>
              <button onClick={() => setShowRxModal(false)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 border-b border-gray-100">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={rxSearch} onChange={e => setRxSearch(e.target.value)}
                  placeholder="Search by patient name or MRN..."
                  className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
                      medicines.some(m => m.name.toLowerCase().trim() === rx.name.toLowerCase().trim() && m.stock > 0)
                    ).length;
                    return (
                      <div key={order.id} className="border border-gray-200 rounded-xl p-4 hover:border-emerald-300 hover:shadow-sm transition-all">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-gray-900">{order.patientName}</span>
                              <span className="text-xs font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{order.patientMRN}</span>
                              {order.patientAge && <span className="text-xs text-gray-500">{order.patientAge}y · {order.patientGender}</span>}
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">Dr. {order.doctorName} · {order.department}</p>
                            {order.diagnosis && <p className="text-xs text-blue-600 mt-1 font-medium">Dx: {order.diagnosis}</p>}
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {(order.prescriptions || []).map((rx: any, i: number) => {
                                const inStock = medicines.some(m => m.name.toLowerCase().trim() === rx.name.toLowerCase().trim() && m.stock > 0);
                                return (
                                  <span key={i} className={`text-xs px-2 py-0.5 rounded-full font-medium ${inStock ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-400 line-through'}`}>
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
                            className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
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

      {/* Main UI */}
      <div className="h-full flex gap-6 print:hidden">

        {/* Left – Product Grid */}
        <div className="flex-1 flex flex-col bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
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
                className="relative flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-emerald-700 shrink-0"
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
          </div>

          <div className="flex-1 overflow-auto p-4">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {filteredMedicines.map(med => (
                <div key={med.id} className="p-3 rounded-xl border border-gray-200 hover:border-blue-400 hover:shadow-md transition-all bg-white flex flex-col">
                  <div className="flex-1">
                    <h3 className="font-bold text-gray-900 line-clamp-2 text-sm leading-tight">{med.name}</h3>
                    <p className="text-[11px] text-gray-400 mt-0.5">{med.form} • {med.batchNo}</p>
                    <p className="text-[11px] font-semibold text-blue-600 mt-1">{formatStock(med.stock, med.unitsPerBox)}</p>

                    {/* Purchase (cost) price badge */}
                    {med.costPrice > 0 && (
                      <div className="mt-1.5 inline-flex items-center gap-1 bg-amber-50 border border-amber-200 rounded-md px-1.5 py-0.5">
                        <Tag className="w-2.5 h-2.5 text-amber-500 shrink-0" />
                        <span className="text-[10px] font-semibold text-amber-700 leading-none">
                          Cost {formatCurrency(med.costPrice)}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="mt-2.5 flex flex-col gap-1.5">
                    {med.unitsPerBox > 1 ? (
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => addToCart(med, 'box')}
                          className="flex-1 bg-blue-50 text-blue-700 py-1.5 rounded-md text-[11px] font-bold hover:bg-blue-100 border border-blue-100 text-center leading-snug"
                        >
                          + Box<br /><span className="font-normal text-[10px]">{formatCurrency(med.retailPrice || med.price)}</span>
                        </button>
                        <button
                          onClick={() => addToCart(med, 'unit')}
                          className="flex-1 bg-green-50 text-green-700 py-1.5 rounded-md text-[11px] font-bold hover:bg-green-100 border border-green-100 text-center leading-snug"
                        >
                          + Unit<br /><span className="font-normal text-[10px]">{formatCurrency(med.unitPrice || med.price)}</span>
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => addToCart(med, 'box')}
                        className="w-full bg-blue-50 text-blue-700 py-2 rounded-md text-xs font-bold hover:bg-blue-100 border border-blue-100"
                      >
                        Add — {formatCurrency(med.retailPrice || med.price)}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right – Cart */}
        <div className="w-96 bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col">

          <div className="p-4 border-b border-gray-100 bg-gray-50 flex flex-col gap-3">
            <h2 className="text-lg font-bold text-gray-900">Current Sale</h2>
            <div className="flex bg-white rounded-lg p-1 border border-gray-200">
              <button
                onClick={() => setCustomerType('customer')}
                className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${customerType === 'customer' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Customer
              </button>
              <button
                onClick={() => setCustomerType('hospital')}
                className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${customerType === 'hospital' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Hospital
              </button>
            </div>
          </div>

          {/* Items */}
          <div className="flex-1 overflow-auto p-3 space-y-2">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-400">
                <ShoppingCart className="w-12 h-12 mb-2 opacity-20" />
                <p className="text-sm">Cart is empty</p>
              </div>
            ) : (
              cart.map(item => (
                <div key={item.cartItemId} className="p-3 border border-gray-100 rounded-lg bg-white hover:border-gray-200 space-y-2">

                  {/* Name + total + delete */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 text-sm truncate">{item.name}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${item.sellType === 'box' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                          {item.sellType}
                        </span>
                        <span className="text-[10px] text-gray-400">{formatCurrency(item.price)} each</span>
                        {item.costPrice > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-600 font-medium">
                            <Tag className="w-2.5 h-2.5" />
                            cost {formatCurrency(item.costPrice)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="font-bold text-sm text-gray-900 whitespace-nowrap">{formatCurrency(item.total)}</span>
                      <button onClick={() => removeFromCart(item.cartItemId)} className="p-1 text-red-400 hover:bg-red-50 rounded">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Qty + per-item Rs discount */}
                  <div className="flex items-center gap-2">
                    {/* Qty control */}
                    <div className="flex items-center border border-gray-200 rounded-md bg-gray-50 shrink-0">
                      <button onClick={() => updateQuantity(item.cartItemId, -1)} className="px-1.5 py-1 hover:bg-gray-200 text-gray-600 rounded-l-md">
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="w-6 text-center text-sm font-semibold">{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.cartItemId, 1)} className="px-1.5 py-1 hover:bg-gray-200 text-gray-600 rounded-r-md">
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Per-item discount in Rs */}
                    <div className="flex items-center gap-1 flex-1">
                      <Tag className="w-3 h-3 text-orange-400 shrink-0" />
                      <span className="text-[11px] text-gray-500 shrink-0">Disc Rs.</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={item.itemDiscount || ''}
                        placeholder="0"
                        onChange={e => updateItemDiscount(item.cartItemId, parseFloat(e.target.value) || 0)}
                        className="flex-1 min-w-0 text-right text-xs p-1 border border-orange-200 rounded focus:outline-none focus:border-orange-400 bg-orange-50"
                      />
                    </div>
                  </div>

                  {item.itemDiscount > 0 && (
                    <p className="text-[11px] text-orange-600 text-right">
                      -{formatCurrency(item.itemDiscount)} discount applied
                    </p>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Totals + Checkout */}
          <div className="p-4 border-t border-gray-100 bg-gray-50 space-y-2">
            <div className="flex justify-between text-sm text-gray-600">
              <span>Subtotal</span>
              <span>{formatCurrency(grossSubtotal)}</span>
            </div>

            {totalItemDiscounts > 0 && (
              <div className="flex justify-between text-sm text-orange-600">
                <span>Item Discounts</span>
                <span>-{formatCurrency(totalItemDiscounts)}</span>
              </div>
            )}

            {/* Order discount in % */}
            <div className="flex justify-between items-center text-sm text-gray-600">
              <span>Order Discount</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={orderDiscount || ''}
                  placeholder="0"
                  onChange={e => setOrderDiscount(Number(e.target.value))}
                  className="w-14 p-1 text-right border border-gray-200 rounded focus:outline-none focus:border-blue-400 text-sm bg-white"
                />
                <span className="text-gray-400">%</span>
              </div>
            </div>

            {orderDiscountAmount > 0 && (
              <div className="flex justify-between text-sm text-red-500">
                <span>Order Discount Amount</span>
                <span>-{formatCurrency(orderDiscountAmount)}</span>
              </div>
            )}

            <div className="pt-2 border-t border-gray-200 flex justify-between items-center">
              <span className="font-bold text-gray-900">Total</span>
              <span className="text-2xl font-bold text-blue-600">{formatCurrency(grandTotal)}</span>
            </div>

            <button
              onClick={handleCheckout}
              disabled={cart.length === 0}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed mt-1"
            >
              <Printer className="w-5 h-5" />
              Checkout & Print
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
