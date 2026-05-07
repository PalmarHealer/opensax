import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { buildFileBreadcrumb, buildFileTree, groupFileVersions, type FileEntry } from "@lernsax/core";

export const load: PageServerLoad = async ({ locals, url }) => {
  const c = locals.client!;
  const group = url.searchParams.get("group") || undefined;
  const folderId = url.searchParams.get("folder") || "/";
  const fileId = url.searchParams.get("file");

  let entries: FileEntry[] = [];
  let permissionError: string | null = null;
  try {
    entries = await c.files.list({ group });
  } catch (e) {
    permissionError = (e as Error).message;
  }
  const tree = buildFileTree(entries);
  const childEntries = tree.get(folderId) ?? [];
  // Collapse versioned siblings — LernSax stores each version as a separate
  // entry; we want the row count to match human expectations.
  const groups = groupFileVersions(childEntries);
  // Flatten back into a "children" shape: each row is the current entry,
  // augmented with its sibling versions for the context menu's Versions panel.
  const children = groups.map((g) => ({
    ...g.current,
    versions: g.versions.map((v) => ({
      id: v.id,
      name: v.name,
      size: v.size,
      created: v.created,
      modified: v.modified,
      effective: v.effective,
    })),
  }));
  const breadcrumb = buildFileBreadcrumb(entries, folderId);

  let file: FileEntry | null = null;
  if (fileId) {
    file = entries.find((e) => e.id === fileId && e.type === "file") ?? null;
  }

  let quota = {};
  try {
    quota = await c.files.quota(group);
  } catch { /* not all groups expose quota */ }

  return {
    group: group ?? null,
    folderId,
    breadcrumb,
    children,
    file,
    quota,
    permissionError,
  };
};

const groupFromForm = (data: FormData): string | undefined =>
  data.get("group")?.toString() || undefined;

export const actions: Actions = {
  mkdir: async ({ locals, request }) => {
    const c = locals.client!;
    const data = await request.formData();
    const name = data.get("name")?.toString().trim();
    const folder_id = data.get("parent_id")?.toString() || "/";
    if (!name) return fail(400, { error: "name required" });
    try {
      await c.files.mkdir(groupFromForm(data), folder_id, name);
    } catch (e) {
      return fail(403, { error: (e as Error).message });
    }
    return { ok: true };
  },
  rename: async ({ locals, request }) => {
    const c = locals.client!;
    const data = await request.formData();
    const id = data.get("id")?.toString();
    const name = data.get("name")?.toString().trim();
    const type = data.get("type")?.toString();
    if (!id || !name) return fail(400, { error: "id+name required" });
    try {
      if (type === "folder") await c.files.setFolder(groupFromForm(data), id, { name });
      else await c.files.setFile(groupFromForm(data), id, { name });
    } catch (e) {
      return fail(403, { error: (e as Error).message });
    }
    return { ok: true };
  },
  remove: async ({ locals, request }) => {
    const c = locals.client!;
    const data = await request.formData();
    const id = data.get("id")?.toString();
    const type = data.get("type")?.toString();
    if (!id) return fail(400, { error: "id required" });
    try {
      // Folders may have contents — `rmrf` walks the tree and deletes leaves
      // first. For files this is a single delete_file call.
      if (type === "folder") await c.files.rmrf(groupFromForm(data), id);
      else await c.files.remove(groupFromForm(data), id);
    } catch (e) {
      return fail(403, { error: (e as Error).message });
    }
    return { ok: true };
  },
  upload: async ({ locals, request }) => {
    const c = locals.client!;
    const data = await request.formData();
    const folder_id = data.get("parent_id")?.toString() || "/";
    const files = data.getAll("file").filter((f): f is File => f instanceof File);
    if (files.length === 0) return fail(400, { error: "file required" });
    const group = groupFromForm(data);
    try {
      for (const file of files) {
        const buf = new Uint8Array(await file.arrayBuffer());
        const b64 = Buffer.from(buf).toString("base64");
        await c.files.upload({ group, folder_id, name: file.name, data: b64 });
      }
    } catch (e) {
      return fail(403, { error: (e as Error).message });
    }
    return { ok: true };
  },
};
