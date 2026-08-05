// CHRONO — how the matching round is drawn. The rules it obeys are in useChronoPairing.

import { useChronoPairing } from './useChronoPairing';

/** A fact can be a whole sentence; a tooltip that quotes one has to stay one line. */
const clip = (text: string, max = 48) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/**
 * CHRONO — the MATCHING round: pair every event with the year it happened.
 *
 * The wire is `{ type: 'chrono', pairs }`, where pairs[i] is the index into `years` chosen for
 * events[i] and -1 means "not paired". The server validates that (fight-server facts.ts,
 * isValidFactsAnswer): same length as the events, every value in [-1, years.length), and NO
 * duplicate non-(-1) value — one year belongs to exactly one event. So the UI is built so a
 * duplicate cannot even be expressed:
 *
 *  - dropping a year another event already holds SWAPS the two rows (that other event takes
 *    whatever this one held, possibly nothing). A steal would silently unpair a row further up
 *    the list, and refusing the drop would force clear-then-assign for what is nearly always
 *    meant as "these two are the wrong way round";
 *  - dragging a year back into «вільні роки» un-pairs it, because -1 is a legal value and a
 *    testbed has to be able to send it.
 *
 * DRAG IS NOT THE ONLY PATH, deliberately: the per-row year strip stays clickable and behaves
 * exactly as it did before dragging existed. HTML5 drag-and-drop has no keyboard gesture at all
 * and is unreliable under touch emulation, and this panel is the one place a tester works
 * AGAINST A RUNNING ROUND DEADLINE — a gesture that does not take is a round lost, not an
 * inconvenience. So every year stays reachable with Tab + Enter on every row.
 */
export function ChronoPairing({
  events,
  years,
  pairs,
  disabled,
  onPairs,
  onAnswer,
}: {
  events: { id: number; text: string }[];
  years: number[];
  pairs: number[];
  disabled: boolean;
  onPairs: (pairs: number[]) => void;
  onAnswer: (a: unknown) => void;
}) {
  const { yearOf, holderOf, assign, drag, over, dragProps, dropProps, paired, free } =
    useChronoPairing({ events, years, pairs, disabled, onPairs });

  // `years` missing — an older server, or a value the wire guard refused — is not a crash: the
  // events still render so the tester sees what DID arrive, there is just nothing to pair with.
  const noYears = years.length === 0;

  return (
    <div className="chrono">
      <p className="hint">
        {noYears
          ? 'Сервер не надіслав масив years — пару скласти нема з чого.'
          : 'Перетягни рік на подію. Один рік — тільки для однієї події: кидок на зайняту подію' +
            ' міняє їх місцями, а перетягування року назад у «вільні роки» знімає пару.'}
      </p>
      {!noYears && (
        <p className="hint small">
          Клік по року в рядку робить те саме — саме він працює з клавіатури (Tab + Enter) і на
          тачскріні, де перетягування ненадійне.
        </p>
      )}

      {!noYears && (
        <div className={`pair-pool${over === 'pool' ? ' over' : ''}`} {...dropProps('pool')}>
          <span className="pair-pool-label">вільні роки</span>
          {free.length === 0 ? (
            <span className="pair-pool-empty">
              усі роки розібрано — перетягни рік сюди, щоб зняти пару
            </span>
          ) : (
            free.map((yi) => (
              // A span, not a button: a click here has no row to aim at, so there is nothing for
              // it to do. Nothing is lost — every year is also a real button in every row below,
              // which is where the keyboard path lives.
              <span
                key={yi}
                // `off`, not :disabled — a span never matches that pseudo-class, so once the
                // round closes these chips would keep hovering and reading as live while
                // dragProps has already stopped them being draggable.
                className={`pair-year free${disabled ? ' off' : ''}${
                  drag?.key === `pool:${yi}` ? ' dragging' : ''
                }`}
                title={disabled ? undefined : 'вільний рік — перетягни його на подію'}
                {...dragProps(yi, `pool:${yi}`)}
              >
                {years[yi]}
              </span>
            ))
          )}
        </div>
      )}

      {events.map((ev, i) => {
        const mine = yearOf(i);
        return (
          <div className={`pair-row${over === i ? ' over' : ''}`} key={ev.id} {...dropProps(i)}>
            <div className="pair-event">
              {/* The row's own year is a chip too, so it can be dragged straight onto another row
                  (a swap) or back into the pool (un-pair) without hunting for it in a strip. */}
              <span
                className={`pair-slot${mine === -1 ? '' : ' set'}${
                  drag?.key === `slot:${i}` ? ' dragging' : ''
                }`}
                title={
                  mine === -1
                    ? undefined
                    : 'перетягни на іншу подію або у «вільні роки», щоб зняти пару'
                }
                {...(mine === -1 || disabled ? {} : dragProps(mine, `slot:${i}`))}
              >
                {mine === -1 ? '—' : years[mine]}
              </span>
              <span className="pair-text">{ev.text}</span>
            </div>
            {!noYears && (
              <div className="pair-years">
                {years.map((year, yi) => {
                  const holder = holderOf(yi);
                  const isMine = holder === i;
                  return (
                    <button
                      key={yi}
                      className={`pair-year${isMine ? ' on' : holder >= 0 ? ' taken' : ''}${
                        drag?.key === `${i}:${yi}` ? ' dragging' : ''
                      }`}
                      // Only the round being closed kills a chip. A chip taken by another event
                      // stays clickable ON PURPOSE — that click IS the swap.
                      disabled={disabled}
                      // The rows carry no visible numbers, so a taken chip names the event
                      // holding it by its TEXT — «зайнятий подією 2» would be unresolvable.
                      title={
                        isMine
                          ? 'зняти пару'
                          : holder >= 0
                            ? `зайнятий: «${clip(events[holder].text)}» — клік поміняє їх місцями`
                            : undefined
                      }
                      onClick={() => assign(i, yi)}
                      {...dragProps(yi, `${i}:${yi}`)}
                    >
                      {year}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* An EXPLICIT submit, unlike the sequence UI this replaced (which fired the moment every
          event had been clicked). A pairing stays editable to the last second — one drop can
          swap two rows — so the first instant every slot happens to be full is not the instant
          the tester means to send, and the server takes one answer per round. Left enabled while
          the pairing is incomplete because -1 is a legal value and that path needs testing too. */}
      <button
        className="primary pair-submit"
        disabled={disabled || noYears}
        onClick={() => onAnswer({ type: 'chrono', pairs: events.map((_, i) => yearOf(i)) })}
      >
        Відповісти — {paired} з {events.length}
      </button>
      {!noYears && paired < events.length && (
        <p className="hint">Непаровані події підуть як -1 — сервер таку відповідь приймає.</p>
      )}
    </div>
  );
}
