// ─── 10. Фінал: підсумкова таблиця з нагородами ───────────────────────────────
// The drawing only — how the ranks in it are arrived at is buildFinishRows' business.

import type { RankReward, SurvivalState } from '../survival';
import { buildFinishRows, type FinishRow } from './finishRows';
import { CharacterImg, FlagImg } from './PlayerArt';

/**
 * 10. Фінал — the endgame leaderboard the game mockup draws: rank, flag + portrait + nickname,
 * then the payout. It reuses the booking roster's grid and artwork (.rosterbox / FlagImg /
 * CharacterImg) so the pre-match list and the final table keep one look.
 */
export function FinishView({
  state,
  me,
  busy,
  onRestart,
}: {
  state: SurvivalState;
  me?: string;
  busy: boolean;
  onRestart: () => void;
}) {
  const players = Array.isArray(state.players) ? state.players : [];
  const rows = buildFinishRows(players, state.rewards, state.winnerId);
  const anyApprox = rows.some((r) => r.approx);

  return (
    <div className="panel finish">
      <h2>{me && state.winnerId === me ? '🏆 Перемога!' : 'Матч завершено'}</h2>
      <p>
        переможець: <code>{state.winnerId ?? '—'}</code> · раундів:{' '}
        {state.totalRounds ?? state.round}
      </p>

      {state.rewards === undefined ? (
        // an old survival-server sends no rewards at all — that is "не знаю", not "нуль"
        <p className="hint">
          Нагороди: не знаю — сервер не прислав <code>rewards</code> (старий survival-server?).
        </p>
      ) : (
        state.rewards.length === 0 && (
          <p className="hint">
            Сервер відповів порожнім <code>rewards</code> — виплат у цьому матчі немає.
          </p>
        )
      )}

      {rows.length > 0 && (
        <div className="rosterbox">
          <div className="rhead">
            <span className="num">#</span>
            <span>прап.</span>
            <span>перс.</span>
            <span>гравець</span>
            <span className="tail">нагорода</span>
          </div>
          <ol className="roster">
            {rows.map((row, index) => (
              <FinishRowView
                // index keeps the key unique even if the server ever repeats a playerId
                key={`${index}:${row.playerId}`}
                row={row}
                table={state.rewardTable}
                mine={!!me && row.playerId === me}
                win={!!state.winnerId && row.playerId === state.winnerId}
              />
            ))}
          </ol>
        </div>
      )}

      <p className="hint small">
        Боти займають місця в рейтингу, але нагород не отримують — сервер платить лише людям.
        {anyApprox &&
          ' Ранги курсивом відновлено з порядку вибування: сервер шле ранг лише тим, кому платить.'}
      </p>
      {/* the payout is asynchronous — the delayed beG.getTickets effect in useTickets re-reads it */}
      <p className="hint small">Баланс 🎟 оновлюється після виплати на main-server.</p>

      <button className="primary" onClick={onRestart} disabled={busy}>
        Зіграти ще
      </button>
    </div>
  );
}

/**
 * One endgame row.
 *
 * Two different numbers can appear here and they must never be confused:
 *  - what the player was PAID (`row.gems` / `row.tickets`, straight off the payout rows);
 *  - what the RANK is worth (`table[rank - 1]`), which exists for every place, bots included.
 * A bot occupies a rank and is never paid, so its row shows the rank's value dimmed — the
 * information is real, the payment is not, and the two are drawn differently on purpose.
 */
function FinishRowView({
  row,
  table,
  mine,
  win,
}: {
  row: FinishRow;
  table?: RankReward[];
  mine: boolean;
  win: boolean;
}) {
  // Bots are never paid: a bot row carrying an actual payout is a server bug, and the raw event
  // log on the right is where that evidence belongs, not a cell that legitimises it.
  const paidGems = !row.isBot && row.gems > 0 ? row.gems : 0;
  const paidTickets = !row.isBot && row.tickets > 0 ? row.tickets : 0;
  // The rank's value, shown only when nothing was actually paid — otherwise the row would carry
  // the same number twice. `undefined` table = an older server that sends no table at all.
  const worth = row.rank !== undefined ? table?.[row.rank - 1] : undefined;
  const showWorth = paidGems === 0 && paidTickets === 0 && worth
    ? { gems: worth.gems, tickets: worth.tickets }
    : null;
  return (
    <li className={`${mine ? 'me' : ''} ${win ? 'win' : ''}`}>
      <span
        className={`num ${row.approx ? 'approx' : ''}`}
        title={
          row.approx
            ? 'ранг відновлено клієнтом з порядку вибування'
            : row.rank === undefined
              ? 'ранг невідомий'
              : 'фінальний ранг від сервера'
        }
      >
        {row.rank ?? '—'}
      </span>
      <FlagImg flag={row.flag} />
      <CharacterImg id={row.character} />
      <span className="nick" title={row.playerId}>
        {row.name || row.playerId.slice(0, 12)}
      </span>
      <span className="tail">
        {row.isBot && <span className="bot">бот</span>}
        {mine && <span className="mine">я</span>}
        {paidGems > 0 && <span className="reward gems">💎 {paidGems}</span>}
        {paidTickets > 0 && <span className="reward tix">🎟 {paidTickets}</span>}
        {showWorth && (showWorth.gems > 0 || showWorth.tickets > 0) && (
          <span
            className="reward worth"
            title={
              row.isBot
                ? 'скільки коштує це місце — боту не виплачується'
                : 'скільки коштує це місце — сервер виплати не надсилав'
            }
          >
            {showWorth.gems > 0 && `💎 ${showWorth.gems}`}
            {showWorth.gems > 0 && showWorth.tickets > 0 && ' '}
            {showWorth.tickets > 0 && `🎟 ${showWorth.tickets}`}
          </span>
        )}
      </span>
    </li>
  );
}
