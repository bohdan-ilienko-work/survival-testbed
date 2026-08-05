// 3-4. Питання / відповідь — the one panel a round is actually played on.
//
// Four wire shapes behind one frame (QUESTION / MAP / CHRONO / NUMBER); the draft answer for all
// of them lives here, because they share the one rule that matters: a draft is cleared when the
// question changes, and never carried into the next round.

import { useEffect, useState } from 'react';
import { MapPicker } from '../MapPicker';
import type { SurvivalState } from '../survival';
import { ChronoPairing } from './ChronoPairing';

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
  const [num, setNum] = useState('');
  /**
   * CHRONO is a MATCHING round: pairs[i] = index into q.years for events[i], -1 = not paired.
   * Kept here rather than inside ChronoPairing so it is cleared by the same effect as every
   * other draft answer — a pairing left over from the previous round would be submitted
   * against a completely different set of facts.
   */
  const [pairs, setPairs] = useState<number[]>([]);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    setNum('');
    setPairs([]);
    setPin(null);
  }, [q.id, state.round]);

  return (
    <div className="panel question">
      {disabled && (
        <div className="badge">{state.myAnswer !== undefined ? 'відповідь надіслано' : 'глядач'}</div>
      )}
      <h2>{q.text ?? `Питання (${q.mode})`}</h2>

      {q.mode === 'QUESTION' && (
        <div className="options">
          {(q.options ?? []).map((opt) => (
            <button
              key={opt.id}
              disabled={disabled}
              onClick={() => onAnswer({ type: 'selection', optionId: opt.id })}
            >
              {opt.text}
            </button>
          ))}
        </div>
      )}

      {q.mode === 'MAP' && (
        <div className="map">
          <p className="hint">Клікни по карті — координати підуть на сервер.</p>
          <MapPicker
            pick={pin}
            disabled={disabled}
            onPick={(p) => {
              setPin(p);
              onAnswer({ type: 'map', lat: p.lat, lng: p.lng });
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
          events={q.events ?? []}
          years={q.years ?? []}
          pairs={pairs}
          disabled={disabled}
          onPairs={setPairs}
          onAnswer={onAnswer}
        />
      )}

      {q.mode === 'NUMBER' && (
        <div className="number">
          <input
            value={num}
            disabled={disabled}
            onChange={(e) => setNum(e.target.value)}
            placeholder="число"
            type="number"
          />
          <button
            disabled={disabled || num === ''}
            onClick={() => onAnswer({ type: 'number', value: Number(num) })}
          >
            Відповісти
          </button>
        </div>
      )}

      <p className="answered">відповіли: {state.answeredCount}</p>
    </div>
  );
}
