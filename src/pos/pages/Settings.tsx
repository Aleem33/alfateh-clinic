import React, { useState } from 'react';
import { downloadOrShare } from '../lib/nativeUtils';
import { updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { AlertTriangle, Trash2, X, Download, Upload, CheckCircle, Database, Lock, Eye, EyeOff } from 'lucide-react';
import { deleteAppDataScope, exportAllAppData, GLOBAL_DATA_COLLECTIONS, RESET_COLLECTIONS, restoreAllAppData, summarizeBackup } from '../../lib/dataSync';
import { auth } from '../../firebase';
import { MedicineCategoryManager } from '../../components/MedicineCategoryManager';

export function Settings() {
  const [currentPass, setCurrentPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [showCurrentPass, setShowCurrentPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  // Export
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState('');

  // Import
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [importSuccess, setImportSuccess] = useState('');
  const [importError, setImportError] = useState('');
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [pendingImportData, setPendingImportData] = useState<any>(null);

  const handleChangePassword = async () => {
    setPasswordMsg('');
    if (!currentPass || !newPass || !confirmPass) {
      setPasswordMsg('All password fields are required.');
      return;
    }
    if (newPass.length < 6) {
      setPasswordMsg('New password must be at least 6 characters.');
      return;
    }
    if (newPass !== confirmPass) {
      setPasswordMsg('New passwords do not match.');
      return;
    }

    setIsChangingPassword(true);
    try {
      const user = auth.currentUser;
      if (!user?.email) throw new Error('You are not logged in.');
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPass));
      await updatePassword(user, newPass);
      setCurrentPass('');
      setNewPass('');
      setConfirmPass('');
      setPasswordMsg('Password changed successfully.');
      setTimeout(() => setPasswordMsg(''), 4000);
    } catch (error: any) {
      if (error?.code === 'auth/wrong-password' || error?.code === 'auth/invalid-credential') {
        setPasswordMsg('Current password is incorrect.');
      } else {
        setPasswordMsg('Error: ' + (error?.message || 'Could not change password.'));
      }
    } finally {
      setIsChangingPassword(false);
    }
  };

  // ── Export ──────────────────────────────────────────────
  const handleExport = async () => {
    setIsExporting(true);
    setExportProgress('Reading data...');
    try {
      const backup = await exportAllAppData(setExportProgress);
      const json = JSON.stringify(backup, null, 2);
      const date = new Date().toISOString().split('T')[0];
      await downloadOrShare(json, `alfateh-suite-backup-${date}.json`, 'application/json');

      setExportProgress('Done: complete HMS + Pharmacy backup downloaded!');
      setTimeout(() => setExportProgress(''), 4000);
    } catch (error) {
      setExportProgress('Error during export. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  // Import ──────────────────────────────────────────────
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError('');
    setImportSuccess('');

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (!data.collections || !data.exportedAt) {
          setImportError('Invalid backup file. Please use a file exported from this app.');
          return;
        }
        setPendingImportData(data);
        setShowImportConfirm(true);
      } catch {
        setImportError('Could not read file. Make sure it is a valid JSON backup.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleImport = async () => {
    if (!pendingImportData) return;
    setShowImportConfirm(false);
    setIsImporting(true);
    setImportError('');

    try {
      const totalDocs = await restoreAllAppData(pendingImportData, setImportProgress);
      setImportSuccess(`Done: ${totalDocs} records restored across HMS and Pharmacy.`);
      setImportProgress('');
      setTimeout(() => setImportSuccess(''), 6000);
    } catch (error) {
      setImportError('Import failed. Check console for details.');
      setImportProgress('');
    } finally {
      setIsImporting(false);
      setPendingImportData(null);
    }
  };

  // Delete ──────────────────────────────────────────────
  const handleResetData = async () => {
    if (confirmText !== 'DELETE ALL DATA') return;
    setShowConfirmModal(false);
    setIsDeleting(true);
    try {
      const totalDocs = await deleteAppDataScope('pharmacy', setDeleteProgress);
      setDeleteProgress(`Done: deleted ${totalDocs} pharmacy records. User accounts were kept.`);
      setConfirmText('');
    } catch (error: any) {
      setDeleteProgress('Error: ' + (error?.message || 'Could not reset pharmacy data.'));
    } finally {
      setIsDeleting(false);
      setTimeout(() => setDeleteProgress(''), 3000);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* Change Password */}
      <MedicineCategoryManager />

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-6 border-b border-gray-100 bg-blue-50 flex items-center gap-3">
          <Lock className="w-6 h-6 text-blue-600" />
          <div>
            <h2 className="text-lg font-bold text-blue-900">Change Login Password</h2>
            <p className="text-sm text-blue-700 mt-0.5">Update the password for the account currently signed in.</p>
          </div>
        </div>
        <div className="p-6 space-y-4 max-w-xl">
          {passwordMsg && (
            <p className={`text-sm font-medium p-3 rounded-lg ${passwordMsg === 'Password changed successfully.' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
              {passwordMsg}
            </p>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
            <div className="relative">
              <input
                type={showCurrentPass ? 'text' : 'password'}
                value={currentPass}
                onChange={e => setCurrentPass(e.target.value)}
                className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter current password"
              />
              <button type="button" onClick={() => setShowCurrentPass(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showCurrentPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
            <div className="relative">
              <input
                type={showNewPass ? 'text' : 'password'}
                value={newPass}
                onChange={e => setNewPass(e.target.value)}
                className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Minimum 6 characters"
              />
              <button type="button" onClick={() => setShowNewPass(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showNewPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
            <input
              type="password"
              value={confirmPass}
              onChange={e => setConfirmPass(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Repeat new password"
            />
          </div>
          <button
            onClick={handleChangePassword}
            disabled={isChangingPassword}
            className="px-4 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {isChangingPassword ? 'Updating...' : 'Update Password'}
          </button>
        </div>
      </div>

      {/* ── Export Section ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-6 border-b border-gray-100 bg-green-50 flex items-center gap-3">
          <Download className="w-6 h-6 text-green-600" />
          <div>
            <h2 className="text-lg font-bold text-green-900">Export / Backup Data</h2>
            <p className="text-sm text-green-700 mt-0.5">Download HMS and Pharmacy data as one JSON backup file</p>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-gray-600 text-sm">
            Exports the complete clinic suite, including HMS records, pharmacy inventory, sales, purchases, returns, customers, suppliers, settings, templates, and logs.
          </p>
          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div>
              <h3 className="font-bold text-gray-900">Download Full Backup</h3>
              <p className="text-sm text-gray-500 mt-1">All {GLOBAL_DATA_COLLECTIONS.length} suite collections will be exported</p>
            </div>
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="px-4 py-2 bg-green-600 text-white rounded-md font-medium hover:bg-green-700 disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
            >
              <Download className="w-4 h-4" />
              {isExporting ? 'Exporting...' : 'Export Backup'}
            </button>
          </div>
          {exportProgress && (
            <p className="text-sm font-medium text-green-600">{exportProgress}</p>
          )}
        </div>
      </div>

      {/* ── Import Section ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-6 border-b border-gray-100 bg-blue-50 flex items-center gap-3">
          <Upload className="w-6 h-6 text-blue-600" />
          <div>
            <h2 className="text-lg font-bold text-blue-900">Import / Restore Data</h2>
            <p className="text-sm text-blue-700 mt-0.5">Restore HMS and Pharmacy data from a backup file</p>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">
              Importing will <strong>merge</strong> data with existing records using the same document IDs. Existing records with matching IDs will be overwritten. It will not delete records that aren't in the backup.
            </p>
          </div>

          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div>
              <h3 className="font-bold text-gray-900">Restore from Backup File</h3>
              <p className="text-sm text-gray-500 mt-1">Select a .json suite backup file</p>
            </div>
            <label className={`px-4 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 flex items-center gap-2 whitespace-nowrap cursor-pointer ${isImporting ? 'opacity-50 cursor-not-allowed' : ''}`}>
              <Upload className="w-4 h-4" />
              {isImporting ? 'Importing...' : 'Select Backup File'}
              <input
                type="file"
                accept=".json"
                onChange={handleFileSelect}
                disabled={isImporting}
                className="hidden"
              />
            </label>
          </div>

          {importProgress && (
            <p className="text-sm font-medium text-blue-600 animate-pulse">{importProgress}</p>
          )}
          {importSuccess && (
            <div className="flex items-center gap-2 text-green-700 text-sm font-medium bg-green-50 p-3 rounded-lg">
              <CheckCircle className="w-4 h-4" /> {importSuccess}
            </div>
          )}
          {importError && (
            <div className="flex items-center gap-2 text-red-700 text-sm bg-red-50 p-3 rounded-lg">
              <AlertTriangle className="w-4 h-4" /> {importError}
            </div>
          )}
        </div>
      </div>

      {/* ── Danger Zone ── */}
      <div className="bg-white rounded-xl shadow-sm border border-red-200 overflow-hidden">
        <div className="p-6 border-b border-red-100 bg-red-50 flex items-center gap-3">
          <AlertTriangle className="w-6 h-6 text-red-600" />
          <h2 className="text-lg font-bold text-red-900">Danger Zone</h2>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-gray-600 text-sm">
            The actions below are destructive and cannot be reversed. Export a backup first before proceeding.
          </p>
          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div>
              <h3 className="font-bold text-gray-900">Reset Pharmacy Data</h3>
              <p className="text-sm text-gray-500 mt-1">
                Permanently deletes pharmacy/POS records only. Hospital patients, appointments, OPD, lab, bills, staff, and user accounts are kept. {RESET_COLLECTIONS.pharmacy.length} pharmacy collections are included.
              </p>
            </div>
            <button
              onClick={() => setShowConfirmModal(true)}
              disabled={isDeleting}
              className="px-4 py-2 bg-red-600 text-white rounded-md font-medium hover:bg-red-700 disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
            >
              <Trash2 className="w-4 h-4" />
              {isDeleting ? 'Deleting...' : 'Reset Pharmacy Data'}
            </button>
          </div>
          {deleteProgress && (
            <p className="text-sm font-medium text-blue-600 animate-pulse">{deleteProgress}</p>
          )}
        </div>
      </div>

      {/* Import Confirm Modal */}
      {showImportConfirm && pendingImportData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <Database className="w-6 h-6 text-blue-600" />
              <h3 className="text-xl font-bold text-gray-900">Confirm Import</h3>
            </div>
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                Backup from: <strong>{new Date(pendingImportData.exportedAt).toLocaleString()}</strong>
              </p>
              <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700">
                <p className="font-medium mb-1">Records to import:</p>
                <p className="text-gray-600 leading-relaxed">{summarizeBackup(pendingImportData)}</p>
              </div>
              <p className="text-sm text-amber-700 bg-amber-50 p-3 rounded-lg">
                Existing records with the same IDs will be overwritten. New records will be added.
              </p>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => { setShowImportConfirm(false); setPendingImportData(null); }}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                className="px-4 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 flex items-center gap-2"
              >
                <Upload className="w-4 h-4" />
                Yes, Import Data
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-red-600 flex items-center gap-2">
                <AlertTriangle className="w-6 h-6" />
                Confirm Pharmacy Reset
              </h3>
              <button onClick={() => setShowConfirmModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="space-y-4">
              <p className="text-gray-700 font-medium">
                WARNING: You are about to delete pharmacy/POS data. Export a backup first!
              </p>
              <p className="text-red-600 font-bold">This action CANNOT be undone. Internet is required and all user logins keep the same passwords.</p>
              <div className="pt-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Type "DELETE ALL DATA" to confirm:
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="DELETE ALL DATA"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => { setShowConfirmModal(false); setConfirmText(''); }}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleResetData}
                  disabled={confirmText !== 'DELETE ALL DATA'}
                  className="px-4 py-2 bg-red-600 text-white rounded-md font-medium hover:bg-red-700 disabled:opacity-50"
                >
                  Reset Pharmacy
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
