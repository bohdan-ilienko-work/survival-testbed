// The character & flag editor's three writes (beG.resetChar / beG.changeFlag /
// adminApi.grantToPlayer).
//
// All three go through run() so a refusal reaches the editor as a rejection carrying the
// server's own words — the editor prints error.message verbatim and adds a hint of its own
// only for the refusals it recognises.

import type { Dispatch, SetStateAction } from 'react';
import type { ActionDeps, Profile } from './types';

export interface ProfileEdits {
  applyCharacter: (payload: { character: number; categories: string[] }) => Promise<void>;
  applyFlag: (flag: string) => Promise<void>;
  grantToPlayer: (payload: {
    characters?: number[];
    flags?: string[];
    experience?: number;
    gems?: number;
  }) => Promise<void>;
}

export interface ProfileEditsContext {
  playerId?: string;
  setProfile: Dispatch<SetStateAction<Profile | null>>;
  fetchProfile: () => Promise<any>;
  fetchBooking: () => Promise<any>;
}

export function useProfileEdits(deps: ActionDeps, ctx: ProfileEditsContext): ProfileEdits {
  const { gw, run } = deps;
  const { playerId, setProfile, fetchProfile, fetchBooking } = ctx;

  /**
   * beG.resetChar. ONE positional argument, the {character, categories} object
   * (main-server api/beG/resetChar.js), and `categories` is ordered [strong, strong, weak] —
   * resetChar reads categories.slice(0,2) as the strong pair and [2] as the weak one, so it must
   * not be sorted or de-duplicated on the way out.
   */
  const applyCharacter = async ({
    character,
    categories,
  }: {
    character: number;
    categories: string[];
  }) => {
    await run('beG.resetChar', async () => {
      const res: any = await gw().call('main', 'beG', 'resetChar', [{ character, categories }]);
      // The reply carries the character the server actually stored, so adopt THAT rather than
      // what we asked for — and do it before the refresh below, so «зараз» moves even if the
      // refresh is refused.
      setProfile((p) => ({
        ...(p ?? {}),
        character: typeof res?.character === 'number' ? res.character : character,
      }));
      // The booking roster has a character column, so it is worth redrawing — but its rows are
      // stamped at RegisterPlayer time, so what actually changes there is the NEXT lobby's rows.
      // A failure here is not a refused reset, so it must never reject this promise: the editor
      // would print the refresh's message as if the character change had been denied.
      await fetchBooking().catch(() => undefined);
      return res;
    });
  };

  /** beG.changeFlag — one positional argument, the code or premium flag NAME. */
  const applyFlag = async (flag: string) => {
    await run(`beG.changeFlag ${flag}`, async () => {
      const res: any = await gw().call('main', 'beG', 'changeFlag', [flag]);
      setProfile((p) => ({ ...(p ?? {}), flag: typeof res?.flag === 'string' ? res.flag : flag }));
      await fetchBooking().catch(() => undefined);
      return res;
    });
  };

  /**
   * adminApi.grantToPlayer — the testbed shortcut that makes a premium character or flag
   * selectable at all. The editor never sends a playerId (it has no business knowing one), so it
   * is added here, together with the audit `reason` main-server writes into moneyFlow.
   */
  const grantToPlayer = async (payload: {
    characters?: number[];
    flags?: string[];
    experience?: number;
    gems?: number;
  }) => {
    await run('adminApi.grantToPlayer', async () => {
      const res = await gw().call('main', 'adminApi', 'grantToPlayer', [
        { playerId, ...payload, reason: 'testbed' },
      ]);
      // A grant moves ownership and the wallet, neither of which is drawn on this screen — but
      // main-server itself treats the client as stale afterwards (it pushes `runMain` to force a
      // context refetch), so take it at its word rather than guess that nothing changed.
      await fetchProfile().catch(() => undefined);
      return res;
    });
  };

  return { applyCharacter, applyFlag, grantToPlayer };
}
