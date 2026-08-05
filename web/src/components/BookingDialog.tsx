// «Хто зареєстрований» — the booking list as a main-menu popup.
//
// The frame only: the header's «зареєстрований» pill, and the footer of testbed buttons that
// make the roster's columns differ from row to row. The list itself is BookingBody.

import { Modal } from '../ui/Modal';
import type { BookingStatus } from '../survival';
import { BookingBody } from './BookingBody';

export interface BookingDialogProps {
  open: boolean;
  onClose: () => void;
  status: BookingStatus | null;
  me?: string;
  now: number;
  busy: boolean;
  /** the last refusal raised by the buttons below */
  dialogError: string | null;
  onRefresh: () => void;
  onMockClan: () => void;
  onChangeFlag: () => void;
  onCharacter: () => void;
}

export function BookingDialog({
  open,
  onClose,
  status,
  me,
  now,
  busy,
  dialogError,
  onRefresh,
  onMockClan,
  onChangeFlag,
  onCharacter,
}: BookingDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      busy={busy}
      title="Реєстрація на матч"
      subtitle={
        status ? (
          <>
            <span
              className={`ui-chip ${
                status.registered === undefined ? '' : status.registered ? 'ok' : 'warn'
              }`}
            >
              {status.registered === undefined
                ? 'сервер не сказав'
                : status.registered
                  ? '✔ ти зареєстрований'
                  : '✖ ти не зареєстрований'}
            </span>{' '}
            beG.getSurvivalStatus · {new Date(status.fetchedAt).toLocaleTimeString()}
          </>
        ) : (
          'beG.getSurvivalStatus — той самий список, який головне меню показує задовго до матчу'
        )
      }
      footer={
        <>
          {/* The dialog's own failures live in the footer, next to the buttons that raised
              them and always in view — the body scrolls, and a refusal that scrolled away is
              a button that looks like it did nothing. */}
          {dialogError && <span className="spread ui-note bad">{dialogError}</span>}
          {/* Every one of these is gated on `me` exactly like its toolbar twin: before sign-in
              main-server's beG guard never calls back, so an ungated button buys the tester a
              20 s gateway timeout instead of an error. */}
          <button onClick={onRefresh} disabled={busy || !me}>Оновити список</button>
          <button onClick={onMockClan} disabled={busy || !me}>Створити клан</button>
          <button onClick={onChangeFlag} disabled={busy || !me}>Змінити прапор</button>
          <button onClick={onCharacter} disabled={busy || !me}>Персонаж…</button>
          <button className="primary" onClick={onClose} disabled={busy}>Закрити</button>
        </>
      }
    >
      <BookingBody status={status} me={me} now={now} />
    </Modal>
  );
}
