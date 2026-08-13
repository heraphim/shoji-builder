import { useEffect } from "react";

import { useLampStore } from "../store/useLampStore";

/** The library lists file names; the bench knows the lamp by its bare name. */
const bare = (file: string) => file.replace(/(\.lamp)?\.json$/, "");

/**
 * Step through `public/models/lamps` without opening a menu.
 *
 * `<<` `<` *name* `>` `>>` — first, previous, what is on the bench, next, last.
 * Comparing one design with the next is the thing the file menu is worst at: it
 * takes three clicks each way and puts a list over the very views you are trying
 * to compare. Here it is one click, and the drawing never leaves the screen.
 *
 * Each button loads the lamp the same way **Load…** does — `loadLamp` — so a
 * design opened by stepping is a design opened, variables and all, with no
 * second path into the bench to keep in step.
 *
 * ## What is disabled, and why
 *
 * The lamp on the bench need not be *in* the library: it may have been built
 * from scratch, opened off the disk, or renamed. Then there is no "previous" or
 * "next" — nothing says where it would sit — but "first" and "last" are still
 * perfectly well defined, so those two stay live and the steps go grey. That is
 * the honest reading rather than a guess at where an unsaved design belongs.
 *
 * Everything goes grey while a connect pick is in flight: the draft names
 * instances of *this* lamp, and loading another one under it would leave the
 * pick pointing at parts that are no longer there.
 */
export function LampNavigator() {
  const lampLibrary = useLampStore((state) => state.lampLibrary);
  const lampName = useLampStore((state) => state.lampName);
  const loadLamp = useLampStore((state) => state.loadLamp);
  const loadLampLibrary = useLampStore((state) => state.loadLampLibrary);
  const drafting = useLampStore((state) => state.draft !== null);

  // Re-listed on mount and again whenever the bench changes lamp, for the same
  // reason every picker re-lists when it is opened: the folder is read per
  // request, so a design saved a moment ago should already be steppable.
  useEffect(() => {
    void loadLampLibrary();
  }, [loadLampLibrary, lampName]);

  const last = lampLibrary.length - 1;
  const index = lampLibrary.findIndex((file) => bare(file) === lampName);
  const placed = index !== -1;

  const steps: Array<{ label: string; what: string; to: number; live: boolean }> = [
    { label: "<<", what: "First", to: 0, live: last >= 0 && index !== 0 },
    { label: "<", what: "Previous", to: index - 1, live: placed && index > 0 },
    { label: ">", what: "Next", to: index + 1, live: placed && index < last },
    { label: ">>", what: "Last", to: last, live: last >= 0 && index !== last },
  ];

  return (
    <div className="lamp-nav">
      {steps.slice(0, 2).map((step) => (
        <NavButton key={step.label} step={step} files={lampLibrary} drafting={drafting} onGo={loadLamp} />
      ))}
      <span className={`lamp-nav-name${lampName ? "" : " unnamed"}`}>
        {lampName ?? "unsaved lamp"}
      </span>
      {steps.slice(2).map((step) => (
        <NavButton key={step.label} step={step} files={lampLibrary} drafting={drafting} onGo={loadLamp} />
      ))}
    </div>
  );
}

function NavButton({
  step,
  files,
  drafting,
  onGo,
}: {
  step: { label: string; what: string; to: number; live: boolean };
  files: string[];
  drafting: boolean;
  onGo: (file: string) => Promise<void>;
}) {
  const enabled = step.live && !drafting;
  return (
    <button
      type="button"
      className="lamp-nav-step"
      disabled={!enabled}
      title={
        drafting
          ? "Finish or cancel the connection first"
          : enabled
            ? `${step.what} lamp — ${bare(files[step.to])}`
            : `${step.what} lamp`
      }
      onClick={() => void onGo(files[step.to])}
    >
      {step.label}
    </button>
  );
}
