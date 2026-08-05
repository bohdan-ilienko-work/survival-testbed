// The page header: what this tab is connected to, who it is signed in as, and what it owns.
//
// Three unrelated readings side by side on purpose — they are the three things a tester checks
// before believing anything else on the screen.

import type { Target, TargetState } from '../gateway';
import { TARGETS } from '../hooks/useGateway';
import type { Profile } from '../hooks/types';
import { CharacterImg, FlagImg } from './PlayerArt';

export interface HeaderProps {
  gwOnline: boolean;
  status: Record<Target, TargetState>;
  /** the gateway session — {accountId, deviceId, playerId, tabId} */
  session: any;
  profile: Profile | null;
  tickets?: number;
  ticketsReason?: string;
  ticketsDelta?: number;
}

export function Header({
  gwOnline,
  status,
  session,
  profile,
  tickets,
  ticketsReason,
  ticketsDelta,
}: HeaderProps) {
  // The chip itself only shows a number; the tooltip says where that number came from,
  // which is the difference between "live" and "stale" while testing.
  const ticketsHint = ticketsReason
    ? `остання зміна: ${ticketsReason}${
        ticketsDelta === undefined ? '' : ` (${ticketsDelta > 0 ? '+' : ''}${ticketsDelta})`
      }`
    : 'оновлюється сервером (ticketsUpdated)';

  return (
    <header>
      <h1>Survival testbed</h1>
      <div className="pills">
        <span className={`pill ${gwOnline ? 'ok' : 'bad'}`}>gateway</span>
        {TARGETS.map((t) => (
          <span
            key={t}
            className={`pill ${status[t] === 'connected' ? 'ok' : status[t] === 'error' ? 'bad' : ''}`}
            title={t === 'main' ? 'акаунт, тікети, вхід у Survival' : 'лоббі, раунди, підрахунок'}
          >
            {t}
          </span>
        ))}
      </div>
      <div className="who">
        {session?.playerId ? (
          <>
            <b>вкладка #{session.tabId ?? '?'}</b>
            <code>{String(session.playerId).slice(0, 14)}</code>
            {/* The live look (beG.getContext), and the only place on screen that can show it:
                every roster row still carries the picture stamped in at registration, so this
                is the one thing that moves the moment the editor changes a character. */}
            {profile && (profile.character !== undefined || !!profile.flag) && (
              <span className="look" title="персонаж і прапор гравця зараз (beG.getContext)">
                {profile.character !== undefined && <CharacterImg id={profile.character} />}
                {!!profile.flag && <FlagImg flag={profile.flag} />}
              </span>
            )}
          </>
        ) : (
          <i>не залогінений</i>
        )}
        {/* live: the server pushes 'ticketsUpdated' on every balance change, so this
            no longer waits for the «Тікети» button to be clicked */}
        <span className="tickets" title={ticketsHint}>
          🎟 {tickets ?? '—'}
        </span>
      </div>
    </header>
  );
}
