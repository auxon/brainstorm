/**
 * Google Drive backups for Brainstorm sessions (drive.file scope).
 */
import { getValidAccessToken, loadGoogleAccount, saveDriveFolderId } from "./google";
import { displayNameFor } from "./auth";
import { nanoid, newId, randomToken } from "./ids";
import {
  SNAPSHOT_MAX_BYTES,
  buildSnapshot,
  driveFileName,
  parseSnapshot,
  remapSnapshot,
  snapshotJson,
} from "./drive-snapshot";
import { HttpError, type SessionGraph, type SessionRow, type WalletUser } from "./types";

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const APP_PROP_Q = "appProperties has { key='app' and value='brainstorm' }";

export type DriveFileCard = {
  id: string;
  name: string;
  modifiedTime: string | null;
  slug: string | null;
  sessionId: string | null;
  webViewLink: string | null;
};

async function driveJson<T>(accessToken: string, url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${accessToken}`);
  const res = await fetch(url, { ...init, headers });
  const body = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!res.ok) {
    throw new HttpError(res.status === 401 ? 401 : 502, body?.error?.message || `Google Drive request failed (${res.status})`);
  }
  return body as T;
}

export async function ensureDriveFolder(env: Env, userId: string, accessToken: string): Promise<string> {
  const account = await loadGoogleAccount(env.DB, userId);
  if (account?.drive_folder_id) return account.drive_folder_id;
  const q = encodeURIComponent(
    `mimeType='${FOLDER_MIME}' and name='Brainstorm' and ${APP_PROP_Q} and trashed=false`,
  );
  const listed = await driveJson<{ files?: { id: string }[] }>(
    accessToken,
    `${DRIVE_FILES}?q=${q}&fields=files(id)&pageSize=1`,
  );
  const existing = listed.files?.[0]?.id;
  if (existing) {
    await saveDriveFolderId(env.DB, userId, existing);
    return existing;
  }
  const created = await driveJson<{ id: string }>(accessToken, DRIVE_FILES, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Brainstorm",
      mimeType: FOLDER_MIME,
      appProperties: { app: "brainstorm", kind: "folder" },
    }),
  });
  await saveDriveFolderId(env.DB, userId, created.id);
  return created.id;
}

function multipartBody(metadata: Record<string, unknown>, json: string): { body: string; contentType: string } {
  const boundary = `brainstorm_${nanoid(12)}`;
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    json,
    `--${boundary}--`,
    "",
  ].join("\r\n");
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

async function rememberDriveFile(
  db: D1Database,
  userId: string,
  sessionId: string,
  driveFileId: string,
  title: string,
): Promise<void> {
  const t = Date.now();
  const existing = await db
    .prepare("SELECT id FROM drive_files WHERE user_id = ? AND session_id = ?")
    .bind(userId, sessionId)
    .first<{ id: string }>();
  if (existing) {
    await db
      .prepare("UPDATE drive_files SET drive_file_id = ?, title = ?, updated_at = ? WHERE id = ?")
      .bind(driveFileId, title, t, existing.id)
      .run();
    return;
  }
  await db
    .prepare("INSERT INTO drive_files (id, user_id, session_id, drive_file_id, title, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(newId(), userId, sessionId, driveFileId, title, t)
    .run();
}

export async function saveGraphToDrive(
  env: Env,
  user: WalletUser,
  graph: SessionGraph,
): Promise<{ fileId: string; name: string; updated: boolean }> {
  const json = snapshotJson(buildSnapshot(graph));
  if (new TextEncoder().encode(json).byteLength > SNAPSHOT_MAX_BYTES) {
    throw new HttpError(413, "Session is too large to save to Drive");
  }
  const accessToken = await getValidAccessToken(env, user.id);
  const folderId = await ensureDriveFolder(env, user.id, accessToken);
  const name = driveFileName(graph.session.title);
  const mapped = await env.DB.prepare("SELECT drive_file_id FROM drive_files WHERE user_id = ? AND session_id = ?")
    .bind(user.id, graph.session.id)
    .first<{ drive_file_id: string }>();

  const metadata = {
    name,
    mimeType: "application/json",
    description: `Brainstorm session ${graph.session.slug}`,
    appProperties: { app: "brainstorm", sessionId: graph.session.id, slug: graph.session.slug },
    parents: mapped ? undefined : [folderId],
  };

  if (mapped) {
    try {
      const { body, contentType } = multipartBody(
        { name, mimeType: "application/json", description: metadata.description, appProperties: metadata.appProperties },
        json,
      );
      const updated = await driveJson<{ id: string }>(
        accessToken,
        `${DRIVE_UPLOAD}/${encodeURIComponent(mapped.drive_file_id)}?uploadType=multipart`,
        { method: "PATCH", headers: { "content-type": contentType }, body },
      );
      await rememberDriveFile(env.DB, user.id, graph.session.id, updated.id, graph.session.title);
      return { fileId: updated.id, name, updated: true };
    } catch (err) {
      if (!(err instanceof HttpError) || err.status === 401) throw err;
      /* file may have been deleted — create a new one */
    }
  }

  const { body, contentType } = multipartBody(metadata, json);
  const created = await driveJson<{ id: string }>(accessToken, `${DRIVE_UPLOAD}?uploadType=multipart`, {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
  await rememberDriveFile(env.DB, user.id, graph.session.id, created.id, graph.session.title);
  return { fileId: created.id, name, updated: false };
}

export async function listDriveFiles(env: Env, userId: string): Promise<DriveFileCard[]> {
  const accessToken = await getValidAccessToken(env, userId);
  const q = encodeURIComponent(`${APP_PROP_Q} and mimeType='application/json' and trashed=false`);
  const listed = await driveJson<{
    files?: {
      id: string;
      name: string;
      modifiedTime?: string;
      webViewLink?: string;
      appProperties?: { slug?: string; sessionId?: string };
    }[];
  }>(
    accessToken,
    `${DRIVE_FILES}?q=${q}&fields=files(id,name,modifiedTime,webViewLink,appProperties)&pageSize=50&orderBy=modifiedTime desc`,
  );
  return (listed.files ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    modifiedTime: f.modifiedTime ?? null,
    slug: f.appProperties?.slug ?? null,
    sessionId: f.appProperties?.sessionId ?? null,
    webViewLink: f.webViewLink ?? null,
  }));
}

export async function importDriveFile(
  env: Env,
  user: WalletUser,
  fileId: string,
): Promise<{ session: SessionRow; editToken: string; viewToken: string }> {
  if (!/^[a-zA-Z0-9_-]{10,128}$/.test(fileId)) throw new HttpError(400, "Invalid Drive file id");
  const accessToken = await getValidAccessToken(env, user.id);
  const res = await fetch(`${DRIVE_FILES}/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) throw new HttpError(404, "Drive file not found");
  if (!res.ok) throw new HttpError(502, "Could not download the Drive file");
  const raw = await res.text();
  if (new TextEncoder().encode(raw).byteLength > SNAPSHOT_MAX_BYTES) {
    throw new HttpError(413, "Drive file is too large");
  }
  const snapshot = parseSnapshot(raw);
  const t = Date.now();
  const sessionId = newId();
  const slug = nanoid(8);
  const viewToken = randomToken();
  const editToken = randomToken();
  await env.DB.prepare(
    "INSERT INTO sessions (id, slug, title, description, visibility, view_token, edit_token, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'unlisted', ?, ?, ?, ?, ?)",
  )
    .bind(sessionId, slug, snapshot.session.title, snapshot.session.description, viewToken, editToken, user.id, t, t)
    .run();

  const remapped = remapSnapshot(snapshot, sessionId, user);
  for (const idea of remapped.ideas) {
    await env.DB.prepare(
      "INSERT INTO ideas (id, session_id, parent_id, title, body, author_user_id, author_name, author_address, position_x, position_y, color, sort_index, vote_count, satoshis, usd_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)",
    )
      .bind(
        idea.id,
        sessionId,
        idea.parent_id,
        idea.title,
        idea.body,
        user.id,
        displayNameFor(user),
        user.address,
        idea.position_x,
        idea.position_y,
        idea.color,
        idea.sort_index,
        idea.created_at,
        idea.updated_at,
      )
      .run();
  }
  for (const comment of remapped.comments) {
    await env.DB.prepare(
      "INSERT INTO comments (id, session_id, idea_id, parent_id, body, author_user_id, author_name, author_address, vote_count, satoshis, usd_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)",
    )
      .bind(
        comment.id,
        sessionId,
        comment.idea_id,
        comment.parent_id,
        comment.body,
        user.id,
        displayNameFor(user),
        user.address,
        comment.created_at,
      )
      .run();
  }
  for (const edge of remapped.edges) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO edges (id, session_id, source_id, target_id, label) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(edge.id, sessionId, edge.source_id, edge.target_id, edge.label)
      .run();
  }
  await rememberDriveFile(env.DB, user.id, sessionId, fileId, snapshot.session.title);
  return {
    session: {
      id: sessionId,
      slug,
      title: snapshot.session.title,
      description: snapshot.session.description,
      visibility: "unlisted",
      view_token: viewToken,
      edit_token: editToken,
      owner_user_id: user.id,
      created_at: t,
      updated_at: t,
    },
    editToken,
    viewToken,
  };
}
