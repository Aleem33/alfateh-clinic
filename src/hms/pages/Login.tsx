import logoUrl from '../../assets/logo';
import { useState } from 'react';
import { loginWithUsername } from '../../firebase';
import { User, Lock, Eye, EyeOff, ArrowLeft } from 'lucide-react';

interface Props {
  onLoginSuccess: () => void;
  onBack?: () => void;
}

export function Login({ onLoginSuccess, onBack }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await loginWithUsername(username, password);
      onLoginSuccess();
    } catch {
      setError('Invalid username or password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f2544] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Back to selector */}
        {onBack && (
          <button onClick={onBack} className="flex items-center gap-1.5 text-blue-300/70 hover:text-blue-300 text-sm mb-6 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to App Selection
          </button>
        )}

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mx-auto mb-4">
            <img src={logoUrl} alt="Al-Fateh Clinic" className="w-20 h-20 object-contain drop-shadow-lg" />
          </div>
          <h1 className="text-white font-semibold text-xl">Al-Fateh Clinic</h1>
          <p className="text-blue-300 text-sm mt-1">Hospital Management System</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl p-6 shadow-xl">
          <h2 className="text-gray-900 font-semibold text-lg mb-5">Sign In</h2>

          {error && (
            <div className="bg-red-50 text-red-600 text-sm rounded-lg px-3 py-2 mb-4 border border-red-100">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            {/* Username */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Username</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  required
                  autoComplete="username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="Enter your username"
                  className="w-full pl-9 pr-3 border border-gray-200 rounded-lg py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type={showPass ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-9 border border-gray-200 rounded-lg py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <p className="text-center text-xs text-gray-400 mt-4">
            Contact your administrator to reset your password.
          </p>
        </div>

        <p className="text-center text-blue-300/50 text-xs mt-6">Al-Fateh Clinic HMS v2.0</p>
      </div>
    </div>
  );
}
