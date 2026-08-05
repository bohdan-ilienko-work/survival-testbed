// The stage: whatever the match is doing right now, and nothing else.
//
// One panel per step, in flowchart order. Everything you LOOK UP or CHANGE about yourself is a
// dialog instead — the stage is left to the things that are the match itself, because a running
// round is a ticking deadline and must never be behind a backdrop.

import { useMemo } from 'react';
import { stepLabel, type LobbyPlayer, type SurvivalState } from '../survival';
import { BuyBackPanel } from './BuyBackPanel';
import { ClientStateTable } from './ClientStateTable';
import { FinishView } from './FinishView';
import { QuestionView } from './QuestionView';
import { ResultsView } from './ResultsView';

export interface StageProps {
  state: SurvivalState;
  now: number;
  busy: boolean;
  playerId?: string;
  /** the survival socket dropped — the match on screen is a ghost */
  survivalLost: boolean;
  players: LobbyPlayer[];
  alive: number;
  onRestart: () => void;
  onAnswer: (answer: unknown) => void;
  onBuyBack: () => void;
  onQuote: () => void;
}

export function Stage({
  state,
  now,
  busy,
  playerId,
  survivalLost,
  players,
  alive,
  onRestart,
  onAnswer,
  onBuyBack,
  onQuote,
}: StageProps) {
  const secondsLeft = useMemo(() => {
    if (!state.deadline) return null;
    return Math.max(0, Math.round((state.deadline - now) / 1000));
  }, [state.deadline, now]);

  return (
    <div className="stage">
      <div className="stepbar">
        <b>{stepLabel[state.step]}</b>
        {state.round > 0 && <span>раунд {state.round}</span>}
        {state.mode && <span className="mode">{state.mode}</span>}
        {secondsLeft !== null && (
          <span className={`timer ${secondsLeft <= 5 ? 'hot' : ''}`}>{secondsLeft}s</span>
        )}
      </div>

      {survivalLost && state.step !== 'idle' && (
        <div className="error stale">
          <b>Звʼязок із survival-server втрачено.</b> Матч на екрані вже не існує —
          стан бою тримається лише в памʼяті сервера й гине при перезапуску.
          <button className="primary" onClick={onRestart} disabled={busy}>
            Зайти заново
          </button>
        </div>
      )}

      {state.lastError && <div className="error">{state.lastError}</div>}

      {state.step === 'idle' && (
        <p className="hint">Натисни «Підключити сервери» → «Мок-юзер» → «Зайти в Survival».</p>
      )}

      {state.step === 'lobby' && (
        <div className="panel">
          <h2>Лобі {state.lobbyId ? String(state.lobbyId).slice(0, 8) : ''}</h2>
          <p>стан: <b>{state.lobbyState ?? '—'}</b></p>
          {state.lobbyState === 'ONBOARDING' && state.onboardingEndsAt ? (
            <>
              <p className="countdown">
                старт через {Math.max(0, Math.ceil((state.onboardingEndsAt - now) / 1000))} с
              </p>
              <p className="hint">
                Встигни відкрити ще вкладку й зайти там — потрапите в це саме лоббі.
                Коли час вийде, вільні місця доберуться ботами.
              </p>
            </>
          ) : (
            state.scheduledStartAt && (
              <p>старт: {new Date(state.scheduledStartAt).toLocaleString()}</p>
            )
          )}
          <p>гравців у лоббі: <b>{players.length || '—'}</b></p>
        </div>
      )}

      {state.step === 'starting' && (
        <div className="panel"><h2>Матч стартує…</h2></div>
      )}

      {(state.step === 'question' || state.step === 'spectator') &&
        (state.question ? (
          <QuestionView
            state={state}
            disabled={state.step === 'spectator' || state.myAnswer !== undefined}
            onAnswer={onAnswer}
          />
        ) : (
          <div className="panel">
            <h2>{state.step === 'spectator' ? 'Ти вибув — дивишся' : 'Раунд іде'}</h2>
            <p className="hint">Питання ще не прийшло від сервера.</p>
          </div>
        ))}

      {state.step === 'results' && <ResultsView state={state} me={playerId} />}

      {state.step === 'buyback' && (
        <BuyBackPanel
          state={state}
          now={now}
          busy={busy}
          onBuyBack={onBuyBack}
          onQuote={onQuote}
        />
      )}

      {state.step === 'finished' && (
        <FinishView state={state} me={playerId} busy={busy} onRestart={onRestart} />
      )}
      {/* The booking screen used to sit here, permanently, under the match panels. It is a
          MAIN-MENU popup — it exists hours before there is a step or a survival socket — so
          it now opens as a dialog («Хто зареєстрований»), and the stage is left to the
          things that are the match itself. */}

      <ClientStateTable state={state} alive={alive} total={players.length} />
    </div>
  );
}
