// Buying survival tickets with gems.
//
// Entry costs a ticket, and until now the only ones a tester could get were the free daily and
// the «+50 🎟» dev grant — neither of which exercises the path a real player takes. This calls
// the same `beG.buySurvivalTickets` a client would.
//
// The pack list comes from the SERVER (`beG.getTickets` → `packs`), never from a constant here:
// the price is a product decision that changes without a client release, and a testbed that
// hardcoded it would happily show a price the server refuses.

import { Modal } from '../ui/Modal';
import type { TicketPack } from '../hooks/useTickets';

export function TicketShopDialog({
  open,
  onClose,
  busy,
  dialogError,
  packs,
  tickets,
  gems,
  onRefresh,
  onBuy,
}: {
  open: boolean;
  onClose: () => void;
  busy: string | null;
  dialogError: string | null;
  packs: TicketPack[];
  tickets?: number;
  gems?: number;
  onRefresh: () => void;
  onBuy: (packId: number) => void;
}) {
  return (
    <Modal
      open={open}
      title="Купити квитки за кристали"
      subtitle="beG.getTickets → packs · beG.buySurvivalTickets"
      onClose={onClose}
      busy={!!busy}
      footer={
        <button onClick={onRefresh} disabled={!!busy}>
          Оновити список
        </button>
      }
    >
      <div className="wallet-row">
        <span>у тебе: 🎟 {tickets ?? '—'}</span>
        <span>💎 {gems ?? '—'}</span>
      </div>

      {dialogError && <p className="deny">{dialogError}</p>}

      {packs.length === 0 ? (
        <p className="hint">
          Сервер не повернув жодного набору. Або main-server ще без{' '}
          <code>buySurvivalTickets</code>, або <code>beG.getTickets</code> не відповів — натисни
          «Оновити список».
        </p>
      ) : (
        <ul className="packs">
          {packs.map((pack) => {
            // Only when the balance is actually known: an unknown one must not disable a button
            // the server might well accept.
            const tooPoor = gems !== undefined && gems < pack.gems;
            return (
              <li key={pack.id}>
                <span className="pack-count">🎟 {pack.tickets}</span>
                <span className="pack-price">💎 {pack.gems}</span>
                <button
                  className="primary"
                  disabled={!!busy || tooPoor}
                  onClick={() => onBuy(pack.id)}
                >
                  {tooPoor ? 'не вистачає кристалів' : 'Купити'}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="ui-note">
        Кристали списує та сама <code>shop.pay</code>, через яку проходять усі покупки в грі, а
        квитки додаються тим самим <code>addTickets</code>, що й безкоштовний денний. Тобто це
        справжній шлях покупки, а не тестова видача.
      </p>
    </Modal>
  );
}
