import { useState, useEffect, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { authAPI } from '../services/api.js';

// Cache the user globally to prevent redundant API calls during navigation
let globalUserCache = null;

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
  const [user, setUser]       = useState(globalUserCache);
  const [loading, setLoading] = useState(globalUserCache === null);
  const [error, setError]     = useState(null);

  const fetchUser = useCallback(async (force = false) => {
    if (!ready || !authenticated) {
      setLoading(false);
      return;
    }
    
    if (globalUserCache && !force) {
      setUser(globalUserCache);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await authAPI.getMe();
      globalUserCache = data;
      setUser(data);
    } catch (err) {
      if (err.response?.status === 404) {
        globalUserCache = null;
        setUser(null);
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
    refetch: () => fetchUser(true),
    hasProfile: !!(user?.riot_puuid),
  };
}
