// What this lobby pays, for the field it holds right now.
//
// The prize pool is a function of how many people are in: 50 players pay 250 gems for first
// place, 10 players pay 50. So this is not a constant a screen can carry — the server computes
// it per lobby and the number MOVES as people register, which is exactly what makes it worth
// watching on a testbed.
//
// Equal consecutive rows are collapsed back into the bands the design draws («2-3»), because a
// table of ten identical rows says less than four bands do.

import type { RankReward } from '../survival';

type Band = { from: number; to: number; gems: number; tickets: number };

function toBands(rows: RankReward[]): Band[] {
  const bands: Band[] = [];
  rows.forEach((row, i) => {
    const gems = Number(row.gems) || 0;
    const tickets = Number(row.tickets) || 0;
    const last = bands[bands.length - 1];
    if (last && last.gems === gems && last.tickets === tickets) last.to = i + 1;
    else bands.push({ from: i + 1, to: i + 1, gems, tickets });
  });
  return bands;
}

export function RewardPreview({ rows, players }: { rows?: RankReward[]; players?: number }) {
  if (!rows || rows.length === 0) {
    return (
      <p className="hint small">
        Сервер не назвав таблицю нагород (<code>lobby.rewardTable</code>) — показувати нема чого.
      </p>
    );
  }

  const bands = toBands(rows);
  return (
    <div className="rewards-preview">
      <div className="rhead">
        <span>місце</span>
        <span className="tail">нагорода</span>
      </div>
      {bands.map((band) => (
        <div className="reward-row" key={band.from}>
          <span className="place">{band.from === band.to ? band.from : `${band.from}–${band.to}`}</span>
          <span className="tail">
            {band.gems > 0 && <b>💎 {band.gems}</b>}
            <b>🎟 {band.tickets}</b>
          </span>
        </div>
      ))}
      <p className="hint small">
        Для поточного поля{players === undefined ? '' : ` на ${players}`} — з кожним новим
        гравцем суми ростуть. Місця після {bands[bands.length - 1].to}-го не оплачуються.
      </p>
    </div>
  );
}
