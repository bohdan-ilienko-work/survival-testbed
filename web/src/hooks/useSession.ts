// Who this tab is signed in as, and what that player looks like right now.
//
// Two answers the rest of the screen keeps asking for and nothing else can give: the gateway
// session ({accountId, deviceId, playerId, tabId}) and the live character / flag / name, which
// only beG.getContext knows. The sessionStorage account lives here too — "which player is this
// tab" and "which account does a reload come back as" are the same question.

import { useCallback, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Gateway } from '../gateway';
import type { ActionDeps, Profile } from './types';

// sessionStorage is per-tab: a reload keeps this tab's player, a NEW tab starts
// with nothing stored and therefore gets a brand new mock player.
const ACCOUNT_KEY = 'survival-testbed:account';

export const loadAccount = (): { accountId: string; deviceId: string } | null => {
  try {
    return JSON.parse(sessionStorage.getItem(ACCOUNT_KEY) || 'null');
  } catch {
    return null;
  }
};

export const saveAccount = (a: { accountId: string; deviceId: string } | null) => {
  if (a) sessionStorage.setItem(ACCOUNT_KEY, JSON.stringify(a));
  else sessionStorage.removeItem(ACCOUNT_KEY);
};

export interface SessionState {
  /** the raw gateway session — {accountId, deviceId, playerId, tabId} */
  session: any;
  setSession: Dispatch<any>;
  playerId?: string;
  /** the same id in a ref: the event reducer needs it from outside a render */
  playerIdRef: RefObject<string | undefined>;
  profile: Profile | null;
  setProfile: Dispatch<SetStateAction<Profile | null>>;
  fetchProfile: () => Promise<any>;
  /** the auto sign-in the gateway's onOpen fires */
  signIn: (gw: Gateway) => Promise<void>;
  mockUser: (fresh?: boolean) => Promise<unknown>;
}

/**
 * @param onPlayerChanged everything on screen that belongs to the account being replaced —
 * see mockUser, which is the only thing that swaps a player under a live UI.
 */
export function useSession(deps: ActionDeps, onPlayerChanged: () => void): SessionState {
  const { gw, run, pushLog } = deps;
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const playerId: string | undefined = session?.playerId;
  const playerIdRef = useRef<string | undefined>(undefined);
  playerIdRef.current = playerId;

  /**
   * Re-read the player's live character / flag / name.
   *
   * beG.getContext is the very call the real client's main menu makes, and `userContext` is
   * where main-server publishes those fields — see the Profile type for why no cheaper source
   * exists.
   *
   * Not wrapped in run() on purpose, exactly like fetchBooking: callers refresh from INSIDE
   * their own run(), and a nested run()'s finally would clear `busy` while the outer call is
   * still in flight.
   */
  const fetchProfile = useCallback(async () => {
    const res: any = await gw().call('main', 'beG', 'getContext', []);
    const u = res?.userContext;
    if (!u || typeof u !== 'object') return undefined;
    // Read guarded, like survival.ts reads the wire: a renamed or missing field has to degrade
    // into "не знаю" instead of putting an undefined-driven picture on screen.
    setProfile({
      character: typeof u.character === 'number' ? u.character : undefined,
      flag: typeof u.flag === 'string' ? u.flag : undefined,
      name: typeof u.name === 'string' ? u.name : undefined,
      // published right beside character/flag (lib/contexts.js) — see Profile.reborn
      reborn: typeof u.reborn === 'boolean' ? u.reborn : undefined,
    });
    return u;
    // gw is identity-stable, so this callback never changes — which matters, because the gateway
    // effect that calls it must never be re-armed.
  }, [gw]);

  const signIn = useCallback(
    async (gateway: Gateway) => {
      try {
        await gateway.connectTarget('main');
        const s = await gateway.mockUser(loadAccount());
        if (s?.accountId && s?.deviceId)
          saveAccount({ accountId: s.accountId, deviceId: s.deviceId });
        setSession(s);
        pushLog(`автовхід: гравець ${s?.playerId}`);
        // The header portrait and the editor's «зараз» both read this. A miss is not a failed
        // sign-in, so it must not fall into the catch below and claim the login broke.
        await fetchProfile().catch((e) => pushLog(`beG.getContext ✗ ${(e as Error).message}`));
      } catch (e) {
        pushLog(`автовхід не вдався: ${(e as Error).message}`);
      }
    },
    [fetchProfile, pushLog],
  );

  const mockUser = (fresh = false) =>
    run(fresh ? 'new mock player' : 'mock user sign in', async () => {
      if (fresh) saveAccount(null);
      const s = await gw().mockUser(fresh ? null : loadAccount());
      if (s?.accountId && s?.deviceId) saveAccount({ accountId: s.accountId, deviceId: s.deviceId });
      setSession(s);
      onPlayerChanged();
      // Same for the look: every mock account is signed up with its own character (the gateway
      // rotates them), so keeping the old one would draw the previous player's portrait in the
      // header and preselect it in the editor.
      setProfile(null);
      await fetchProfile().catch(() => undefined);
      return { tab: s?.tabId, playerId: s?.playerId };
    }).catch(() => undefined);

  return {
    session,
    setSession,
    playerId,
    playerIdRef,
    profile,
    setProfile,
    fetchProfile,
    signIn,
    mockUser,
  };
}
