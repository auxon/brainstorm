import { apiUrl } from "./base-path";
import { apiFetch } from "./api";

export type GoogleStatus = {
  configured: boolean;
  connected: boolean;
  email: string | null;
  name: string | null;
  picture: string | null;
  startPath: string;
};

export type DriveFileCard = {
  id: string;
  name: string;
  modifiedTime: string | null;
  slug: string | null;
  sessionId: string | null;
  webViewLink: string | null;
};

export function googleStartUrl(returnTo = "/"): string {
  const params = new URLSearchParams({ return: returnTo });
  return `${apiUrl("/auth/google/start")}?${params}`;
}

export async function fetchGoogleStatus(): Promise<GoogleStatus> {
  return apiFetch<GoogleStatus>("/auth/google/status");
}

export async function listDriveFiles(): Promise<DriveFileCard[]> {
  const data = await apiFetch<{ files: DriveFileCard[] }>("/drive/files");
  return data.files ?? [];
}

export async function saveSessionToDrive(slug: string): Promise<{ fileId: string; name: string; updated: boolean }> {
  return apiFetch(`/sessions/${slug}/drive/save`, { method: "POST", body: "{}" }, slug);
}

export async function importDriveFile(fileId: string): Promise<{
  session: { slug: string; title: string };
  editToken: string;
}> {
  return apiFetch("/drive/import", { method: "POST", body: JSON.stringify({ fileId }) });
}
