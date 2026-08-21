// The wallet: the two manual top-ups, and the one read the client makes on its own.
//
// Both top-ups go straight to main-server, so survival-server never learns of them and pushes no
// 'ticketsUpdated'. They must still go through applyTicketBalance: assigning `tickets` raw leaves
// buybackAffordable on its old `false`, which kept the priced «Викупитись» button dead for the
// rest of the window right next to a chip showing enough tickets to pay for it.

import { useEffect, useState } from 'react';
import { applyTicketBalance, type Step } from '../survival';
import type { ActionDeps } from './types';

/** One buyable pack, exactly as the server describes it. Prices never live on this side. */
export interface TicketPack {
  id: number;
  tickets: number;
  gems: number;
}

export interface Tickets {
  grantTickets: () => Promise<unknown>;
  refreshTickets: () => Promise<unknown>;
  /** What `beG.getTickets` last offered, and the gem balance it came with. */
  packs: TicketPack[];
  gems?: number;
  buyTickets: (packId: number) => Promise<unknown>;
}

/** @param step the client's own step — the payout re-read below is armed by it and nothing else */
export function useTickets(deps: ActionDeps, step: Step): Tickets {
  const { gw, run, runInDialog, pushLog, setState } = deps;
  const [packs, setPacks] = useState<TicketPack[]>([]);
  const [gems, setGems] = useState<number | undefined>(undefined);

  /** The pack list rides on the ordinary balance read, so nothing needs a second round trip. */
  const readOffer = (res: any) => {
    const list = Array.isArray(res?.packs) ? res.packs : [];
    setPacks(
      list
        .filter((p: any) => p && typeof p === 'object')
        .map((p: any, index: number) => ({
          id: Number.isFinite(p.id) ? Number(p.id) : index,
          tickets: Number(p.tickets) || 0,
          gems: Number(p.gems) || 0,
        }))
        .filter((p: TicketPack) => p.tickets > 0 && p.gems > 0),
    );
    if (Number.isFinite(res?.gems)) setGems(Number(res.gems));
  };

  const grantTickets = () =>
    run('grant 50 tickets', async () => {
      const res: any = await gw().grantTickets(50);
      setState((s) => applyTicketBalance(s, res?.balance, { reason: 'grant' }));
      return res;
    }).catch(() => undefined);

  const refreshTickets = () =>
    run('beG.getTickets', async () => {
      const res: any = await gw().call('main', 'beG', 'getTickets', []);
      // beG.getTickets also grants the free daily ticket, so its reply can be a real movement
      setState((s) => applyTicketBalance(s, res?.tickets ?? res, { reason: 'refresh' }));
      readOffer(res);
      return res;
    }).catch(() => undefined);

  /**
   * The real purchase path: gems out through the shop, tickets in through the same wallet the
   * free daily uses. Its refusal belongs INSIDE the dialog — «не вистачає кристалів» is an
   * answer to what was just clicked, not a stage-level failure.
   */
  const buyTickets = (packId: number) =>
    runInDialog(`beG.buySurvivalTickets(${packId})`, async () => {
      const res: any = await gw().call('main', 'beG', 'buySurvivalTickets', [packId]);
      setState((s) => applyTicketBalance(s, res?.tickets, { reason: 'purchase' }));
      if (Number.isFinite(res?.gems)) setGems(Number(res.gems));
      pushLog(`куплено 🎟 ${res?.bought ?? '?'} за 💎 ${res?.spentGems ?? '?'}`);
      return res;
    });

  // After the final: survival-server only REPORTS the result (ProcessSurvivalResult) and
  // main-server pays in its own time, so a balance read at the moment of 'lobbyFinished' is
  // read BEFORE the payout lands. Ask again after a short pause — through the same
  // beG.getTickets path the «Тікети» button uses — and quietly: an automatic refresh that
  // misses is a log line, not an error to shout over the endgame screen.
  useEffect(() => {
    if (step !== 'finished') return;
    const t = setTimeout(async () => {
      try {
        const res: any = await gw().call('main', 'beG', 'getTickets', []);
        pushLog(`beG.getTickets (після виплати) → ${String(JSON.stringify(res)).slice(0, 120)}`);
        setState((s) => applyTicketBalance(s, res?.tickets ?? res, { reason: 'payout' }));
      } catch (err) {
        pushLog(`beG.getTickets (після виплати) ✗ ${(err as Error).message}`);
      }
    }, 2500);
    return () => clearTimeout(t);
    // The only thing here that ever MOVES is the step — the other three are identity-stable for
    // the life of the app. That is the point: re-arming on every state change would keep pushing
    // the payout read further into the future while events keep arriving.
  }, [step, gw, pushLog, setState]);

  return { grantTickets, refreshTickets, packs, gems, buyTickets };
}
