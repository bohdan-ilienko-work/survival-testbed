// The watcher's headline panel: is a match running right now, who is in it, and when does the
// next one open.
//
// This is the answer to the whole feature. BOOKING and ONBOARDING are not degraded states here
// — they are the primary ones, because «нічого не йде, наступне лоббі о 17:00» is precisely the
// thing that used to be visible only in the server's log.

import type { LobbyPlayer, SpectatorFeed } from '../survival';
import { countHumans } from '../survival';
import { BookingRoster } from './BookingRoster';
import { humansBotsLabel } from './peopleWords';
import { untilText } from './timeWords';

/**
 * @param now the SERVER's clock — the caller has already added the snapshot's skew, so every
 * subtraction below is against the same instant the players are counting down to.
 */
export function SpectatorLobbyCard({ feed, now }: { feed: SpectatorFeed; now: number }) {
  const st = feed.state;
  const roster: LobbyPlayer[] = Array.isArray(st.players) ? st.players : [];

  // The server's own counts are the authority; the roster length is only the fallback for a
  // reply that did not carry them. `activePlayerCount` is what a spectator came to see: with
  // bots seeded from lobby open, «ще в грі» is the only number that tracks the eliminations.
  const alivePlayers = roster.filter((p) => !p.eliminated);
  const total = feed.playerCount ?? roster.length;
  const alive = feed.activePlayerCount ?? alivePlayers.length;
  const startsAt = st.scheduledStartAt ? Date.parse(st.scheduledStartAt) : NaN;

  // `step: 'idle'` is the reader's own verdict that the reply said `lobby: null`, and it is the
  // same fact useSpectator arms its re-poll on — keying the two off one field is what stops the
  // screen saying «матч не заплановано» while the timer thinks a lobby is already there.
  if (st.step === 'idle') {
    return (
      <div className="panel">
        <h2>Матч не заплановано</h2>
        <p className="deny">
          Сервер явно відповів <code>lobby: null</code> — жодного лоббі зараз не існує, тож і
          дивитись поки нема на що.
        </p>
        <p className="hint">
          Екран перепитує <code>survival.spectate</code> кожні 5 с і сам покаже лоббі, щойно воно
          відкриється. Місце глядача при цьому нікуди не дівається.
        </p>
      </div>
    );
  }

  return (
    <div className="panel booking">
      <h2>Лобі {st.lobbyId ? String(st.lobbyId).slice(0, 8) : '—'}</h2>

      <div className="top">
        <div className="count">
          {/* C2: bots sit in the roster from lobby open, so a bare total is a bot census */}
          <b>{alive}</b> <span>у грі з {total} — {humansBotsLabel(alive, alivePlayers)}</span>
        </div>
        <div className="meta">
          <span>стан: <b>{st.lobbyState ?? '—'}</b></span>
          {feed.fightState && <span>бій: <b>{feed.fightState}</b></span>}
          {st.round > 0 && <span>раунд: <b>{st.round}</b></span>}
          {feed.viewers !== undefined && <span>глядачів: <b>{feed.viewers}</b></span>}
        </div>
      </div>

      <p className="answered">
        зареєстровано {total} — {humansBotsLabel(total, roster)}
      </p>

      {/* ONBOARDING has the server's own absolute deadline; everything else has the scheduled
          start. Both are ABSOLUTE instants — a duration measured from the moment a payload was
          handled counts down to a different second in every tab that got it late. */}
      {st.lobbyState === 'ONBOARDING' && st.onboardingEndsAt !== undefined ? (
        <>
          <p className="countdown">
            старт через {Math.max(0, Math.ceil((st.onboardingEndsAt - now) / 1000))} с
          </p>
          <p className="hint">Онбординг іде — місця добираються ботами, матч ось-ось почнеться.</p>
        </>
      ) : (
        Number.isFinite(startsAt) && (
          <>
            <p>наступний старт: <b>{new Date(startsAt).toLocaleString()}</b></p>
            <p className="until">{untilText(startsAt - now)}</p>
          </>
        )
      )}

      {st.lobbyState === 'BOOKING' && (
        <p className="hint">
          Реєстрація відкрита, бій ще не почався. Список нижче наповнюється наживо — кожен
          <code> playerJoined</code> / <code>rosterUpdate</code> приходить і глядачеві.
        </p>
      )}

      {/* The same list the booking dialog draws, deliberately: one roster component means the
          pre-match list and the live one cannot drift into two different looks. Eliminated rows
          come back dimmed from its own `.out` class. */}
      <BookingRoster roster={roster} />

      {roster.length > 0 && countHumans(roster) === 0 && (
        <p className="hint small">
          Живих гравців у ростері немає — лоббі поки що з самих ботів.
        </p>
      )}
    </div>
  );
}
