import { useState } from "react";
import { useLampStore } from "../store/useLampStore";
import { useVariablesStore } from "../store/useVariablesStore";
import { computeScene } from "../lib/lamp";
import { NEGATIVE_PALETTE, PAPER, PRINT_PALETTE, type PaperSize } from "../lib/blueprint";
import { buildBlueprint, type HeroImage } from "../lib/blueprintDoc";
import { openBytes } from "../lib/library";
import { sanitizeName } from "../lib/componentFile";
import { LampRenderCapture } from "./LampRenderCapture";

/**
 * Take the lamp out of the app as a set of drawings.
 *
 * The four questions here are the four a drawing office would ask before
 * printing anything, and no more than that: **what paper**, **which way up the
 * colours go**, **is there a photograph on the front**, and — implicitly, in
 * what it says rather than what it asks — **at what settings of the variables**.
 *
 * There is deliberately no scale control. A drawing states its scale, and which
 * ratio a given lamp fits on a given sheet at is arithmetic, not taste: offering
 * it as a choice would mostly offer the chance to pick one it does not fit at.
 * See `fitScale`.
 */

const RENDER_WIDTH = 1100;
const RENDER_HEIGHT = 900;

export function ExportBlueprintDialog({
  onClose,
}: {
  /** Called with what to report, or null when the dialog was simply dismissed. */
  onClose: (note: string | null) => void;
}) {
  const instances = useLampStore((state) => state.instances);
  const lampName = useLampStore((state) => state.lampName);
  const description = useLampStore((state) => state.description);
  const hiddenIds = useLampStore((state) => state.hiddenIds);
  const raw = useVariablesStore((state) => state.raw);

  const [paper, setPaper] = useState<PaperSize>("a4");
  const [negative, setNegative] = useState(false);
  const [withRender, setWithRender] = useState(true);
  const [withGrid, setWithGrid] = useState(false);
  const [withPadding, setWithPadding] = useState(false);
  // Non-null while the offscreen canvas is up: the export is waiting on a frame.
  const [capturing, setCapturing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const name = sanitizeName(lampName ?? "") ?? "lamp";
  const palette = negative ? NEGATIVE_PALETTE : PRINT_PALETTE;

  const write = (hero: HeroImage | null) => {
    try {
      // Everything on the lamp is drawn and counted, including anything hidden
      // on the bench — hiding is a way of seeing past a part while working, not
      // a way of taking it off the design, and a cut list that quietly left one
      // out is the worst thing this file could produce.
      const scene = computeScene(instances, raw);
      const pdf = buildBlueprint({
        name,
        description: description || undefined,
        instances,
        scene,
        variables: raw,
        paper,
        palette,
        grid: withGrid,
        padding: withPadding,
        hero,
        date: new Date().toISOString().slice(0, 10),
      });
      const message = openBytes(`${name}.blueprint.pdf`, pdf, "application/pdf");
      setCapturing(false);
      onClose(
        withRender && !hero
          ? `${message} — without the render, which would not draw`
          : message
      );
    } catch (e) {
      // The dialog stays up: the settings are still there to try again with, and
      // a failure that closed the dialog would take the message with it.
      setCapturing(false);
      setNote(`Could not build the drawings: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const start = () => {
    setNote(null);
    if (withRender) {
      setCapturing(true);
      return;
    }
    write(null);
  };

  return (
    <div className="file-dialog-backdrop" onPointerDown={() => !capturing && onClose(null)}>
      <div
        className="file-dialog file-dialog-wide"
        role="dialog"
        aria-label="Export blueprint"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2>Export blueprint</h2>
        <p className="file-dialog-note">
          Opens <strong>{name}.blueprint.pdf</strong> in a new tab — save it from
          there if you want to keep it. The drawings are true at the variables the
          lamp is set to now.
        </p>

        <div className="file-dialog-field">
          <span>Paper</span>
          <div className="file-dialog-choices">
            {(Object.keys(PAPER) as PaperSize[]).map((size) => (
              <button
                key={size}
                type="button"
                className={paper === size ? "chosen" : ""}
                disabled={capturing}
                onClick={() => setPaper(size)}
              >
                {PAPER[size].label}
              </button>
            ))}
          </div>
        </div>

        <label className="file-dialog-check">
          <input
            type="checkbox"
            checked={withRender}
            disabled={capturing}
            onChange={(event) => setWithRender(event.target.checked)}
          />
          <span>
            A render of the finished lamp on the title sheet
            {hiddenIds.length > 0 && (
              <em>
                {" "}
                — {hiddenIds.length} part{hiddenIds.length === 1 ? " is" : "s are"} hidden on
                the bench and will not be in it, though {hiddenIds.length === 1 ? "it is" : "they are"} still drawn and
                counted
              </em>
            )}
          </span>
        </label>

        <label className="file-dialog-check">
          <input
            type="checkbox"
            checked={withGrid}
            disabled={capturing}
            onChange={(event) => setWithGrid(event.target.checked)}
          />
          <span>
            Graph paper under the drawings — what makes a sheet read as a blueprint
            rather than a diagram. Off by default: it is ink on every square
            millimetre and none of it is information.
          </span>
        </label>

        <label className="file-dialog-check">
          <input
            type="checkbox"
            checked={withPadding}
            disabled={capturing}
            onChange={(event) => setWithPadding(event.target.checked)}
          />
          <span>
            Outline the padding — every band of the sheet that is margin, gap or
            reserved strip rather than drawing, labelled with where it comes from.
            For deciding what to trim.
          </span>
        </label>

        <label className="file-dialog-check">
          <input
            type="checkbox"
            checked={negative}
            disabled={capturing}
            onChange={(event) => setNegative(event.target.checked)}
          />
          <span>
            Negative — white lines on blue, for reading on screen. The default is dark
            ink on white, which is what prints.
          </span>
        </label>

        {note && <p className="file-dialog-warn">{note}</p>}

        <div className="file-dialog-actions">
          <button type="button" disabled={capturing} onClick={() => onClose(null)}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={capturing} onClick={start}>
            {capturing ? "Rendering…" : "Export"}
          </button>
        </div>
      </div>

      {capturing && (
        <LampRenderCapture
          width={RENDER_WIDTH}
          height={RENDER_HEIGHT}
          background={palette.paper}
          onDone={write}
        />
      )}
    </div>
  );
}
