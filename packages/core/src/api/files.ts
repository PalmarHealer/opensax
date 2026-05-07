import type { FocusSpec, LernSaxSession } from "../session.js";

export interface FileUserStamp {
  date: number;
  user?: { login: string; name_hr?: string; alias?: string };
}

export interface FileEntry {
  id: string;
  parent_id: string;
  name: string;
  description?: string;
  type: "file" | "folder";
  size?: number;
  ordinal?: number;
  readable?: 0 | 1;
  writable?: 0 | 1;
  sparse?: 0 | 1;
  mine?: 0 | 1;
  shared?: 0 | 1;
  empty?: 0 | 1;
  created?: FileUserStamp;
  modified?: FileUserStamp;
  effective?: { read?: 0 | 1; create?: 0 | 1; modify?: 0 | 1; delete?: 0 | 1 };
  aggregation?: {
    is_file?: number;
    is_folder?: number;
    size?: number;
    newest_file?: { id: string; created?: { date: number } };
  };
  mime?: string;
  [k: string]: unknown;
}

export interface FileQuota {
  used?: number;
  limit?: number;
  free?: number;
  [k: string]: unknown;
}

export class FilesApi {
  /** In-memory cache of full entry listings per scope. The list is small
   * relative to total render work, but the LernSax round-trip is the slow
   * part — caching makes folder-to-folder navigation feel instant. */
  private cache = new Map<string, { entries: FileEntry[]; at: number }>();
  private readonly cacheTtlMs = 60_000;

  constructor(private readonly session: LernSaxSession) {}
  private focus(group?: string): FocusSpec {
    const login = group ? this.session.resolveGroup(group) : undefined;
    return login ? { object: "files", login } : { object: "files" };
  }
  private cacheKey(group: string | undefined): string {
    return group ?? "__personal__";
  }
  /** Drop the cache for one scope, or all scopes when no group is given. */
  invalidate(group?: string): void {
    if (group === undefined) this.cache.clear();
    else this.cache.delete(this.cacheKey(group));
  }

  /**
   * Returns all entries (folders + files) for the focus, flat with `parent_id`
   * references. Cached for {@link cacheTtlMs} ms per scope unless `force: true`.
   */
  async list(params: { group?: string; folder_id?: string; recursive?: boolean; search?: string; force?: boolean } = {}): Promise<FileEntry[]> {
    const { group, folder_id, force, ...rest } = params;
    const key = this.cacheKey(group);
    if (!force && !folder_id && Object.keys(rest).length === 0) {
      const hit = this.cache.get(key);
      if (hit && Date.now() - hit.at < this.cacheTtlMs) return hit.entries;
    }
    const callParams: Record<string, unknown> = { ...rest };
    if (folder_id) callParams.folder_id = folder_id;
    const r = await this.session.call("get_entries", callParams, this.focus(group));
    const entries = (r.entries as FileEntry[]) ?? [];
    if (!folder_id && Object.keys(rest).length === 0) {
      this.cache.set(key, { entries, at: Date.now() });
    }
    return entries;
  }

  async info(group: string | undefined, id: string): Promise<FileEntry> {
    const r = await this.session.call("get_file", { id }, this.focus(group));
    return (r.file as FileEntry) ?? (r as FileEntry);
  }

  async downloadUrl(group: string | undefined, id: string): Promise<string> {
    const r = await this.session.call("get_file_download_url", { id }, this.focus(group));
    const file = r.file as { download_url?: string; url?: string } | undefined;
    return file?.download_url ?? file?.url ?? (r.download_url as string) ?? (r.url as string) ?? "";
  }

  /** Fetch a file's binary contents directly (returns Uint8Array). */
  async download(group: string | undefined, id: string): Promise<{ name: string; size: number; data: Uint8Array }> {
    const r = await this.session.call("get_file", { id }, this.focus(group));
    const file = (r.file ?? r) as { name?: string; size?: number; data?: string; data_encoding?: string };
    if (!file.data) throw new Error("get_file: no data");
    const bin = file.data_encoding === "base64"
      ? Uint8Array.from(atob(file.data), (ch) => ch.charCodeAt(0))
      : new TextEncoder().encode(file.data);
    return { name: file.name ?? "file", size: file.size ?? bin.length, data: bin };
  }

  async upload(params: {
    group?: string;
    folder_id: string;
    name: string;
    /** base64-encoded file contents */
    data: string;
    description?: string;
  }): Promise<FileEntry> {
    const { group, ...rest } = params;
    const r = await this.session.call("add_file", rest, this.focus(group));
    this.invalidate(group);
    return (r.file as FileEntry) ?? (r as FileEntry);
  }

  async remove(group: string | undefined, id: string): Promise<void> {
    await this.session.call("delete_file", { id }, this.focus(group));
    this.invalidate(group);
  }

