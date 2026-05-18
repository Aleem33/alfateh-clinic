import { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, setDoc } from 'firebase/firestore';
import { db, registerUser } from '../../firebase';
import { formatDate, nowISO } from '../lib/utils';
import { logAudit } from '../lib/audit';
import { Plus, Search, Edit2, Trash2, X, UserCheck, UserX } from 'lucide-react';
import { useAppDialog } from '../../components/AppDialog';

const DEPARTMENTS = ['Administration', 'General Medicine', 'Surgery', 'Gynecology', 'Pediatrics', 'ENT', 'Orthopedics', 'Cardiology', 'Neurology', 'Emergency', 'Laboratory', 'Pharmacy', 'Radiology', 'Nursing'];
const ROLES: Record<string, string> = { admin: 'Admin', receptionist: 'Receptionist', doctor: 'Doctor', pharmacist: 'Pharmacist', lab_technician: 'Lab Technician', cashier: 'Cashier', nurse: 'Nurse' };
const QUALIFICATIONS = ['MBBS', 'MD', 'MS', 'FCPS', 'BDS', 'B.Pharm', 'Pharm-D', 'PMDC', 'BSc Nursing', 'Other'];

const emptyForm = { name: '', role: 'doctor', department: 'General Medicine', phone: '', email: '', qualification: '', salary: '', joiningDate: '', cnic: '', password: '' };

export function Staff() {
  const { confirm } = useAppDialog();
  const [staff, setStaff] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'staff'), snap =>
      setStaff(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => a.name > b.name ? 1 : -1))
    );
    return () => unsub();
  }, []);

  const filtered = staff.filter(s => {
    const matchSearch = !search || s.name?.toLowerCase().includes(search.toLowerCase()) || s.department?.toLowerCase().includes(search.toLowerCase());
    const matchRole = roleFilter === 'all' || s.role === roleFilter;
    return matchSearch && matchRole;
  });

  const openAdd = () => { setEditId(null); setForm(emptyForm); setError(''); setShowModal(true); };
  const openEdit = (s: any) => {
    setEditId(s.id);
    setForm({ name: s.name, role: s.role, department: s.department, phone: s.phone || '', email: s.email || '', qualification: s.qualification || '', salary: String(s.salary || ''), joiningDate: s.joiningDate || '', cnic: s.cnic || '', password: '' });
    setError('');
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.role) { setError('Name and role are required.'); return; }
    setSaving(true); setError('');
    try {
      if (editId) {
        const { password, ...data } = form;
        await updateDoc(doc(db, 'staff', editId), { ...data, salary: Number(form.salary) || 0, updatedAt: nowISO() });
        await logAudit('update', 'staff', editId, form.name);
      } else {
        let userId = '';
        if (form.email && form.password) {
            try {
              const cred = await registerUser(form.email, form.password); // form.email holds the username
              userId = cred.user.uid;
              await setDoc(doc(db, 'users', userId), {
                name: form.name, username: form.email, email: form.email, role: form.role, app: 'hms', createdAt: nowISO(),
              });
            } catch (e: any) {
              console.warn('Could not create auth user:', e.message);
            }
          }
        const { password, ...data } = form;
        const ref = await addDoc(collection(db, 'staff'), { ...data, salary: Number(form.salary) || 0, userId, status: 'active', createdAt: nowISO() });
        await logAudit('create', 'staff', ref.id, `${form.name} — ${form.role}`);
      }
      setShowModal(false);
    } catch (e: any) { setError(e.message || 'Failed to save.'); }
    finally { setSaving(false); }
  };

  const toggleStatus = async (s: any) => {
    const newStatus = s.status === 'active' ? 'inactive' : 'active';
    await updateDoc(doc(db, 'staff', s.id), { status: newStatus, updatedAt: nowISO() });
    await logAudit('update', 'staff', s.id, `${s.name} marked ${newStatus}`);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!(await confirm(`Delete staff member "${name}"?`, { title: 'Delete Staff Member', confirmLabel: 'Delete' }))) return;
    await deleteDoc(doc(db, 'staff', id));
    await logAudit('delete', 'staff', id, name);
  };

  const f = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Staff Management</h1>
          <p className="text-sm text-gray-500">{staff.filter(s => s.status !== 'inactive').length} active staff members</p>
        </div>
        <button onClick={openAdd} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
          <Plus className="w-4 h-4" /> Add Staff
        </button>
      </div>

      <div className="flex items-center gap-3">
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="all">All Roles</option>
          {Object.entries(ROLES).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
        </select>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or department..." className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>{['Name', 'Role', 'Department', 'Phone', 'Qualification', 'Salary', 'Status', 'Actions'].map(h => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
            ))}</tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-12 text-gray-400">No staff found</td></tr>
            ) : filtered.map(s => (
              <tr key={s.id} className={`hover:bg-gray-50/50 ${s.status === 'inactive' ? 'opacity-60' : ''}`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-semibold text-sm shrink-0">
                      {s.name?.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-900">{s.name}</div>
                      {s.email && <div className="text-xs text-gray-400">{s.email}</div>}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3"><span className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full font-medium">{ROLES[s.role] || s.role}</span></td>
                <td className="px-4 py-3 text-sm text-gray-600">{s.department}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{s.phone || '—'}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{s.qualification || '—'}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{s.salary ? `Rs. ${Number(s.salary).toLocaleString()}` : '—'}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.status === 'inactive' ? 'bg-gray-100 text-gray-500' : 'bg-green-100 text-green-700'}`}>
                    {s.status || 'active'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button onClick={() => openEdit(s)} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg"><Edit2 className="w-4 h-4" /></button>
                    <button onClick={() => toggleStatus(s)} className={`p-1.5 rounded-lg ${s.status === 'inactive' ? 'text-green-600 hover:bg-green-50' : 'text-orange-500 hover:bg-orange-50'}`}>
                      {s.status === 'inactive' ? <UserCheck className="w-4 h-4" /> : <UserX className="w-4 h-4" />}
                    </button>
                    <button onClick={() => handleDelete(s.id, s.name)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">{editId ? 'Edit Staff Member' : 'Add Staff Member'}</h2>
              <button onClick={() => setShowModal(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>}
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Full Name *</label>
                  <input value={form.name} onChange={e => f('name', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Role *</label>
                  <select value={form.role} onChange={e => f('role', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {Object.entries(ROLES).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Department</label>
                  <select value={form.department} onChange={e => f('department', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                  <input value={form.phone} onChange={e => f('phone', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">CNIC</label>
                  <input value={form.cnic} onChange={e => f('cnic', e.target.value)} placeholder="XXXXX-XXXXXXX-X" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Qualification</label>
                  <select value={form.qualification} onChange={e => f('qualification', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">— Select —</option>
                    {QUALIFICATIONS.map(q => <option key={q}>{q}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Salary (Rs.)</label>
                  <input type="number" value={form.salary} onChange={e => f('salary', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Joining Date</label>
                  <input type="date" value={form.joiningDate} onChange={e => f('joiningDate', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                {!editId && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Username (for login)</label>
                      <input type="text" value={form.email} onChange={e => f('email', e.target.value)} placeholder="Login username (e.g. dr.ahmed)" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
                      <input type="password" value={form.password} onChange={e => f('password', e.target.value)} placeholder="Min 6 characters" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div className="col-span-2 text-xs text-gray-400 bg-blue-50 p-2 rounded-lg">
                      💡 Providing a username & password will create a login account for this staff member.
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setShowModal(false)} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm disabled:opacity-60">{saving ? 'Saving...' : editId ? 'Update' : 'Add Staff'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
