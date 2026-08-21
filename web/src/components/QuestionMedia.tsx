// The picture and the sound a question carries.
//
// Its own component for two reasons: QuestionView is at the line budget, and this panel has a
// job the rest of the panel does not — it is a TESTBED, so it shows the URLs it was given as
// well as what they resolve to. A picture that silently fails to load and a question that never
// had one look identical on screen otherwise, and telling those two apart is the whole reason
// somebody opens this page.

import { useEffect, useState } from 'react';
import type { QuestionImage } from '../survival';

/**
 * Mirrors the game client: the small rendition goes up immediately, the full one replaces it the
 * moment it has loaded. Keyed by `low` so a new round starts the sequence over instead of
 * leaving the previous question's picture on screen while this one downloads.
 */
function Picture({ image }: { image: QuestionImage }) {
  const [src, setSrc] = useState(image.low);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    setSrc(image.low);
    setFailed(false);
    // A new question must never inherit the previous one's zoom.
    setZoomed(false);
    const full = new Image();
    full.onload = () => setSrc(image.high);
    full.src = image.high;
  }, [image.low, image.high]);

  if (failed) {
    return (
      <p className="media-error">
        картинка не завантажилась — сервер дав адресу, але вона не віддає зображення:
        <br />
        <code>{image.low}</code>
      </p>
    );
  }

  return (
    <>
      <img
        className="question-image"
        src={src}
        alt=""
        title="натисни, щоб збільшити"
        onClick={() => setZoomed(true)}
        onError={() => setFailed(true)}
      />
      {/* Enlarged, over everything, and dismissed by a tap ANYWHERE — including on the picture
          itself. A zoom that can only be closed by finding a small × is a zoom that covers the
          answers for the rest of the round; the round has a deadline running underneath it. */}
      {zoomed && (
        <div
          className="question-zoom"
          role="presentation"
          onClick={() => setZoomed(false)}
        >
          <img src={image.high} alt="" onError={() => setZoomed(false)} />
          <span className="zoom-hint">тап будь-де — повернути розмір</span>
        </div>
      )}
    </>
  );
}

export function QuestionMedia({ image, audio }: { image?: QuestionImage; audio?: string }) {
  if (!image && !audio) return null;

  return (
    <div className="question-media">
      {image && <Picture image={image} />}
      {audio && <audio className="question-audio" src={audio} controls preload="none" />}
      {/* What actually arrived, verbatim. The point of the page. */}
      <details className="media-urls">
        <summary>адреси медіа з payload</summary>
        {image && (
          <p>
            <code>low</code> {image.low}
            <br />
            <code>high</code> {image.high}
          </p>
        )}
        {audio && (
          <p>
            <code>audio</code> {audio}
          </p>
        )}
      </details>
    </div>
  );
}
