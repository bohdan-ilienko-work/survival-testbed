// The wallet: the two manual top-ups, and the one read the client makes on its own.
//
// Both top-ups go straight to main-server, so survival-server never learns of them and pushes no
// 'ticketsUpdated'. They must still go through applyTicketBalance: assigning `tickets` raw leaves
// buybackAffordable on its old `false`, which kept the priced «Викупитись» button dead for the
// rest of the window right next to a chip showing enough tickets to pay for it.

import { useEffect } from 'react';
import { applyTicketBalance, type Step } from '../survival';
import type { ActionDeps } from './types';

export interface Tickets {
  grantTickets: () => Promise<unknown>;
  refreshTickets: () => Promise<unknown>;
}

/** @param step the client's own step — the payout re-read below is armed by it and nothing else */
export function useTickets(deps: ActionDeps, step: Step): Tickets {
  const { gw, run, pushLog, setState } = deps;

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
      return res;
    }).catch(() => undefined);

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

  return { grantTickets, refreshTickets };
}
