import { useEffect, useRef } from 'react';
import { collection, onSnapshot, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { createNotification } from './audit';
import { addDays, isBefore, parseISO } from 'date-fns';

/** Runs once per session, watches pharmacy data and fires notifications */
export function useAutoNotifications() {
  const lastRunRef = useRef<string>('');

  useEffect(() => {
    const todayKey = new Date().toISOString().split('T')[0];

    // Only run once per session per day to avoid spam
    if (lastRunRef.current === todayKey) return;
    lastRunRef.current = todayKey;

    async function checkAndNotify() {
      try {
        const snap = await getDocs(collection(db, 'medicines'));
        const medicines = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
        const now = new Date();
        const in30Days = addDays(now, 30);
        const in7Days = addDays(now, 7);

        // Check low stock
        const lowStock = medicines.filter(m => m.stock <= (m.unitsPerBox || 1) * 2 && m.stock > 0);
        const outOfStock = medicines.filter(m => m.stock === 0);

        // Check expiry
        const expiring30 = medicines.filter(m => {
          if (!m.expiryDate) return false;
          try {
            const exp = parseISO(m.expiryDate);
            return isBefore(exp, in30Days) && !isBefore(exp, now);
          } catch { return false; }
        });
        const expiring7 = medicines.filter(m => {
          if (!m.expiryDate) return false;
          try {
            const exp = parseISO(m.expiryDate);
            return isBefore(exp, in7Days) && !isBefore(exp, now);
          } catch { return false; }
        });

        // Check existing notifications to avoid duplicates today
        const existingSnap = await getDocs(
          query(collection(db, 'notifications'), where('createdAt', '>=', todayKey))
        );
        const todayNotifTitles = new Set(existingSnap.docs.map(d => d.data().title));

        // Fire notifications
        if (outOfStock.length > 0) {
          const title = `⚠ ${outOfStock.length} medicine(s) out of stock`;
          if (!todayNotifTitles.has(title)) {
            await createNotification(
              title,
              outOfStock.slice(0, 5).map(m => m.name).join(', ') + (outOfStock.length > 5 ? ` and ${outOfStock.length - 5} more` : ''),
              'error',
              '/pharmacy'
            );
          }
        }

        if (lowStock.length > 0) {
          const title = `📦 ${lowStock.length} medicine(s) running low`;
          if (!todayNotifTitles.has(title)) {
            await createNotification(
              title,
              lowStock.slice(0, 5).map(m => `${m.name} (${m.stock} units left)`).join(', '),
              'warning',
              '/pharmacy'
            );
          }
        }

        if (expiring7.length > 0) {
          const title = `🚨 ${expiring7.length} medicine(s) expiring within 7 days`;
          if (!todayNotifTitles.has(title)) {
            await createNotification(
              title,
              expiring7.slice(0, 5).map(m => m.name).join(', '),
              'error',
              '/pharmacy'
            );
          }
        } else if (expiring30.length > 0) {
          const title = `⏰ ${expiring30.length} medicine(s) expiring within 30 days`;
          if (!todayNotifTitles.has(title)) {
            await createNotification(
              title,
              expiring30.slice(0, 5).map(m => m.name).join(', '),
              'warning',
              '/pharmacy'
            );
          }
        }

        // Check pending lab orders older than 24h
        const labSnap = await getDocs(
          query(collection(db, 'labOrders'), where('status', '==', 'pending'))
        );
        const oldPending = labSnap.docs.filter(d => {
          const created = d.data().createdAt;
          if (!created) return false;
          try { return isBefore(parseISO(created), addDays(now, -1)); } catch { return false; }
        });
        if (oldPending.length > 0) {
          const title = `🔬 ${oldPending.length} lab order(s) pending over 24h`;
          if (!todayNotifTitles.has(title)) {
            await createNotification(title, 'Lab results are overdue. Please update them.', 'warning', '/lab');
          }
        }
      } catch (e) {
        // Silently fail — notifications shouldn't crash the app
        console.warn('Auto-notification check failed:', e);
      }
    }

    // Run after a short delay to avoid blocking initial render
    const timer = setTimeout(checkAndNotify, 3000);
    return () => clearTimeout(timer);
  }, []);
}
