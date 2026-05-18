import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { db, registerSecondaryUser, usernameToEmail, handleFirestoreError, OperationType } from '../../firebase';
import { Plus, Trash2, Shield, User as UserIcon, Edit2, X } from 'lucide-react';
import { format } from 'date-fns';

const ROLES = [
  { value: 'cashier', label: 'Cashier (Billing Only)' },
  { value: 'pharmacist', label: 'Pharmacist (Inventory & Billing)' },
  { value: 'admin', label: 'Admin (Full Access)' },
];

const emptyForm = { name: '', username: '', password: '', role: 'cashier' };

export function Users() {
  const [users, setUsers] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<any | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'), snap =>
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => a.name > b.name ? 1 : -1)),
      error => handleFirestoreError(error, OperationType.GET, 'users')
    );
    return () => unsub();
  }, []);

  const openAdd = () => { setForm(emptyForm); setEditingId(null); setError(''); setShowModal(true); };
  const openEdit = (u: any) => {
    setForm({ name: u.name, username: u.username || '', password: '', role: u.role || 'cashier' });
    setEditingId(u.id);
    setError('');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required.'); return; }
    if (!editingId && !form.username.trim()) { setError('Username is required.'); return; }
    if (!editingId && form.password.length < 6) { setError('Password must be at least 6 characters.'); return; }

    setLoading(true);
    setError('');
    try {
      if (editingId) {
        await updateDoc(doc(db, 'users', editingId), {
          name: form.name.trim(),
          role: form.role,
          updatedAt: new Date().toISOString(),
        });
      } else {
        const username = form.username.trim().toLowerCase();
        const cred = await registerSecondaryUser(username, form.password);
        await setDoc(doc(db, 'users', cred.user.uid), {
          name: form.name.trim(),
          username,
          email: usernameToEmail(username),
          role: form.role,
          app: 'pos',
          createdAt: new Date().toISOString(),
        });
      }
      setShowModal(false);
      setForm(emptyForm);
      setEditingId(null);
    } catch (e: any) {
      const msg = e.message || 'Failed to save user.';
      if (msg.includes('email-already-in-use')) {
        setError('Username already taken. Choose a different one.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (!confirmDeleteUser) return;
    try {
      await deleteDoc(doc(db, 'users', confirmDeleteUser.id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${confirmDeleteUser.id}`);
    } finally {
      setConfirmDeleteUser(null);
    }
  };

  return (
    <div className="space-y-5">
      {confirmDeleteUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Delete User</h3>
            <p className="text-sm text-gray-600 mb-1">
              Delete <strong>{confirmDeleteUser.name}</strong> from app access?
            </p>
            <p className="text-sm text-amber-700 bg-amber-50 rounded-lg p-3 mb-6">
              This removes their role record. The Firebase Auth account must be removed from Firebase Console if needed.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDeleteUser(null)} className="px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={confirmDelete} className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Users</h1>
          <p className="text-sm text-gray-500">{users.length} user accounts</p>
        </div>
        <button onClick={openAdd}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 text-sm font-medium">
          <Plus className="w-4 h-4" /> Add User
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs font-semibold uppercase border-b border-gray-100">
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Username</th>
                <th className="px-4 py-3 text-left">Role</th>
                <th className="px-4 py-3 text-left">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
                        <UserIcon className="w-3.5 h-3.5 text-blue-600" />
                      </div>
                      {u.name}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 font-mono">
                    {u.username || u.email?.split('@')[0] || '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      u.role === 'admin' ? 'bg-purple-100 text-purple-800' :
                      u.role === 'pharmacist' ? 'bg-blue-100 text-blue-800' :
                      'bg-green-100 text-green-800'
                    }`}>
                      {u.role === 'admin' && <Shield className="w-3 h-3" />}
                      {u.role?.charAt(0).toUpperCase() + u.role?.slice(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {u.createdAt ? format(new Date(u.createdAt), 'MMM dd, yyyy') : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => openEdit(u)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded" title="Edit">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => setConfirmDeleteUser(u)} className="p-1.5 text-red-600 hover:bg-red-50 rounded" title="Delete">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400 text-sm">No users found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">{editingId ? 'Edit User' : 'Add New User'}</h2>
              <button onClick={() => { setShowModal(false); setError(''); }}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm border border-red-100">{error}</div>}

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Full Name *</label>
                <input required type="text" value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Ahmed Khan" />
              </div>

              {!editingId && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Username * (used to log in)</label>
                    <input required type="text" value={form.username}
                      onChange={e => setForm(f => ({ ...f, username: e.target.value.replace(/\s+/g, '.').toLowerCase() }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                      placeholder="e.g. ahmed.cashier" />
                    <p className="text-xs text-gray-400 mt-1">No spaces. Use dots instead, for example john.doe.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Password *</label>
                    <input required type="password" minLength={6} value={form.password}
                      onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Min 6 characters" />
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Role *</label>
                <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>

              {editingId && (
                <p className="text-xs text-amber-600 bg-amber-50 rounded-lg p-2">
                  Username and password changes are handled by Firebase Auth. This screen updates the display name and role.
                </p>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowModal(false); setError(''); }}
                  className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={loading}
                  className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                  {loading ? 'Saving...' : editingId ? 'Save Changes' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
