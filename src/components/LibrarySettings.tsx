import { useState } from "react";
import {
  checkRepoConfig,
  readRepoConfig,
  writeRepoConfig,
  type RepoConfig,
} from "../lib/library";

/**
 * Where the library is, and the token that may write to it.
 *
 * Four fields kept in this browser and nowhere else — see the note at the top of
 * `lib/library.ts` for why that is the whole security model. Filling them in is
 * what turns every "Save" in the app from a download into a commit; clearing
 * them turns it back.
 *
 * The settings are checked against GitHub before they are kept. A token with the
 * wrong repository on it, or one that has expired, otherwise announces itself at
 * the first save — which is the worst possible moment, because the design is
 * finished and the error arrives in place of the file.
 */
export function LibrarySettings({ onClose }: { onClose: () => void }) {
  const saved = readRepoConfig();
  const [owner, setOwner] = useState(saved?.owner ?? "");
  const [repo, setRepo] = useState(saved?.repo ?? "shoji-builder");
  const [branch, setBranch] = useState(saved?.branch ?? "main");
  const [token, setToken] = useState(saved?.token ?? "");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const config: RepoConfig = {
    owner: owner.trim(),
    repo: repo.trim(),
    branch: branch.trim() || "main",
    token: token.trim(),
  };
  const complete = config.owner !== "" && config.repo !== "" && config.token !== "";

  const connect = async () => {
    setChecking(true);
    const failure = await checkRepoConfig(config);
    setChecking(false);
    if (failure) {
      setError(failure);
      return;
    }
    writeRepoConfig(config);
    onClose();
  };

  const forget = () => {
    writeRepoConfig(null);
    onClose();
  };

  return (
    <div className="file-dialog-backdrop" onPointerDown={onClose}>
      <div
        className="file-dialog file-dialog-wide"
        role="dialog"
        aria-label="Library settings"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2>Library settings</h2>
        <p className="file-dialog-note">
          With a token, Save commits to the repository and the site rebuilds with
          it. Without one, Save downloads the file as before. The token is kept in
          this browser only.
        </p>

        <label className="file-dialog-field">
          <span>GitHub user or org</span>
          <input
            type="text"
            value={owner}
            placeholder="your-username"
            autoComplete="off"
            onChange={(event) => {
              setOwner(event.target.value);
              setError(null);
            }}
          />
        </label>
        <label className="file-dialog-field">
          <span>Repository</span>
          <input
            type="text"
            value={repo}
            placeholder="shoji-builder"
            autoComplete="off"
            onChange={(event) => {
              setRepo(event.target.value);
              setError(null);
            }}
          />
        </label>
        <label className="file-dialog-field">
          <span>Branch</span>
          <input
            type="text"
            value={branch}
            placeholder="main"
            autoComplete="off"
            onChange={(event) => {
              setBranch(event.target.value);
              setError(null);
            }}
          />
        </label>
        <label className="file-dialog-field">
          <span>Fine-grained token, Contents: read and write</span>
          <input
            type="password"
            value={token}
            placeholder="github_pat_…"
            autoComplete="off"
            onChange={(event) => {
              setToken(event.target.value);
              setError(null);
            }}
          />
        </label>

        {error != null && <p className="file-dialog-warn armed">{error}</p>}

        <div className="file-dialog-actions">
          {saved && (
            <button type="button" className="file-dialog-quiet" onClick={forget}>
              Forget token
            </button>
          )}
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={!complete || checking}
            onClick={() => void connect()}
          >
            {checking ? "Checking…" : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}
