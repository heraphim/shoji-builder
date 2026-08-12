import { useEffect } from "react";
import { TextureViews } from "./TextureViews";
import { TextureSidebar } from "./TextureSidebar";
import { FileStatusBar } from "./FileStatusBar";
import { useTextureStore } from "../store/useTextureStore";
import { SPECIES_LABELS } from "../lib/wood";

/**
 * The Textures tab: a status strip, the four views, and every control that makes
 * a wood.
 *
 * Same three-part shape as the other two tabs, and for the same reason — the
 * views are the work and the sidebar is what you are doing to it. Opening and
 * saving is in the tab's file menu.
 *
 * The library is read on mount rather than when a picker is opened, because the
 * Component Editor's Texture panel needs the listing whether or not anybody has
 * been on this tab: a component loaded from file names a texture, and it has to
 * be able to find it.
 */
export function TexturesPage() {
  const documentName = useTextureStore((state) => state.documentName);
  const species = useTextureStore((state) => state.species);
  const loadLibrary = useTextureStore((state) => state.loadLibrary);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  // What is on the bench, said once: its file name if it has one, otherwise the
  // preset the numbers came from — which is at least true of a texture nobody
  // has saved yet.
  const lead = documentName ?? `${SPECIES_LABELS[species]} (unsaved)`;

  return (
    <div className="textures-page">
      <FileStatusBar lead={lead} />
      <div className="textures-body">
        <div className="textures-canvas">
          <TextureViews />
        </div>
        <TextureSidebar />
      </div>
    </div>
  );
}