  async mkdir(group: string | undefined, folder_id: string, name: string, description?: string): Promise<FileEntry> {
    // LernSax expects `folder_id` (the parent), not `parent_id`.
    const r = await this.session.call("add_folder", { folder_id, name, description }, this.focus(group));
    this.invalidate(group);
    return (r.folder as FileEntry) ?? (r as FileEntry);
  }

  async rmdir(group: string | undefined, id: string): Promise<void> {
    await this.session.call("delete_folder", { id }, this.focus(group));
    this.invalidate(group);
  }

  /**
   * Recursively delete a folder and all of its contents. LernSax refuses to
   * remove non-empty folders, so we walk the subtree client-side and delete
   * the leaves first.
   */
  async rmrf(group: string | undefined, id: string): Promise<void> {
    const all = await this.list({ group, force: true });
    const target = all.find((e) => e.id === id);
    if (!target) return;
    if (target.type === "file") {
      await this.remove(group, id);
      return;
    }
    // BFS to collect descendants, then delete deepest-first.
    const collected: FileEntry[] = [];
    const queue = [id];
    while (queue.length) {
      const pid = queue.shift()!;
      for (const e of all) {
        if (e.parent_id === pid) {
          collected.push(e);
          if (e.type === "folder") queue.push(e.id);
        }
      }
    }
    collected.sort((a, b) => b.id.split("/").length - a.id.split("/").length);
    for (const e of collected) {
      if (e.type === "file") await this.session.call("delete_file", { id: e.id }, this.focus(group));
      else await this.session.call("delete_folder", { id: e.id }, this.focus(group));
    }
    await this.session.call("delete_folder", { id }, this.focus(group));
    this.invalidate(group);
  }

  async setFile(group: string | undefined, id: string, patch: Partial<{ name: string; description: string; parent_id: string }>): Promise<FileEntry> {
    const r = await this.session.call("set_file", { id, ...patch }, this.focus(group));
    this.invalidate(group);
    return (r.file as FileEntry) ?? (r as FileEntry);
  }

  async setFolder(group: string | undefined, id: string, patch: Partial<{ name: string; description: string; parent_id: string }>): Promise<FileEntry> {
    const r = await this.session.call("set_folder", { id, ...patch }, this.focus(group));
    this.invalidate(group);
    return (r.folder as FileEntry) ?? (r as FileEntry);
  }

  async quota(group?: string): Promise<FileQuota> {
    const r = await this.session.call("get_state", {}, this.focus(group));
    return r as FileQuota;
  }
}

/** Lightweight helper: build a parent → children map from a flat entry list. */
export function buildFileTree(entries: FileEntry[]): Map<string, FileEntry[]> {
  const byParent = new Map<string, FileEntry[]>();
  for (const e of entries) {
    const arr = byParent.get(e.parent_id) ?? [];
    arr.push(e);
    byParent.set(e.parent_id, arr);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name, "de", { sensitivity: "base" });
    });
  }
  return byParent;
}

/**
 * LernSax has no first-class versioning API — every "version" of a file shows
 * up as an independent entry in the listing with the same `name` and
 * `parent_id`. This collapses such siblings into a single logical record so
 * the UI can show one row, with the latest as the active file and the rest
 * accessible via a "versions" affordance.
 */
export interface FileVersionGroup {
  /** The most recently created entry — what the row should represent. */
  current: FileEntry;
  /** All entries that share `(parent_id, name)`, newest first. Includes `current`. */
  versions: FileEntry[];
}
export function groupFileVersions(entries: FileEntry[]): FileVersionGroup[] {
  const folders = entries.filter((e) => e.type === "folder");
  const files = entries.filter((e) => e.type === "file");
  const buckets = new Map<string, FileEntry[]>();
  for (const f of files) {
    const k = `${f.parent_id}\x00${f.name}`;
    const arr = buckets.get(k) ?? [];
    arr.push(f);
    buckets.set(k, arr);
  }
  const groups: FileVersionGroup[] = [];
  for (const arr of buckets.values()) {
    arr.sort((a, b) => (b.created?.date ?? 0) - (a.created?.date ?? 0));
    groups.push({ current: arr[0]!, versions: arr });
  }
  // Folders aren't versioned — wrap each as a single-item group for uniform iteration.
  for (const f of folders) groups.push({ current: f, versions: [f] });
  return groups;
}

/** Walk parent chain from `id` to root. Returns the path entries from root → id. */
export function buildFileBreadcrumb(entries: FileEntry[], id: string): FileEntry[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const path: FileEntry[] = [];
  let current = byId.get(id);
  while (current) {
    path.unshift(current);
    if (!current.parent_id || current.parent_id === current.id) break;
    current = byId.get(current.parent_id);
  }
  return path;
}
