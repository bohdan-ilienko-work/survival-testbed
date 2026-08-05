// The "never show a broken image" fallback chain, shared by every picture in the editor.

import { useState } from 'react';

/**
 * Walks a list of image URLs, moving to the next one on error and stopping at `null`.
 *
 * A deliberate copy of App.tsx's useImageChain rather than an import: that hook and the FlagImg /
 * CharacterImg components around it are module-private in App.tsx, and importing from App.tsx —
 * the module that renders THIS one — would close an import cycle. The behaviour needed is the
 * same, so if App.tsx ever exports them, this and the tile components using it should go.
 *
 * Running off the end has to be a real state: an <img> whose last source 404s paints the browser's
 * broken-image glyph, which is a different size and re-flows the tile grid around it.
 */
export function useArtwork(chain: (string | null)[]): [string | null, () => void] {
  const urls = chain.filter((u): u is string => !!u);
  const key = urls.join('|');
  const [tried, setTried] = useState({ key, failed: 0 });
  // Reset during render, not in an effect: these cells are recycled as the search filters the
  // grid, and an effect would leave one frame showing the previous cell's picture.
  if (tried.key !== key) setTried({ key, failed: 0 });
  const failed = tried.key === key ? tried.failed : 0;
  return [urls[failed] ?? null, () => setTried({ key, failed: failed + 1 })];
}
