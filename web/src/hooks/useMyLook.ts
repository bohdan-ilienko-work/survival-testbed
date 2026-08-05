// What the character editor opens on: this player's own character, flag and name.
//
// Two sources, in a fixed order of trust — the live profile (beG.getContext) first, and the
// roster copy only as a fallback. They are not the same thing: see Profile.

import { useMemo } from 'react';
import type { BookingStatus, LobbyPlayer } from '../survival';
import type { Profile } from './types';

export interface MyLook {
  playerId?: string;
  character?: number;
  flag?: string;
  name?: string;
  reborn?: boolean;
}

export function useMyLook(
  playerId: string | undefined,
  profile: Profile | null,
  booking: BookingStatus | null,
  /** the LIVE roster, straight from state — never a fallback [] built during render, see below */
  players: LobbyPlayer[] | undefined,
): MyLook {
  /**
   * My own row, wherever the server last mentioned me: the booking list first (it is the
   * pre-match screen and exists hours earlier), the live lobby roster second.
   *
   * It is only ever a FALLBACK for the editor — see Profile — because both rosters carry the
   * character and flag copied in at registration, not the current ones.
   */
  const myRosterRow = useMemo(() => {
    if (!playerId) return undefined;
    const booked = booking?.lobby?.roster?.find((r) => r?.playerId === playerId);
    if (booked) return booked;
    // state.players and not a `players` array re-created during render: that would make this
    // memo re-run every render and defeat the point of it.
    const live = Array.isArray(players) ? players : [];
    return live.find((p) => p?.playerId === playerId);
  }, [booking, players, playerId]);

  /** What the editor opens on: the live profile where we have it, the roster copy otherwise. */
  return useMemo(
    () => ({
      playerId,
      character:
        profile?.character ??
        (typeof myRosterRow?.character === 'number' ? myRosterRow.character : undefined),
      flag: profile?.flag ?? (typeof myRosterRow?.flag === 'string' ? myRosterRow.flag : undefined),
      name: profile?.name ?? (typeof myRosterRow?.name === 'string' ? myRosterRow.name : undefined),
      // only beG.getContext knows this — the roster row carries no such field
      reborn: profile?.reborn,
    }),
    [profile, myRosterRow, playerId],
  );
}
