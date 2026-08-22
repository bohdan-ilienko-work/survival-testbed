// «Старт матчу о 22:40 · через 12 хв» — in the header, where it is readable without a click.
//
// The time was already on two screens, and both of them are places you have to GO to: the
// booking dialog has to be opened, and the lobby panel only exists once you have joined. The
// question «коли наступний матч» is asked before either — usually by somebody who has just
// opened the page and wants to know whether to wait around.

import { untilText } from './timeWords';

export function NextMatch({ startAt, now }: { startAt?: string; now: number }) {
  const at = startAt ? Date.parse(startAt) : NaN;
  if (!Number.isFinite(at)) {
    return (
      <span className="nextmatch none" title="beG.getSurvivalStatus не дав часу старту">
        старт матчу: —
      </span>
    );
  }

  const left = at - now;
  const when = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const day = new Date(at).toLocaleDateString();
  const today = new Date(now).toLocaleDateString();

  return (
    // `hot` under a minute: the same threshold the round timers use to mean "act now".
    <span className={`nextmatch${left <= 60_000 ? ' hot' : ''}`} title={new Date(at).toLocaleString()}>
      старт матчу: <b>{when}</b>
      {/* The day only when it is not today's — «22:40» is enough information nine times in ten,
          and a date beside every hour is what makes a header stop being scannable. */}
      {day !== today && <span className="day"> {day}</span>}
      <span className="until"> · {untilText(left)}</span>
    </span>
  );
}
