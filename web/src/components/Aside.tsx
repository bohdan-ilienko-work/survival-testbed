// The right-hand column: who is in the lobby, what the server said, and what we did about it.
//
// The three lists are deliberately raw and deliberately together — a testbed's real output is
// the ability to line an event up against the roster it changed and the call that caused it.

import type { ServerEvent } from '../gateway';
import type { LobbyPlayer } from '../survival';
import { CharacterImg, FlagImg } from './PlayerArt';
import { humansBotsLabel } from './peopleWords';

export function Aside({
  players,
  alive,
  playerId,
  events,
  logs,
}: {
  players: LobbyPlayer[];
  alive: number;
  playerId?: string;
  events: ServerEvent[];
  logs: string[];
}) {
  return (
    <aside>
      {/* C2: bots are seeded from lobby open, so alive/total alone is a bot census — the
          humans/bots split is what tells a tester their second tab actually landed */}
      <h3>
        Гравці ({alive}/{players.length}
        {players.length > 0 && <> · {humansBotsLabel(players.length, players)}</>})
      </h3>
      {/* Same artwork components as the booking roster — the two lists show the same
          players and must not drift into two different looks. The 🤖/🧑 emoji this replaced
          said nothing the row does not now say better: a bot has no flag, no clan and the
          «бот» tag. */}
      <ul className="players">
        {players.map((p) => (
          <li key={p.playerId} className={p.eliminated ? 'out' : ''}>
            <FlagImg flag={p.flag} />
            <CharacterImg id={p.character} />
            <span className="nick" title={p.playerId}>
              {p.playerId === playerId ? 'Я' : p.name || String(p.playerId).slice(0, 12)}
            </span>
            <span className="tail">
              {p.clan && (
                <span className="clan" title="клан">
                  {p.clan}
                </span>
              )}
              {p.isBot && <span className="bot">бот</span>}
              {p.ready && !p.eliminated && <span className="ready" title="готовий">✓</span>}
              {p.eliminated && <em>вибув</em>}
            </span>
          </li>
        ))}
      </ul>

      <h3>Події сервера</h3>
      <ul className="events">
        {events.slice(0, 40).map((e, i) => (
          <li key={i}>
            <b>{e.name}</b>
            <span className="tgt">{e.target}</span>
            <code>{String(JSON.stringify(e.args)).slice(0, 110)}</code>
          </li>
        ))}
      </ul>

      <h3>Лог</h3>
      <ul className="logs">
        {logs.slice(0, 40).map((l, i) => <li key={i}>{l}</li>)}
      </ul>
    </aside>
  );
}
