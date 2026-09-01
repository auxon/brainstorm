import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { Cloud, FolderOpen } from "lucide-react";
import { rememberSession, saveEditToken } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { googleStartUrl, importDriveFile, listDriveFiles, saveSessionToDrive, type DriveFileCard } from "@/lib/google";

export function DriveMenu({ slug, canEdit }: { slug: string; canEdit: boolean }) {
  const { user } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<DriveFileCard[] | null>(null);

  const returnTo = `${location.pathname}${location.search}`;
  const connected = Boolean(user?.googleConnected);

  async function save() {
    if (!connected) {
      window.location.href = googleStartUrl(returnTo);
      return;
    }
    if (!canEdit) {
      toast.error("You need edit access to save this board to Drive");
      return;
    }
    setBusy(true);
    try {
      const saved = await saveSessionToDrive(slug);
      toast.success(saved.updated ? `Updated ${saved.name} on Drive` : `Saved ${saved.name} to Drive`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save to Drive");
    } finally {
      setBusy(false);
    }
  }

  async function openPicker() {
    if (!connected) {
      window.location.href = googleStartUrl(returnTo);
      return;
    }
    setOpen(true);
    if (files) return;
    try {
      setFiles(await listDriveFiles());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not list Drive files");
      setOpen(false);
    }
  }

  async function loadFile(file: DriveFileCard) {
    setBusy(true);
    try {
      const imported = await importDriveFile(file.id);
      saveEditToken(imported.session.slug, imported.editToken);
      rememberSession(imported.session.slug, imported.session.title);
      setOpen(false);
      toast.success(`Opened ${imported.session.title} from Drive`);
      navigate(`/s/${imported.session.slug}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open Drive file");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => void save()}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-raised px-3 text-xs text-muted hover:text-fg disabled:opacity-60"
      >
        <Cloud className="size-3.5" />
        {busy ? "Saving…" : connected ? "Save to Drive" : "Google Drive"}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void openPicker()}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-raised px-3 text-xs text-muted hover:text-fg"
      >
        <FolderOpen className="size-3.5" />
        Open
      </button>
      {open ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div
            className="max-h-[80vh] w-full max-w-md overflow-auto rounded-2xl border border-border bg-raised p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-medium">From Google Drive</h2>
              <button type="button" className="text-xs text-muted hover:text-fg" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
            {!files ? (
              <p className="mt-4 text-sm text-muted">Loading…</p>
            ) : files.length === 0 ? (
              <p className="mt-4 text-sm text-muted">No Brainstorm files in Drive yet. Save a board first.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {files.map((file) => (
                  <li key={file.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void loadFile(file)}
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-left text-sm hover:border-accent/40"
                    >
                      <span className="block truncate">{file.name}</span>
                      {file.modifiedTime ? (
                        <span className="text-xs text-muted">{new Date(file.modifiedTime).toLocaleString()}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
