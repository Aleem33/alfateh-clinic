import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { signOut, updateEmail, updatePassword } from 'firebase/auth';
import { db, auth, secondaryAuth, registerSecondaryUser, handleFirestoreError, OperationType } from '../../firebase';
import { Plus, Trash2, Shield, User as UserIcon, Edit2 } from 'lucide-react';
import { format } from 'date-fns';

export function Users() {
  const [users, setUsers] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    role: 'cashier'
  });

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'), (snapshot) => {
      const usersList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setUsers(usersList);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'users'));
    return () => unsub();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (editingId) {
        // Update existing user in Firestore
        await updateDoc(doc(db, 'users', editingId), {
          name: formData.username,
          email: formData.email,
          role: formData.role
        });

        // If editing self, update Auth profile
        if (editingId === auth.currentUser?.uid) {
          if (formData.email && formData.email !== auth.currentUser.email) {
            await updateEmail(auth.currentUser, formData.email);
          }
          if (formData.password) {
            await updatePassword(auth.currentUser, formData.password);
          }
        } else if (formData.password || (formData.email && formData.email !== users.find(u => u.id === editingId)?.email)) {
          // Cannot update other users' auth credentials from client SDK
          setInfoMsg("Note: Firestore profile updated. However, changing the login Email or Password for OTHER users requires them to do it themselves, or an admin must use the Firebase Console.");
          setTimeout(() => setInfoMsg(''), 6000);
        }

        setIsModalOpen(false);
        setEditingId(null);
        setFormData({ username: '', email: '', password: '', role: 'cashier' });
      } else {
        // Create new user
        const emailToUse = formData.email || `${formData.username.toLowerCase().replace(/\s+/g, '')}@alfateh-pharmacy.internal`;
        
        // Create user in Firebase Auth using secondary app
        const userCredential = await registerSecondaryUser(emailToUse, formData.password);
        
        // Add user to Firestore
        await setDoc(doc(db, 'users', userCredential.user.uid), {
          name: formData.username,
          email: emailToUse,
          role: formData.role,
          createdAt: new Date().toISOString()
        });

        // Sign out the secondary auth instance so it doesn't interfere
        await signOut(secondaryAuth);

        setIsModalOpen(false);
        setFormData({ username: '', email: '', password: '', role: 'cashier' });
      }
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') {
        setError('A user with this email/username already exists.');
      } else if (err.code === 'auth/requires-recent-login') {
        setError('Changing your email/password requires a recent login. Please log out and log back in.');
      } else {
        setError(err.message || 'Failed to save user.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (user: any) => {
    setFormData({
      username: user.name,
      email: user.email,
      password: '', // Leave blank, only fill if they want to change it
      role: user.role
    });
    setEditingId(user.id);
    setError('');
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    setConfirmDeleteId(id);
  };

  const confirmDelete = async () => {
    if (!confirmDeleteId) return;
    try {
      await deleteDoc(doc(db, 'users', confirmDeleteId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${confirmDeleteId}`);
    } finally {
      setConfirmDeleteId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Info Toast */}
      {infoMsg && (
        <div className="fixed top-4 right-4 bg-blue-600 text-white px-5 py-3 rounded-lg shadow-lg z-50 max-w-sm text-sm">
          {infoMsg}
        </div>
      )}

      {/* Confirm Delete Modal */}
      {confirmDeleteId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Delete User</h3>
            <p className="text-gray-600 mb-1">Are you sure you want to delete this user?</p>
            <p className="text-sm text-amber-700 bg-amber-50 rounded p-2 mb-6">Note: This only removes their access role. Their auth account must be deleted in Firebase Console.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmDeleteId(null)} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={confirmDelete} className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700">Delete</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
        <button
          onClick={() => {
            setEditingId(null);
            setError('');
            setFormData({ username: '', email: '', password: '', role: 'cashier' });
            setIsModalOpen(true);
          }}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" /> Add User
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-sm border-b border-gray-100">
                <th className="p-4 font-medium">Name</th>
                <th className="p-4 font-medium">Email</th>
                <th className="p-4 font-medium">Role</th>
                <th className="p-4 font-medium">Created At</th>
                <th className="p-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="p-4 font-medium text-gray-900 flex items-center gap-2">
                    <UserIcon className="w-4 h-4 text-gray-400" />
                    {user.name}
                  </td>
                  <td className="p-4 text-gray-600">{user.email}</td>
                  <td className="p-4">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      user.role === 'admin' ? 'bg-purple-100 text-purple-800' : 
                      user.role === 'pharmacist' ? 'bg-blue-100 text-blue-800' : 
                      'bg-green-100 text-green-800'
                    }`}>
                      {user.role === 'admin' && <Shield className="w-3 h-3" />}
                      {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                    </span>
                  </td>
                  <td className="p-4 text-gray-600">
                    {user.createdAt ? format(new Date(user.createdAt), 'MMM dd, yyyy') : 'N/A'}
                  </td>
                  <td className="p-4 flex justify-end gap-2">
                    <button 
                      onClick={() => handleEdit(user)} 
                      className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                      title="Edit User"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => handleDelete(user.id)} 
                      className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                      title="Delete User"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-gray-500">
                    No users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900">
                {editingId ? 'Edit User' : 'Add New User'}
              </h2>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {error && (
                <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm">
                  {error}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input 
                  required 
                  type="text" 
                  value={formData.username} 
                  onChange={e => setFormData({...formData, username: e.target.value})} 
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500" 
                  placeholder="e.g. John Doe"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input 
                  required={!editingId}
                  type="email" 
                  value={formData.email} 
                  onChange={e => setFormData({...formData, email: e.target.value})} 
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500" 
                  placeholder="e.g. john@alfateh-pharmacy.internal"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {editingId ? 'New Password (leave blank to keep current)' : 'Password'}
                </label>
                <input 
                  required={!editingId}
                  type="password" 
                  minLength={6}
                  value={formData.password} 
                  onChange={e => setFormData({...formData, password: e.target.value})} 
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500" 
                  placeholder={editingId ? 'Enter new password...' : ''}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select 
                  value={formData.role} 
                  onChange={e => setFormData({...formData, role: e.target.value})} 
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="cashier">Cashier (Billing Only)</option>
                  <option value="pharmacist">Pharmacist (Inventory & Suppliers)</option>
                  <option value="admin">Admin (Full Access)</option>
                </select>
              </div>
              <div className="pt-4 flex justify-end gap-3">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md font-medium">
                  Cancel
                </button>
                <button type="submit" disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 disabled:opacity-50">
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
