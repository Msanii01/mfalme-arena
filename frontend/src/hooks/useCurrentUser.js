import { useState, useEffect, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { authAPI } from '../services/api.js';

/**
 * Fetches the current user's backend profile.
 * Returns:
 *   user     — the DB row (or null if not found)
 *   loading  — true while the request is in-flight
 *   error    — error message (or null)
 *   refetch  — call this to re-fetch (e.g. after linking Riot)
 *   hasProfile — true when the user has a riot_puuid linked
 */
export function useCurrentUser() {
  const { ready, authenticated } = usePrivy();
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const fetchUser = useCallback(async () => {
    if (!ready || !authenticated) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await authAPI.getMe();
      setUser(data);
    } catch (err) {
      if (err.response?.status === 404) {
        setUser(null); // Profile doesn't exist yet — not an error
      } else {
        setError(err.response?.data?.error || 'Failed to load profile');
      }
    } finally {
      setLoading(false);
    }
  }, [ready, authenticated]);

  useEffect(() => { fetchUser(); }, [fetchUser]);

  return {
    user,
    loading,
    error,
    refetch: fetchUser,
    hasProfile: !!(user?.riot_puuid),
  };
}
