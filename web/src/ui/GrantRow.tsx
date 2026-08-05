// The adminApi.grantToPlayer shortcut — the one block on this screen that is NOT a client RPC.
//
// Separated from the rest of the character tab precisely because of that: it is an admin door the
// testbed opens to get past a refusal, and a reader looking at a test result has to be able to see
// at a glance which calls were the game's and which were this. The warn-coloured frame around it
// says the same thing in the stylesheet (css/ce-grants.css).

import type { ReactElement } from 'react';
import type { Grant, Run } from './editorModel';
import { GRANT_EXPERIENCE, GRANT_GEMS } from './serverRefusals';
import { PREMIUM_FLAGS } from '../gameAssets';

export interface GrantRowProps {
  /** a call is in flight — every button waits it out */
  locked: boolean;
  /** false without a playerId; grantToPlayer answers «playerId is required» */
  canGrant: boolean;
  /** the character the gallery is on, i.e. the one «Видати цього персонажа» unlocks */
  selected: number;
  run: Run;
  onGrant: Grant;
}

export function GrantRow({
  locked,
  canGrant,
  selected,
  run,
  onGrant,
}: GrantRowProps): ReactElement {
  return (
    <div className="ce-grant">
      <h4 className="ui-h">
        Тестовий шорткат · adminApi.grantToPlayer
        <span>не клієнтський RPC: гравець нічого не «купує», це видача з адмінки</span>
      </h4>
      <div className="ui-actions">
        <button
          type="button"
          disabled={locked || !canGrant}
          onClick={() =>
            run(`видано ${GRANT_EXPERIENCE} досвіду`, () => onGrant({ experience: GRANT_EXPERIENCE }))
          }
        >
          +{GRANT_EXPERIENCE} досвіду
        </button>
        <button
          type="button"
          disabled={locked || !canGrant}
          onClick={() => run(`видано ${GRANT_GEMS} кристалів`, () => onGrant({ gems: GRANT_GEMS }))}
        >
          +{GRANT_GEMS} кристалів
        </button>
        <button
          type="button"
          disabled={locked || !canGrant}
          onClick={() =>
            run(`видано персонажа #${selected}`, () => onGrant({ characters: [selected] }))
          }
        >
          Видати цього персонажа
        </button>
        <button
          type="button"
          disabled={locked || !canGrant}
          onClick={() => run('видано преміум-прапори', () => onGrant({ flags: PREMIUM_FLAGS }))}
        >
          Видати всі преміум-прапори
        </button>
      </div>
      {!canGrant && (
        <p className="ui-sub ce-gap">
          playerId невідомий — grantToPlayer без нього відповідає «playerId is required».
          Спершу увійди в main-server.
        </p>
      )}
    </div>
  );
}
