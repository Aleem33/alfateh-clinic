import { useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase';
import { nowISO } from '../lib/utils';
import { Check, Zap, Building2, Crown, Star } from 'lucide-react';

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    icon: Zap,
    color: 'blue',
    price: 4999,
    period: '/month',
    description: 'Perfect for small clinics and solo practitioners.',
    features: [
      'Up to 500 patients',
      'Up to 3 staff accounts',
      'Appointments & OPD',
      'Basic billing & invoices',
      'Pharmacy inventory',
      'Email support',
    ],
    limitations: [
      'No IPD module',
      'No audit logs',
      'No advanced reports',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    icon: Building2,
    color: 'violet',
    price: 9999,
    period: '/month',
    description: 'For growing hospitals with multiple departments.',
    popular: true,
    features: [
      'Up to 5,000 patients',
      'Up to 15 staff accounts',
      'All Starter features',
      'IPD admissions',
      'Laboratory module',
      'Audit logs',
      'CSV & PDF exports',
      'Priority support',
    ],
    limitations: [
      'No multi-branch',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    icon: Crown,
    color: 'amber',
    price: 19999,
    period: '/month',
    description: 'Enterprise-grade for large hospital chains.',
    features: [
      'Unlimited patients',
      'Unlimited staff accounts',
      'All Growth features',
      'Multi-branch support',
      'Custom branding',
      'Advanced analytics',
      'Dedicated account manager',
      'SLA-backed uptime',
      '24/7 phone support',
    ],
    limitations: [],
  },
];

const colorMap: Record<string, { bg: string; text: string; border: string; badge: string }> = {
  blue:   { bg: 'bg-blue-50',   text: 'text-blue-600',   border: 'border-blue-200',   badge: 'bg-blue-600 text-white'   },
  violet: { bg: 'bg-violet-50', text: 'text-violet-600', border: 'border-violet-300', badge: 'bg-violet-600 text-white' },
  amber:  { bg: 'bg-amber-50',  text: 'text-amber-600',  border: 'border-amber-200',  badge: 'bg-amber-500 text-white'  },
};

export function Plans() {
  const [currentPlan, setCurrentPlan] = useState('starter');
  const [trialDaysLeft, setTrialDaysLeft] = useState<number | null>(null);
  const [saving, setSaving] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    getDoc(doc(db, 'settings', 'subscription')).then(snap => {
      if (snap.exists()) {
        const data = snap.data();
        setCurrentPlan(data.plan || 'starter');
        if (data.trialEnds) {
          const days = Math.ceil((new Date(data.trialEnds).getTime() - Date.now()) / 86400000);
          setTrialDaysLeft(days > 0 ? days : 0);
        }
      }
    });
  }, []);

  const handleSelect = async (planId: string) => {
    if (planId === currentPlan) return;
    setSaving(planId); setMsg('');
    try {
      await setDoc(doc(db, 'settings', 'subscription'), {
        plan: planId,
        activatedAt: nowISO(),
        activatedBy: auth.currentUser?.email || 'admin',
        updatedAt: nowISO(),
      });
      setCurrentPlan(planId);
      setMsg(`✓ Plan updated to ${PLANS.find(p => p.id === planId)?.name}!`);
      setTimeout(() => setMsg(''), 3000);
    } catch (e: any) { setMsg('Error: ' + e.message); }
    finally { setSaving(''); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Subscription Plans</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your Al-Fateh-HMS plan and billing.</p>
      </div>

      {/* Trial banner */}
      {trialDaysLeft !== null && trialDaysLeft > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 flex items-center gap-3">
          <Star className="w-5 h-5 text-amber-500 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Free Trial Active</p>
            <p className="text-xs text-amber-600">{trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''} remaining — upgrade anytime to keep all features.</p>
          </div>
        </div>
      )}

      {msg && (
        <div className={`text-sm font-medium p-3 rounded-xl ${msg.startsWith('✓') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
          {msg}
        </div>
      )}

      {/* Current plan badge */}
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <span>Current plan:</span>
        <span className="font-semibold text-gray-900 capitalize">{currentPlan}</span>
        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Active</span>
      </div>

      {/* Plan Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {PLANS.map(plan => {
          const c = colorMap[plan.color];
          const isActive = plan.id === currentPlan;
          const Icon = plan.icon;

          return (
            <div key={plan.id}
              className={`relative bg-white rounded-2xl border-2 shadow-sm flex flex-col transition-all ${
                isActive ? `${c.border} shadow-md` : 'border-gray-100 hover:border-gray-200 hover:shadow-md'
              }`}>

              {/* Popular badge */}
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-violet-600 text-white text-xs font-bold px-3 py-1 rounded-full">Most Popular</span>
                </div>
              )}

              {/* Active badge */}
              {isActive && (
                <div className="absolute -top-3 right-4">
                  <span className={`${c.badge} text-xs font-bold px-3 py-1 rounded-full`}>Current Plan</span>
                </div>
              )}

              <div className="p-6 flex-1">
                {/* Plan header */}
                <div className="flex items-center gap-3 mb-4">
                  <div className={`w-10 h-10 ${c.bg} rounded-xl flex items-center justify-center`}>
                    <Icon className={`w-5 h-5 ${c.text}`} />
                  </div>
                  <div>
                    <div className="font-bold text-gray-900">{plan.name}</div>
                    <div className="text-xs text-gray-400">{plan.description}</div>
                  </div>
                </div>

                {/* Price */}
                <div className="mb-6">
                  <span className="text-3xl font-bold text-gray-900">Rs. {plan.price.toLocaleString()}</span>
                  <span className="text-sm text-gray-400">{plan.period}</span>
                </div>

                {/* Features */}
                <ul className="space-y-2.5 mb-4">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-gray-700">
                      <Check className={`w-4 h-4 ${c.text} shrink-0 mt-0.5`} />
                      {f}
                    </li>
                  ))}
                  {plan.limitations.map(l => (
                    <li key={l} className="flex items-start gap-2.5 text-sm text-gray-400">
                      <span className="w-4 h-4 flex items-center justify-center shrink-0 mt-0.5 text-gray-300">✕</span>
                      {l}
                    </li>
                  ))}
                </ul>
              </div>

              {/* CTA */}
              <div className="px-6 pb-6">
                <button
                  onClick={() => handleSelect(plan.id)}
                  disabled={isActive || saving === plan.id}
                  className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                    isActive
                      ? 'bg-gray-100 text-gray-400 cursor-default'
                      : `${c.badge} hover:opacity-90 disabled:opacity-60`
                  }`}
                >
                  {saving === plan.id ? 'Updating...' : isActive ? '✓ Active Plan' : `Upgrade to ${plan.name}`}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Feature Comparison Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Full Feature Comparison</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Feature</th>
                {PLANS.map(p => (
                  <th key={p.id} className={`px-6 py-3 text-center text-xs font-semibold uppercase ${p.id === currentPlan ? colorMap[p.color].text : 'text-gray-500'}`}>
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {[
                ['Patients', '500', '5,000', 'Unlimited'],
                ['Staff accounts', '3', '15', 'Unlimited'],
                ['Appointments & OPD', '✓', '✓', '✓'],
                ['Billing & Invoices', '✓', '✓', '✓'],
                ['Pharmacy module', '✓', '✓', '✓'],
                ['IPD admissions', '✗', '✓', '✓'],
                ['Laboratory module', '✗', '✓', '✓'],
                ['Audit logs', '✗', '✓', '✓'],
                ['CSV/PDF exports', '✗', '✓', '✓'],
                ['Multi-branch support', '✗', '✗', '✓'],
                ['Custom branding', '✗', '✗', '✓'],
                ['Dedicated support', '✗', '✗', '✓'],
              ].map(([feature, ...values]) => (
                <tr key={feature as string} className="hover:bg-gray-50/50">
                  <td className="px-6 py-3 text-gray-700 font-medium">{feature}</td>
                  {values.map((v, i) => (
                    <td key={i} className="px-6 py-3 text-center">
                      {v === '✓' ? (
                        <span className="text-green-500 font-bold text-base">✓</span>
                      ) : v === '✗' ? (
                        <span className="text-gray-300 text-base">✗</span>
                      ) : (
                        <span className="text-gray-700 text-xs font-medium">{v}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Contact */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-6 text-white flex items-center justify-between">
        <div>
          <p className="font-semibold text-lg">Need a custom enterprise plan?</p>
          <p className="text-blue-100 text-sm mt-0.5">Contact our team for multi-hospital pricing, white-labelling, and custom integrations.</p>
        </div>
        <a href="mailto:sales@alfatehclinic.com"
          className="px-5 py-2.5 bg-white text-blue-700 rounded-xl text-sm font-semibold hover:bg-blue-50 transition-colors whitespace-nowrap">
          Contact Sales
        </a>
      </div>
    </div>
  );
}
