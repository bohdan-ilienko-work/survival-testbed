// 1а. Реєстрація — the roster LIST, one row per registered player.
//
// Split out of BookingBody when the C4 «матч уже йде» branch pushed that file over the 200-line
// budget: the list is the half that never branches on the reply's flags, so it moved whole.

import type { LobbyPlayer } from '../survival';
import { CharacterImg, FlagImg } from './PlayerArt';

export function BookingRoster({ roster, me }: { roster: LobbyPlayer[]; me?: string }) {
  if (roster.length === 0) return <p className="hint">Ще ніхто не зареєструвався.</p>;
  return (
    <div className="rosterbox">
      <div className="rhead">
        <span className="num">№</span>
        <span>прап.</span>
        <span>перс.</span>
        <span>гравець</span>
        <span className="tail">клан</span>
      </div>
      <ol className="roster">
        {roster.map((entry, index) => (
          <RosterRow
            // Registration order is the contract, so duplicates must NOT be collapsed:
            // the index is what keeps the key unique even if the server ever repeats a
            // playerId, and the row number below comes from that same index.
            key={`${index}:${entry?.playerId ?? ''}`}
            entry={entry}
            index={index}
            me={me}
          />
        ))}
      </ol>
    </div>
  );
}

/**
 * One booking row: number, flag, character, nickname, clan.
 * Each field is re-checked here rather than trusted: the roster is read straight off the wire
 * (see readBookingStatus, which only guarantees it is an array), so a row that is not an object
 * at all must render as a dash instead of taking the whole panel down with it.
 */
function RosterRow({ entry, index, me }: { entry: LobbyPlayer; index: number; me?: string }) {
  const row: LobbyPlayer = entry && typeof entry === 'object' ? entry : ({} as LobbyPlayer);
  const id = typeof row.playerId === 'string' ? row.playerId : '';
  const name = typeof row.name === 'string' ? row.name.trim() : '';
  // '' is the contracted value for "no clan" (bots always), so an empty column is a real answer
  const clan = typeof row.clan === 'string' ? row.clan.trim() : '';
  const mine = !!me && id === me;

  return (
    <li className={`${mine ? 'me' : ''} ${row.eliminated ? 'out' : ''}`}>
      {/* 1..N from the ARRAY INDEX: `slot` is null for the whole of BOOKING */}
      <span className="num">{index + 1}</span>
      {/* the same two components the aside roster uses — see PlayerArt */}
      <FlagImg flag={row.flag} />
      <CharacterImg id={row.character} />
      <span className="nick" title={id}>
        {name || (id ? id.slice(0, 12) : '—')}
      </span>
      <span className="tail">
        {clan && (
          <span className="clan" title="клан">
            {clan}
          </span>
        )}
        {row.isBot && <span className="bot">бот</span>}
        {mine && <span className="mine">я</span>}
      </span>
    </li>
  );
}
