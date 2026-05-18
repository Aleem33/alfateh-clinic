import { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../../firebase';
import { nowISO } from '../lib/utils';
import { logAudit } from '../lib/audit';
import { Plus, Edit2, Trash2, X, BedDouble, Building2, DoorOpen, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAppDialog } from '../../components/AppDialog';

const BED_TYPES = ['General', 'Private', 'Semi-Private', 'ICU', 'CCU', 'Isolation', 'VIP'];

export function BedManagement() {
  const { alert, confirm } = useAppDialog();
  const [wards, setWards] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [beds, setBeds] = useState<any[]>([]);
  const [admissions, setAdmissions] = useState<any[]>([]);

  const [tab, setTab] = useState<'wards' | 'rooms' | 'beds'>('wards');
  const [selectedWard, setSelectedWard] = useState<any | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<any | null>(null);

  // Ward modal
  const [showWardModal, setShowWardModal] = useState(false);
  const [editWardId, setEditWardId] = useState<string | null>(null);
  const [wardForm, setWardForm] = useState({ name: '', description: '', floor: '' });

  // Room modal
  const [showRoomModal, setShowRoomModal] = useState(false);
  const [editRoomId, setEditRoomId] = useState<string | null>(null);
  const [roomForm, setRoomForm] = useState({ roomNo: '', type: 'General', wardId: '', wardName: '' });

  // Bed modal
  const [showBedModal, setShowBedModal] = useState(false);
  const [editBedId, setEditBedId] = useState<string | null>(null);
  const [bedForm, setBedForm] = useState({ bedNo: '', type: 'General', wardId: '', wardName: '', roomId: '', roomNo: '', dailyRate: '2000' });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'wards'), s => setWards(s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => a.name > b.name ? 1 : -1)));
    const u2 = onSnapshot(collection(db, 'rooms'), s => setRooms(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u3 = onSnapshot(collection(db, 'beds'), s => setBeds(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u4 = onSnapshot(collection(db, 'admissions'), s => setAdmissions(s.docs.filter(d => d.data().status === 'admitted').map(d => ({ id: d.id, ...d.data() }))));
    return () => { u1(); u2(); u3(); u4(); };
  }, []);

  // ── Ward CRUD ─────────────────────────────────────────────
  const saveWard = async () => {
    if (!wardForm.name.trim()) { setError('Ward name required.'); return; }
    setSaving(true); setError('');
    try {
      if (editWardId) {
        await updateDoc(doc(db, 'wards', editWardId), { ...wardForm, updatedAt: nowISO() });
        await logAudit('update', 'ward', editWardId, wardForm.name);
      } else {
        const ref = await addDoc(collection(db, 'wards'), { ...wardForm, createdAt: nowISO() });
        await logAudit('create', 'ward', ref.id, wardForm.name);
      }
      setShowWardModal(false); setEditWardId(null); setWardForm({ name: '', description: '', floor: '' });
    } catch (e: any) { setError(e.code === 'permission-denied' ? 'Permission denied — please log out and log back in, then try again.' : e.message); }
    finally { setSaving(false); }
  };

  const deleteWard = async (id: string, name: string) => {
    if (!(await confirm(`Delete ward "${name}"? All rooms and beds in this ward will also be deleted.`, { title: 'Delete Ward', confirmLabel: 'Delete' }))) return;
    // Delete all rooms and beds in this ward
    const wardRooms = rooms.filter(r => r.wardId === id);
    const wardBeds = beds.filter(b => b.wardId === id);
    for (const r of wardRooms) await deleteDoc(doc(db, 'rooms', r.id));
    for (const b of wardBeds) await deleteDoc(doc(db, 'beds', b.id));
    await deleteDoc(doc(db, 'wards', id));
    await logAudit('delete', 'ward', id, name);
  };

  // ── Room CRUD ─────────────────────────────────────────────
  const saveRoom = async () => {
    if (!roomForm.roomNo.trim() || !roomForm.wardId) { setError('Room number and ward required.'); return; }
    setSaving(true); setError('');
    try {
      if (editRoomId) {
        await updateDoc(doc(db, 'rooms', editRoomId), { ...roomForm, updatedAt: nowISO() });
      } else {
        await addDoc(collection(db, 'rooms'), { ...roomForm, createdAt: nowISO() });
      }
      setShowRoomModal(false); setEditRoomId(null); setRoomForm({ roomNo: '', type: 'General', wardId: selectedWard?.id || '', wardName: selectedWard?.name || '' });
    } catch (e: any) { setError(e.code === 'permission-denied' ? 'Permission denied — please log out and log back in, then try again.' : e.message); }
    finally { setSaving(false); }
  };

  const deleteRoom = async (id: string, roomNo: string) => {
    if (!(await confirm(`Delete room "${roomNo}"? All beds in this room will also be deleted.`, { title: 'Delete Room', confirmLabel: 'Delete' }))) return;
    const roomBeds = beds.filter(b => b.roomId === id);
    for (const b of roomBeds) await deleteDoc(doc(db, 'beds', b.id));
    await deleteDoc(doc(db, 'rooms', id));
  };

  // ── Bed CRUD ──────────────────────────────────────────────
  const saveBed = async () => {
    if (!bedForm.bedNo.trim() || !bedForm.wardId) { setError('Bed number and ward required.'); return; }
    setSaving(true); setError('');
    try {
      if (editBedId) {
        await updateDoc(doc(db, 'beds', editBedId), { ...bedForm, dailyRate: Number(bedForm.dailyRate), updatedAt: nowISO() });
      } else {
        await addDoc(collection(db, 'beds'), { ...bedForm, dailyRate: Number(bedForm.dailyRate), status: 'available', createdAt: nowISO() });
      }
      setShowBedModal(false); setEditBedId(null);
      setBedForm({ bedNo: '', type: 'General', wardId: selectedWard?.id || '', wardName: selectedWard?.name || '', roomId: selectedRoom?.id || '', roomNo: selectedRoom?.roomNo || '', dailyRate: '2000' });
    } catch (e: any) { setError(e.code === 'permission-denied' ? 'Permission denied — please log out and log back in, then try again.' : e.message); }
    finally { setSaving(false); }
  };

  const deleteBed = async (id: string, bedNo: string) => {
    const occupied = admissions.find(a => a.bedId === id);
    if (occupied) { await alert(`Cannot delete - bed "${bedNo}" is currently occupied.`, 'Bed Occupied'); return; }
    if (!(await confirm(`Delete bed "${bedNo}"?`, { title: 'Delete Bed', confirmLabel: 'Delete' }))) return;
    await deleteDoc(doc(db, 'beds', id));
  };

  // Filtered rooms/beds for selected ward
  const wardRooms = selectedWard ? rooms.filter(r => r.wardId === selectedWard.id) : rooms;
  const displayBeds = selectedWard
    ? beds.filter(b => b.wardId === selectedWard.id && (selectedRoom ? b.roomId === selectedRoom.id : true))
    : beds;

  const bedOccupied = (bedId: string) => admissions.some(a => a.bedId === bedId);

  const openAddRoom = () => {
    setEditRoomId(null);
    setRoomForm({ roomNo: '', type: 'General', wardId: selectedWard?.id || '', wardName: selectedWard?.name || '' });
    setError(''); setShowRoomModal(true);
  };

  const openAddBed = () => {
    setEditBedId(null);
    setBedForm({ bedNo: '', type: 'General', wardId: selectedWard?.id || '', wardName: selectedWard?.name || '', roomId: selectedRoom?.id || '', roomNo: selectedRoom?.roomNo || '', dailyRate: '2000' });
    setError(''); setShowBedModal(true);
  };

  const totalBeds = beds.length;
  const occupiedBeds = beds.filter(b => b.status === 'occupied' || bedOccupied(b.id)).length;
  const availableBeds = totalBeds - occupiedBeds;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bed Management</h1>
          <p className="text-sm text-gray-500">
            {totalBeds} total · <span className="text-green-600 font-medium">{availableBeds} available</span> · <span className="text-red-500 font-medium">{occupiedBeds} occupied</span>
          </p>
        </div>
        <button onClick={() => { setEditWardId(null); setWardForm({ name: '', description: '', floor: '' }); setError(''); setShowWardModal(true); }}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700">
          <Plus className="w-4 h-4" /> Add Ward
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[['Wards', wards.length, 'bg-blue-50', 'text-blue-600'],
          ['Rooms', rooms.length, 'bg-violet-50', 'text-violet-600'],
          ['Total Beds', totalBeds, 'bg-gray-50', 'text-gray-700'],
          ['Available', availableBeds, 'bg-green-50', 'text-green-600']
        ].map(([l, v, bg, fg]) => (
          <div key={l as string} className={`${bg} rounded-xl p-4 border border-gray-100`}>
            <div className={`text-2xl font-bold ${fg}`}>{v}</div>
            <div className="text-xs text-gray-500 mt-0.5">{l}</div>
          </div>
        ))}
      </div>

      {/* Three-panel layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Wards panel */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <Building2 className="w-4 h-4 text-blue-500" /> Wards ({wards.length})
            </div>
          </div>
          <div className="divide-y divide-gray-50 max-h-[450px] overflow-y-auto">
            {wards.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-8">No wards yet. Add one to start.</p>
            ) : wards.map(w => {
              const wBeds = beds.filter(b => b.wardId === w.id);
              const wOccupied = wBeds.filter(b => bedOccupied(b.id)).length;
              return (
                <div key={w.id} onClick={() => { setSelectedWard(w); setSelectedRoom(null); }}
                  className={cn('flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-blue-50 transition-colors',
                    selectedWard?.id === w.id && 'bg-blue-50 border-r-2 border-blue-600')}>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-800">{w.name}</div>
                    <div className="text-xs text-gray-400">
                      {w.floor && `Floor ${w.floor} · `}{wBeds.length} beds · {wOccupied} occupied
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={e => { e.stopPropagation(); setEditWardId(w.id); setWardForm({ name: w.name, description: w.description || '', floor: w.floor || '' }); setShowWardModal(true); }}
                      className="p-1 text-gray-400 hover:text-blue-600 rounded"><Edit2 className="w-3.5 h-3.5" /></button>
                    <button onClick={e => { e.stopPropagation(); deleteWard(w.id, w.name); }}
                      className="p-1 text-gray-400 hover:text-red-500 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                    <ChevronRight className="w-4 h-4 text-gray-300" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Rooms panel */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <DoorOpen className="w-4 h-4 text-violet-500" />
              Rooms {selectedWard ? `— ${selectedWard.name}` : '(all)'}
            </div>
            {selectedWard && (
              <button onClick={openAddRoom} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            )}
          </div>
          <div className="divide-y divide-gray-50 max-h-[450px] overflow-y-auto">
            {!selectedWard ? (
              <p className="text-center text-sm text-gray-400 py-8">Select a ward first</p>
            ) : wardRooms.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-8">No rooms in this ward yet.</p>
            ) : wardRooms.map(r => {
              const rBeds = beds.filter(b => b.roomId === r.id);
              const rOccupied = rBeds.filter(b => bedOccupied(b.id)).length;
              return (
                <div key={r.id} onClick={() => setSelectedRoom(selectedRoom?.id === r.id ? null : r)}
                  className={cn('flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-violet-50 transition-colors',
                    selectedRoom?.id === r.id && 'bg-violet-50 border-r-2 border-violet-500')}>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-800">Room {r.roomNo}</div>
                    <div className="text-xs text-gray-400">{r.type} · {rBeds.length} beds · {rOccupied} occupied</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={e => { e.stopPropagation(); setEditRoomId(r.id); setRoomForm({ roomNo: r.roomNo, type: r.type, wardId: r.wardId, wardName: r.wardName }); setShowRoomModal(true); }}
                      className="p-1 text-gray-400 hover:text-blue-600 rounded"><Edit2 className="w-3.5 h-3.5" /></button>
                    <button onClick={e => { e.stopPropagation(); deleteRoom(r.id, r.roomNo); }}
                      className="p-1 text-gray-400 hover:text-red-500 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Beds panel */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <BedDouble className="w-4 h-4 text-green-500" />
              Beds {selectedRoom ? `— Room ${selectedRoom.roomNo}` : selectedWard ? `— ${selectedWard.name}` : '(all)'}
            </div>
            {selectedWard && (
              <button onClick={openAddBed} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            )}
          </div>
          <div className="divide-y divide-gray-50 max-h-[450px] overflow-y-auto">
            {displayBeds.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-8">{selectedWard ? 'No beds yet.' : 'Select a ward first'}</p>
            ) : displayBeds.map(b => {
              const occupied = bedOccupied(b.id);
              const admission = admissions.find(a => a.bedId === b.id);
              return (
                <div key={b.id} className="flex items-center justify-between px-4 py-3">
                  <div className="min-w-0 flex items-center gap-3">
                    <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0',
                      occupied ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600')}>
                      {occupied ? '🛌' : '🛏'}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-gray-800">Bed {b.bedNo}</div>
                      <div className="text-xs text-gray-400">
                        {b.wardName}{b.roomNo ? ` · Room ${b.roomNo}` : ''} · {b.type}
                        {occupied && admission && <span className="text-red-500 ml-1">· {admission.patientName}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', occupied ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-700')}>
                      {occupied ? 'Occupied' : 'Free'}
                    </span>
                    <span className="text-xs text-gray-400">Rs.{b.dailyRate?.toLocaleString()}</span>
                    <button onClick={() => { setEditBedId(b.id); setBedForm({ bedNo: b.bedNo, type: b.type, wardId: b.wardId, wardName: b.wardName, roomId: b.roomId || '', roomNo: b.roomNo || '', dailyRate: String(b.dailyRate || '2000') }); setShowBedModal(true); }}
                      className="p-1 text-gray-400 hover:text-blue-600 rounded"><Edit2 className="w-3.5 h-3.5" /></button>
                    <button onClick={() => deleteBed(b.id, b.bedNo)}
                      className="p-1 text-gray-400 hover:text-red-500 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Ward Modal */}
      {showWardModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">{editWardId ? 'Edit Ward' : 'Add Ward'}</h2>
              <button onClick={() => setShowWardModal(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>}
              {[{ label: 'Ward Name *', key: 'name', placeholder: 'e.g. General Ward, ICU' },
                { label: 'Floor / Location', key: 'floor', placeholder: 'e.g. 1st Floor' },
                { label: 'Description', key: 'description', placeholder: 'Optional description' },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                  <input value={(wardForm as any)[key]} onChange={e => setWardForm(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              ))}
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setShowWardModal(false)} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm">Cancel</button>
              <button onClick={saveWard} disabled={saving} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm disabled:opacity-60">
                {saving ? 'Saving...' : editWardId ? 'Update' : 'Add Ward'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Room Modal */}
      {showRoomModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">{editRoomId ? 'Edit Room' : 'Add Room'}</h2>
              <button onClick={() => setShowRoomModal(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Ward *</label>
                <select value={roomForm.wardId} onChange={e => { const w = wards.find(w => w.id === e.target.value); setRoomForm(f => ({ ...f, wardId: w?.id || '', wardName: w?.name || '' })); }}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— Select Ward —</option>
                  {wards.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Room Number *</label>
                <input value={roomForm.roomNo} onChange={e => setRoomForm(f => ({ ...f, roomNo: e.target.value }))} placeholder="e.g. 101, A-02"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Room Type</label>
                <select value={roomForm.type} onChange={e => setRoomForm(f => ({ ...f, type: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {BED_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setShowRoomModal(false)} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm">Cancel</button>
              <button onClick={saveRoom} disabled={saving} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm disabled:opacity-60">
                {saving ? 'Saving...' : editRoomId ? 'Update' : 'Add Room'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bed Modal */}
      {showBedModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">{editBedId ? 'Edit Bed' : 'Add Bed'}</h2>
              <button onClick={() => setShowBedModal(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Ward *</label>
                <select value={bedForm.wardId} onChange={e => { const w = wards.find(w => w.id === e.target.value); setBedForm(f => ({ ...f, wardId: w?.id || '', wardName: w?.name || '' })); }}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— Select Ward —</option>
                  {wards.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Room (optional)</label>
                <select value={bedForm.roomId} onChange={e => { const r = rooms.find(r => r.id === e.target.value); setBedForm(f => ({ ...f, roomId: r?.id || '', roomNo: r?.roomNo || '' })); }}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— No Room —</option>
                  {rooms.filter(r => !bedForm.wardId || r.wardId === bedForm.wardId).map(r => <option key={r.id} value={r.id}>Room {r.roomNo}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Bed Number *</label>
                  <input value={bedForm.bedNo} onChange={e => setBedForm(f => ({ ...f, bedNo: e.target.value }))} placeholder="e.g. B1, A-01"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Daily Rate (Rs.)</label>
                  <input type="number" value={bedForm.dailyRate} onChange={e => setBedForm(f => ({ ...f, dailyRate: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Bed Type</label>
                <select value={bedForm.type} onChange={e => setBedForm(f => ({ ...f, type: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {BED_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setShowBedModal(false)} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm">Cancel</button>
              <button onClick={saveBed} disabled={saving} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm disabled:opacity-60">
                {saving ? 'Saving...' : editBedId ? 'Update' : 'Add Bed'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
