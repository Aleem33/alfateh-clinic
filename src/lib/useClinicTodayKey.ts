import { useEffect, useState } from 'react';
import { clinicDateKey } from './clinicDate';

const DATE_REFRESH_INTERVAL_MS = 30_000;

export function useClinicTodayKey(): string {
  const [todayKey, setTodayKey] = useState(() => clinicDateKey(new Date()));

  useEffect(() => {
    const refresh = () => setTodayKey(current => {
      const next = clinicDateKey(new Date());
      return next === current ? current : next;
    });
    const intervalId = window.setInterval(refresh, DATE_REFRESH_INTERVAL_MS);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  return todayKey;
}
