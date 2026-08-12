/**
 * The showcase's loading screen: a lamp being built, one part at a time.
 *
 * A progress bar says how much is left. This says what is happening, by doing
 * the thing the page is about to show you — the lamp assembles as the work
 * completes, base first, then the posts, the rails, the kumiko, the paper, and
 * last the light. By the time it is lit the scene behind it is ready, and the
 * two facts are the same fact.
 *
 * Drawn in SVG rather than in the 3D scene on purpose. The single longest wait
 * here is the renderer itself — compiling shaders, uploading the first frame —
 * and a loading indicator that needs the renderer is one that cannot appear
 * until the thing it is waiting for has arrived.
 *
 * The parts are revealed by *milestone*, not by tweening an opacity. A part is
 * on or it is not, exactly as a part is either cut or not cut, and a fading
 * ghost of an unbuilt rail would be a progress bar wearing a costume.
 */

/** The stages, in the order they complete, with what to say during each. */
export const LOADING_STAGES = [
  "Reading the variables",
  "Listing the library",
  "Cutting the parts",
  "Papering the panels",
  "Lighting the lamp",
] as const;

/**
 * The lamp, in the order a lamp is made.
 *
 * Nine parts against five stages, because the two are counting different things:
 * the stages are what the app is doing and the parts are how far along it looks,
 * and a build that jumps a third of a lamp at a time reads as a stutter rather
 * than as progress. The mapping is just `floor(progress * parts)`.
 */
const PARTS = 9;

function shown(progress: number, part: number): boolean {
  return progress * PARTS >= part;
}

export function ShowcaseLoading({
  progress,
  stage,
  done,
}: {
  progress: number;
  stage: string;
  /** Fades the whole thing out; the caller unmounts it once that has run. */
  done: boolean;
}) {
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  const lit = shown(progress, 8);

  return (
    <div className={"showcase-loading" + (done ? " done" : "")} role="status" aria-live="polite">
      <svg
        className="showcase-loading-lamp"
        viewBox="0 0 120 190"
        width="120"
        height="190"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="paperGlow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffdca8" stopOpacity="0.55" />
            <stop offset="45%" stopColor="#ffc078" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#ffb163" stopOpacity="0.7" />
          </linearGradient>
        </defs>

        {/* the paper goes in before the kumiko, because that is the order it is
            pasted: onto the back of the lattice */}
        {shown(progress, 6) && (
          <rect x="26" y="34" width="68" height="112" fill="url(#paperGlow)" opacity={lit ? 1 : 0.35} />
        )}

        {/* 1 — the plinth */}
        {shown(progress, 1) && <rect x="18" y="158" width="84" height="9" rx="1.5" />}
        {/* 2 — the feet */}
        {shown(progress, 2) && (
          <>
            <rect x="24" y="167" width="12" height="9" rx="1.5" />
            <rect x="84" y="167" width="12" height="9" rx="1.5" />
          </>
        )}
        {/* 3 — the base rail */}
        {shown(progress, 3) && <rect x="22" y="146" width="76" height="12" rx="1.5" />}
        {/* 4 — the corner posts */}
        {shown(progress, 4) && (
          <>
            <rect x="22" y="30" width="9" height="118" rx="1.5" />
            <rect x="89" y="30" width="9" height="118" rx="1.5" />
          </>
        )}
        {/* 5 — the cap */}
        {shown(progress, 5) && (
          <>
            <rect x="18" y="22" width="84" height="10" rx="1.5" />
            <rect x="26" y="14" width="68" height="8" rx="1.5" />
          </>
        )}
        {/* 7 — the kumiko, over the paper */}
        {shown(progress, 7) && (
          <>
            <rect x="47" y="34" width="5" height="112" />
            <rect x="68" y="34" width="5" height="112" />
            <rect x="26" y="62" width="68" height="5" />
            <rect x="26" y="110" width="68" height="5" />
          </>
        )}
      </svg>

      <div className="showcase-loading-text">
        <span className="showcase-loading-stage">{stage}</span>
        <span className="showcase-loading-percent">{percent}%</span>
      </div>
    </div>
  );
}
