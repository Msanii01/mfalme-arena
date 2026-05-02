import { useState, useEffect, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { authAPI } from '../services/api.js';

// Cache the user globally to prevent redundant API calls during navigation
let globalUserCache = null;

/** Manually clear the cached user. Call from logout flows so a re-login
 *  doesn't show stale data from a previous session. */
export function clearUserCache() {
  globalUserCache = null;
}

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
  const { user: privyUser, ready, authenticated } = usePrivy();
  const [user, setUser]       = useState(globalUserCache);
  const [loading, setLoading] = useState(globalUserCache === null);
  const [error, setError]     = useState(null);

  // M7: Depend on stable scalar identifiers, not the whole `privyUser`
  // object — Privy rebuilds that object on every token refresh, which would
  // cause this hook to re-run getMe() spuriously.
  const privyUserId = privyUser?.id;
  const walletAddress = privyUser?.wallet?.address
    || privyUser?.linkedAccounts?.find((a) => a.type === 'wallet')?.address
    || null;

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
        // User not in DB. Try to sync them automatically if we have a wallet.
        try {
          if (walletAddress) {
            const syncedUser = await authAPI.syncUser();
            globalUserCache = syncedUser;
            setUser(syncedUser);
            setError(null);
          } else {
            globalUserCache = null;
            setUser(null);
          }
        } catch (syncErr) {
          globalUserCache = null;
          setUser(null);
        }
      } else {
        setError(err.response?.data?.error || 'Failed to load profile');
      }
    } finally {
      setLoading(false);
    }
  }, [ready, authenticated, privyUserId, walletAddress]);

  // When the user logs out, drop the cache so a fresh login doesn't see
  // the previous session's data.
  useEffect(() => {
    if (ready && !authenticated) {
      globalUserCache = null;
      setUser(null);
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
