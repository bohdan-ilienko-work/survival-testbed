// 3-4. Питання / відповідь — the one panel a round is actually played on.
//
// Four wire shapes behind one frame (QUESTION / MAP / CHRONO / NUMBER); the draft answer for all
// of them lives here, because they share the one rule that matters: a draft is cleared when the
// question changes, and never carried into the next round.
//
// AUTOSUBMIT lives here too — the LATCH is in useAnswerSubmit, but what counts as a COMPLETE
// answer is a property of how each shape is composed, so it can only be decided next to the
// markup that composes it. Per mode, and the reason in one line each:
//
//   QUESTION — the click IS the answer; there is no draft to be complete or incomplete.
//   MAP      — a pin is whole the instant it is dropped. There is nothing else to fill in, so
//              waiting for a button would only add a step; the pin cannot be moved afterwards.
//   NUMBER   — digits arrive one at a time, so "the box is not empty" is not completeness: 12
//              is a prefix of 1234. It goes on a COMMIT — Enter, or the field losing focus.
//   CHRONO   — complete means every event holds a year. -1 is legal, so the button below stays
//              as the way to send a deliberately partial pairing.

import { useEffect, useState } from 'react';
import { MapPicker } from '../MapPicker';
import type { SurvivalState } from '../survival';
import { ChronoPairing } from './ChronoPairing';
import { useAnswerSubmit } from './useAnswerSubmit';

export function QuestionView({
  state,
  disabled,
  onAnswer,
}: {
  state: SurvivalState;
  disabled: boolean;
  onAnswer: (a: unknown) => void;
}) {
  const q = state.question!;
  const events = q.events ?? [];
  const [num, setNum] = useState('');
  /**
   * CHRONO is a MATCHING round: pairs[i] = index into q.years for events[i], -1 = not paired.
   * Kept here rather than inside ChronoPairing so it is cleared by the same effect as every
   * other draft answer — a pairing left over from the previous round would be submitted
   * against a completely different set of facts.
   */
  const [pairs, setPairs] = useState<number[]>([]);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);

  /**
   * What identifies the question on screen — the drafts' reset key AND the autosubmit latch's.
   *
   * The round NUMBER alone is not enough: a tiebreak's decider carries the same round number as
   * the round it decides, so a key built from it would leave the previous question's draft in
   * the boxes and let its latch swallow the decider's answer. `deadline` is in it one step
   * further along, because two deciders in a row can both arrive with no `id` at all.
   */
  const roundKey = `${state.round}|${q.mode}|${q.id ?? ''}|${state.deadline ?? ''}`;
  const { send, sent } = useAnswerSubmit(roundKey, disabled, onAnswer);

  useEffect(() => {
    setNum('');
    setPairs([]);
    setPin(null);
  }, [roundKey]);

  /** NUMBER's commit: an empty or unreadable box is not an answer, it is an unfinished one. */
  const commitNumber = () => {
    const value = Number(num);
    if (num.trim() !== '' && Number.isFinite(value)) send({ type: 'number', value });
  };

  return (
    <div className="panel question">
      {disabled && (
        <div className="badge">
          {state.myAnswer !== undefined || sent ? 'відповідь надіслано' : 'глядач'}
        </div>
      )}
      <h2>{q.text ?? `Питання (${q.mode})`}</h2>

      {q.mode === 'QUESTION' && (
        <div className="options">
          {(q.options ?? []).map((opt) => (
            <button
              key={opt.id}
              disabled={disabled}
              onClick={() => send({ type: 'selection', optionId: opt.id })}
            >
              {opt.text}
            </button>
          ))}
        </div>
      )}

      {q.mode === 'MAP' && (
        <div className="map">
          <p className="hint">
            Клік по карті — це і є відповідь: мітка йде на сервер одразу, пересунути її вже
            не можна.
          </p>
          <MapPicker
            pick={pin}
            disabled={disabled}
            onPick={(p) => {
              setPin(p);
              send({ type: 'map', lat: p.lat, lng: p.lng });
            }}
          />
          {pin && (
            <p className="answered">
              твоя мітка: {pin.lat.toFixed(3)}, {pin.lng.toFixed(3)}
            </p>
          )}
        </div>
      )}

      {q.mode === 'CHRONO' && (
        <ChronoPairing
          events={events}
          years={q.years ?? []}
          pairs={pairs}
          disabled={disabled}
          onPairs={(next) => {
            setPairs(next);
            // AUTOSUBMIT: complete = every event holds a year. Read off `next` and not off the
            // state above, which setPairs has not applied yet in this tick.
            if (next.length === events.length && next.every((yi) => yi >= 0)) {
              send({ type: 'chrono', pairs: next });
            }
          }}
          onAnswer={send}
        />
      )}

      {q.mode === 'NUMBER' && (
        <div className="number">
          <input
            value={num}
            disabled={disabled}
            onChange={(e) => setNum(e.target.value)}
            // The two commit gestures. Deliberately NOT a debounce on typing: a tester who
            // pauses between digits would have the prefix sent, and a round takes one answer.
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitNumber();
            }}
            onBlur={commitNumber}
            placeholder="число · Enter надсилає"
            type="number"
          />
          {/* The escape hatch, and the gesture a mouse-only tester still has. It sends the same
              value the commits do, and the latch makes a blur immediately followed by this
              click one answer rather than two. */}
          <button disabled={disabled || num === ''} onClick={commitNumber}>
            Відповісти
          </button>
        </div>
      )}

      <p className="answered">відповіли: {state.answeredCount}</p>
    </div>
  );
}
