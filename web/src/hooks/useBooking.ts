// 1а. Реєстрація — the pre-match booking screen, and the two testbed buttons that keep its
// columns from being identical on every row.
//
// One reply (beG.getSurvivalStatus) drives all of it, over the main-server connection, with no
// survival session anywhere: that is the whole point of the panel, so nothing here may ever
// reach for `status.survival`.

import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { applyTicketBalance, readBookingStatus, type BookingStatus } from '../survival';
import type { ActionDeps, Profile } from './types';

/**
 * Free country codes for «Змінити прапор». Every one of them is in main-server's
 * `api.beGenius.flags.free` (lib/flags.js) — checked against that list, not picked by taste,
 * because beG.changeFlag validates the code against `flags.all` and answers "Wrong flag name"
 * for anything else. Premium flags are deliberately absent: they are in `flags.all` but also
 * need `player.boughtFlags`, so a mock player only ever gets "not bought" out of them.
 */
const TEST_FLAGS = ['UA', 'PL', 'DE', 'FR', 'IT', 'ES', 'JP', 'BR', 'US', 'GB', 'SE', 'TR'];

/**
 * TEST_FLAGS rotated from a random start: the first code is the one we want, the rest are the
 * retries. changeFlag rejects the flag ALREADY selected ("Already selected") and the client
 * cannot know which one that is — the roster carries the flag stamped at REGISTRATION, not the
 * live one — so the answer is to have somewhere to go next instead of guessing.
 */
const flagsToTry = (): string[] => {
  const start = Math.floor(Math.random() * TEST_FLAGS.length);
  return TEST_FLAGS.map((_, i) => TEST_FLAGS[(start + i) % TEST_FLAGS.length]);
};

export interface Booking {
  status: BookingStatus | null;
  /** re-read it without a run() around it — for callers already inside one */
  fetchBooking: () => Promise<any>;
  /** the dialog's own refresh button */
  refresh: () => Promise<unknown>;
  mockClan: () => Promise<unknown>;
  changeFlag: () => Promise<unknown>;
  forget: () => void;
}

export function useBooking(
  deps: ActionDeps,
  setProfile: Dispatch<SetStateAction<Profile | null>>,
): Booking {
  const { gw, runInDialog, setState } = deps;
  // Kept OUT of SurvivalState: this is a polled snapshot of main-server's booking screen, not
  // the live match the survival events build up. Mixing them would let a stale poll overwrite
  // a roster that broadcasts keep current.
  const [status, setStatus] = useState<BookingStatus | null>(null);

  /**
   * The booking / registration screen, and the only call that can draw it.
   *
   * It lives in the main menu hours before the match, when the player has no survival
   * connection at all (a connect token lives ten minutes), so main-server's
   * beG.getSurvivalStatus is the ONLY source of the sign-up list — that is why the roster now
   * travels with it. Nothing here touches `status.survival` on purpose: the whole point of the
   * panel is that it works for a player who has never joined and is connected to nothing but
   * main-server.
   *
   * Not wrapped in run() itself so «Створити клан» can refresh without nesting two run()s —
   * the inner finally would clear `busy` while the outer call is still going.
   */
  const fetchBooking = useCallback(async () => {
    const res = await gw().call<any>('main', 'beG', 'getSurvivalStatus', []);
    const next = readBookingStatus(res);
    setStatus(next);
    // getStatus claims the free daily ticket on its way, exactly like beG.getTickets, so its
    // balance can be a real movement — and it goes through applyTicketBalance for the same
    // reason the two top-ups do.
    setState((s) => applyTicketBalance(s, next.tickets, { reason: 'status' }));
    return res;
  }, [gw, setState]);

  // Lives in the booking dialog now (its refresh button), so its failure has to show up there.
  const refresh = () => runInDialog('beG.getSurvivalStatus', fetchBooking);

  /**
   * Testbed convenience, not a product feature: fresh mock accounts are clanless, so without
   * this the roster's clan column is empty on every row and the new field goes untested.
   * The clan NAME is copied into the roster row when RegisterPlayer runs and is never
   * refreshed afterwards, so a clan created after «Зайти в Survival» only shows up in the
   * NEXT lobby — hence the hint next to the button.
   */
  const mockClan = () =>
    runInDialog('mockClan (тестовий клан)', async () => {
      const clan = await gw().mockClan();
      await fetchBooking();
      return clan;
    });

  /**
   * Testbed convenience, the twin of «Створити клан»: every mock player signs up from
   * localhost, geoip cannot place that IP and main-server stamps them all 'UN'
   * (lib/utils.js), so without this the whole roster wears one identical flag and the flag
   * artwork goes untested.
   *
   * beG.changeFlag is the REAL client RPC — the one the profile screen calls — so this is not a
   * back door: it only accepts free country codes (see TEST_FLAGS) and never a premium flag,
   * which would need `boughtFlags` and answer "not bought". Drawing the flag the player already
   * wears is answered with "Already selected"; that is a miss, not a failure, so it retries with
   * the next code instead of shouting at the tester.
   */
  const changeFlag = () =>
    runInDialog('beG.changeFlag (тестовий прапор)', async () => {
      let denied: Error | undefined;
      for (const code of flagsToTry()) {
        try {
          const res = await gw().call('main', 'beG', 'changeFlag', [code]);
          // The header's flag reads the live profile, so it is the one place the change shows
          // up immediately; the roster right under this button cannot, for the reason on the
          // next line.
          setProfile((p) => ({ ...(p ?? {}), flag: code }));
          // The flag is copied into the roster by RegisterPlayer, exactly like the clan, so this
          // refresh only redraws the OTHER fields — the new flag shows up in the NEXT lobby.
          await fetchBooking();
          return { flag: code, res };
        } catch (err) {
          if (!/already selected/i.test((err as Error).message)) throw err;
          denied = err as Error;
        }
      }
      throw denied ?? new Error('не вдалося змінити прапор');
    });

  /**
   * The booking snapshot belongs to the PREVIOUS account — above all its «зареєстрований»
   * pill, which would otherwise claim a brand-new player has already paid for a seat.
   */
  const forget = () => setStatus(null);

  return { status, fetchBooking, refresh, mockClan, changeFlag, forget };
}
