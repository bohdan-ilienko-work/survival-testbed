// The wall clock every countdown on the screen reads.
//
// One interval for the whole app: the round timer, the on-boarding countdown, the BuyBack window
// and «через N хв» in the booking list are all the same subtraction from `now`, so one tick
// redraws all of them and no panel needs a timer of its own.

import { useEffect, useState } from 'react';

/**
 * @param intervalMs how often to re-read the clock. 250 ms is fast enough that a displayed
 * second never visibly skips, and slow enough not to re-render the tree four times a frame.
 */
export function useClock(intervalMs = 250): number {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);

  return now;
}
