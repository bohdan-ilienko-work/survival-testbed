// AUTOSUBMIT — the answer goes the moment it is complete, and exactly once per round.
//
// The Unity client submits without a button press, so the testbed does too: a stand whose
// gestures differ from the client's stops being evidence about the client. What "complete"
// means is decided per mode by the panel (see QuestionView), because it is a property of how
// each answer is COMPOSED — a MAP pin is whole the instant it is dropped, a NUMBER is not whole
// until the value is committed, a CHRONO pairing is not whole until every event holds a year.
//
// This module owns only the part that is the same for all four: the latch.

import { useRef, useState } from 'react';

export interface AnswerSubmit {
  /** the one door every answer goes through — the first call of a round wins, the rest are dropped */
  send: (answer: unknown) => void;
  /** this round's answer has already left this tab */
  sent: boolean;
}

/**
 * @param roundKey what identifies the round on screen. It must change when the QUESTION changes
 * and not merely when the round number does: a tiebreak's decider carries the SAME round number
 * as the round it is deciding, and a latch that keyed off the number alone would silently
 * swallow the decider's answer.
 * @param disabled the panel is not accepting answers (eliminated, watching, outside the
 * tiebreak's cohort, already answered) — an autosubmit must respect it exactly as a click does.
 *
 * THE LATCH IS KEYED, NOT A FLAG, and that is the whole design: `sent` is derived by comparing
 * the key, so a round that ends while a submit is still in flight resets it by simply being a
 * different round. There is nothing to time out, nothing a rejected promise can leave standing,
 * and no cleanup that a component unmounting mid-request could skip.
 */
export function useAnswerSubmit(
  roundKey: string,
  disabled: boolean,
  onAnswer: (a: unknown) => void,
): AnswerSubmit {
  // The ref is the guard and the state is only what re-renders. Two of them because several
  // gestures can land in ONE tick — a blur immediately followed by the button's click — and
  // state set in the first has not been applied when the second reads it.
  const latch = useRef<string | null>(null);
  const [sentKey, setSentKey] = useState<string | null>(null);

  const send = (answer: unknown) => {
    if (disabled || latch.current === roundKey) return;
    latch.current = roundKey;
    setSentKey(roundKey);
    onAnswer(answer);
  };

  return { send, sent: sentKey === roundKey };
}
