import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  SessionCache,
  describeDaVinci,
  expandDaVinciDays,
  personalFilter,
  type Credentials,
  type DaVinciEntry,
  type LernSaxClient,
} from "@lernsax/core";
import { z } from "zod";
import { getHtml, getPayload, loadDaVinciConfig, userIdForEmail, type DaVinciConfig } from "./davinci.js";

// Email/password are optional on every tool: when the request arrives with
// an OAuth Bearer (resolved into `defaultCreds` by the HTTP transport), the
// caller doesn't need to repeat them per-call. They're still accepted for
// stdio mode and for one-off overrides.
const CredsShape = {
  email: z.string().email().optional().describe("LernSax email (omit when calling via OAuth bearer)"),
  password: z.string().min(1).optional().describe("LernSax password (omit when calling via OAuth bearer)"),
};

const idleMs = Number.parseInt(process.env.LERNSAX_MCP_IDLE_TTL_MS ?? "300000", 10);

export function defaultCache(): SessionCache {
  return new SessionCache({ idleTtlMs: idleMs });
}

export function buildServer(cache: SessionCache = defaultCache(), defaultCreds?: Credentials) {
  const server = new McpServer({
    name: "lernsax-mcp",
    version: "0.1.0",
  });

  const withClient = async <T>(creds: { email?: string; password?: string }, fn: (c: LernSaxClient) => Promise<T>): Promise<T> => {
    const resolved: Credentials | undefined = creds.email && creds.password
      ? { email: creds.email, password: creds.password }
      : defaultCreds;
    if (!resolved) throw new Error("Credentials required — provide email+password or call via an authorized OAuth bearer.");
    const client = await cache.get(resolved);
    return fn(client);
  };

  const ok = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  });

  // Inline base64 file content as an embedded resource block (plus a text
  // summary so the model has the name/size context).
  const MIME_BY_EXT: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    txt: "text/plain",
    csv: "text/csv",
    json: "application/json",
    zip: "application/zip",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  const mimeForName = (name: string): string => {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    return MIME_BY_EXT[ext] ?? "application/octet-stream";
  };
  const fileResult = (id: string, name: string, size: number, base64: string) => ({
    content: [
      { type: "text" as const, text: JSON.stringify({ name, size }, null, 2) },
      {
        type: "resource" as const,
        resource: { uri: `lernsax://file/${id}`, mimeType: mimeForName(name), blob: base64 },
      },
    ],
  });

  // ─── Meta ────────────────────────────────────────────────────────────────
  server.tool(
    "whoami",
    "Return the logged-in user's profile (name, email, group memberships).",
    CredsShape,
    async (creds) => withClient(creds, async (c) => ok({ user: c.whoami(), groups: c.groups() })),
  );

  server.tool(
    "groups_list",
    "List all groups, classes, and rooms the user is a member of.",
    CredsShape,
    async (creds) => withClient(creds, async (c) => ok(c.groups())),
  );

  // ─── Mail ────────────────────────────────────────────────────────────────
  server.tool(
    "mail_folders",
    "List all mail folders (inbox, sent, drafts, custom).",
    CredsShape,
    async (creds) => withClient(creds, async (c) => ok(await c.mail.getFolders())),
  );

  server.tool(
    "mail_list",
    "List messages in a folder.",
    {
      ...CredsShape,
      folder_id: z.string(),
      limit: z.number().int().positive().max(200).optional(),
      offset: z.number().int().min(0).optional(),
      is_unread: z.boolean().optional(),
      search: z.string().optional(),
    },
    async ({ email, password, ...rest }) =>
      withClient({ email, password }, async (c) => ok(await c.mail.getMessages(rest))),
  );

  server.tool(
    "mail_read",
    "Read one mail in full (body + attachment metadata).",
    { ...CredsShape, folder_id: z.string(), message_id: z.string() },
    async ({ email, password, folder_id, message_id }) =>
      withClient({ email, password }, async (c) => ok(await c.mail.readMessage(folder_id, message_id))),
  );

  server.tool(
    "mail_send",
    "Send a mail. `to` is a comma-separated list. Pass `reply_id`/`forward_id` to reply to or forward an existing message, and `attachments` (base64) to attach files.",
    {
      ...CredsShape,
      to: z.string(),
      subject: z.string(),
      body_plain: z.string().optional(),
      body_html: z.string().optional(),
      cc: z.string().optional(),
      bcc: z.string().optional(),
      reply_id: z.string().optional(),
      forward_id: z.string().optional(),
      attachments: z
        .array(z.object({ name: z.string(), data_base64: z.string() }))
        .optional()
        .describe("Files to attach, base64-encoded."),
    },
    async ({ email, password, attachments, ...rest }) =>
      withClient({ email, password }, async (c) => {
        const import_session_files: string[] = [];
        for (const att of attachments ?? []) {
          import_session_files.push(await c.mail.addSessionFile(att.name, att.data_base64));
        }
        return ok(
          await c.mail.sendMail(
            import_session_files.length ? { ...rest, import_session_files } : rest,
          ),
        );
      }),
  );

  server.tool(
    "mail_save_draft",
    "Save a mail to the Drafts folder. Note: LernSax only supports CREATING drafts — there is no in-place update, so each call adds a new draft (delete the old one via mail_delete if replacing). Returns an empty body (no draft id).",
    {
      ...CredsShape,
      to: z.string().optional(),
      cc: z.string().optional(),
      bcc: z.string().optional(),
      subject: z.string().optional(),
      body_plain: z.string().optional(),
      body_html: z.string().optional(),
    },
    async ({ email, password, ...rest }) =>
      withClient({ email, password }, async (c) => ok(await c.mail.saveDraft(rest))),
  );

  server.tool(
    "mail_flag",
    "Mark a mail read/unread/flagged.",
    {
      ...CredsShape,
      folder_id: z.string(),
      message_id: z.string(),
      is_unread: z.boolean().optional(),
      is_flagged: z.boolean().optional(),
    },
    async ({ email, password, ...rest }) =>
      withClient({ email, password }, async (c) => {
        await c.mail.setMessage(rest);
        return ok({ ok: true });
      }),
  );

  server.tool(
    "mail_move",
    "Move a mail to another folder.",
    { ...CredsShape, folder_id: z.string(), message_id: z.string(), target_folder_id: z.string() },
    async ({ email, password, folder_id, message_id, target_folder_id }) =>
      withClient({ email, password }, async (c) => {
        await c.mail.moveMessage(folder_id, message_id, target_folder_id);
        return ok({ ok: true });
      }),
  );

  server.tool(
    "mail_delete",
    "Delete a mail.",
    { ...CredsShape, folder_id: z.string(), message_id: z.string() },
    async ({ email, password, folder_id, message_id }) =>
      withClient({ email, password }, async (c) => {
        await c.mail.deleteMessage(folder_id, message_id);
        return ok({ ok: true });
      }),
  );

  // ─── Tasks ───────────────────────────────────────────────────────────────
  server.tool(
    "tasks_list",
    "List tasks. Omit `group` for personal scope; otherwise group login or human-readable name.",
    { ...CredsShape, group: z.string().optional(), include_completed: z.boolean().default(false) },
    async ({ email, password, group, include_completed }) =>
      withClient({ email, password }, async (c) => {
        let entries = await c.tasks.list(group);
        if (!include_completed) entries = entries.filter((e) => !e.completed);
        return ok(entries);
      }),
  );

  server.tool(
    "tasks_create",
    "Create a task.",
    {
      ...CredsShape,
      group: z.string().optional(),
      title: z.string(),
      description: z.string().optional(),
      start_date: z.number().int().optional(),
      due_date: z.number().int().optional(),
    },
    async ({ email, password, group, ...entry }) =>
      withClient({ email, password }, async (c) => ok(await c.tasks.create(group, entry))),
  );

  server.tool(
    "tasks_update",
    "Update a task.",
    {
      ...CredsShape,
      group: z.string().optional(),
      id: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      start_date: z.number().int().optional(),
      due_date: z.number().int().optional(),
      completed: z.boolean().optional(),
    },
    async ({ email, password, group, id, ...patch }) =>
      withClient({ email, password }, async (c) => ok(await c.tasks.update(group, id, patch))),
  );

  server.tool(
    "tasks_delete",
    "Delete a task.",
    { ...CredsShape, group: z.string().optional(), id: z.string() },
    async ({ email, password, group, id }) =>
      withClient({ email, password }, async (c) => {
        await c.tasks.remove(group, id);
        return ok({ ok: true });
      }),
  );

  // ─── Calendar ────────────────────────────────────────────────────────────
  server.tool(
    "calendar_list",
    "List all calendar entries for the focus (filter client-side by start_date).",
    {
      ...CredsShape,
      group: z.string().optional(),
    },
    async ({ email, password, group }) =>
      withClient({ email, password }, async (c) => ok(await c.calendar.list({ group }))),
  );

  server.tool(
    "calendar_holidays",
    "List holidays / superior calendar entries (Ferien, Feiertage).",
    CredsShape,
    async (creds) => withClient(creds, async (c) => ok(await c.calendar.holidays())),
  );

  server.tool(
    "calendar_create",
    "Create a calendar entry. Times are unix seconds.",
    {
      ...CredsShape,
      group: z.string().optional(),
      title: z.string(),
      start_date: z.number().int(),
      end_date: z.number().int(),
      description: z.string().optional(),
      location: z.string().optional(),
      is_all_day: z.union([z.literal(0), z.literal(1)]).optional(),
      rrule: z.string().optional(),
    },
    async ({ email, password, group, ...entry }) =>
      withClient({ email, password }, async (c) => ok(await c.calendar.create(group, entry))),
  );

  server.tool(
    "calendar_update",
    "Update a calendar entry.",
    {
      ...CredsShape,
      group: z.string().optional(),
      id: z.string(),
      title: z.string().optional(),
      start_date: z.number().int().optional(),
      end_date: z.number().int().optional(),
      description: z.string().optional(),
      location: z.string().optional(),
      is_all_day: z.union([z.literal(0), z.literal(1)]).optional(),
      rrule: z.string().optional(),
    },
    async ({ email, password, group, id, ...patch }) =>
      withClient({ email, password }, async (c) => ok(await c.calendar.update(group, id, patch))),
  );

  server.tool(
    "calendar_delete",
    "Delete a calendar entry.",
    { ...CredsShape, group: z.string().optional(), id: z.string() },
    async ({ email, password, group, id }) =>
      withClient({ email, password }, async (c) => {
        await c.calendar.remove(group, id);
        return ok({ ok: true });
      }),
  );

  // ─── Board / Mitteilungen ───────────────────────────────────────────────
  const boardKind = z.enum(["general", "teacher", "pupil"]).default("general");

  server.tool(
    "board_list",
    "List board posts in a group.",
    { ...CredsShape, group: z.string(), kind: boardKind },
    async ({ email, password, group, kind }) =>
      withClient({ email, password }, async (c) => ok(await c.board.list(group, kind))),
  );

  server.tool(
    "board_post",
    "Post to a group board.",
    {
      ...CredsShape,
      group: z.string(),
      kind: boardKind,
      title: z.string(),
      text: z.string(),
      color: z.number().int().min(0).max(7).optional(),
      delete_date: z.number().int().optional(),
    },
    async ({ email, password, group, kind, ...entry }) =>
      withClient({ email, password }, async (c) => ok(await c.board.post(group, entry, kind))),
  );

  server.tool(
    "board_update",
    "Edit a board post.",
    {
      ...CredsShape,
      group: z.string(),
      kind: boardKind,
      id: z.string(),
      title: z.string().optional(),
      text: z.string().optional(),
      color: z.number().int().min(0).max(7).optional(),
      delete_date: z.number().int().optional(),
    },
    async ({ email, password, group, kind, id, ...patch }) =>
      withClient({ email, password }, async (c) => ok(await c.board.update(group, id, patch, kind))),
  );

  server.tool(
    "board_delete",
    "Delete a board post.",
    { ...CredsShape, group: z.string(), kind: boardKind, id: z.string() },
    async ({ email, password, group, kind, id }) =>
      withClient({ email, password }, async (c) => {
        await c.board.remove(group, id, kind);
        return ok({ ok: true });
      }),
  );

  // ─── Notes ──────────────────────────────────────────────────────────────
  server.tool(
    "notes_list",
    "List notes.",
    { ...CredsShape, group: z.string().optional() },
    async ({ email, password, group }) =>
      withClient({ email, password }, async (c) => ok(await c.notes.list(group))),
  );
  server.tool(
    "notes_create",
    "Create a note.",
    { ...CredsShape, group: z.string().optional(), title: z.string().optional(), text: z.string(), color: z.number().int().min(0).max(7).optional().describe("Farbindex 0–7 (0 = Standard), kein Farbname.") },
    async ({ email, password, group, ...entry }) =>
      withClient({ email, password }, async (c) => ok(await c.notes.create(group, entry))),
  );
  server.tool(
    "notes_update",
    "Edit a note.",
    { ...CredsShape, group: z.string().optional(), id: z.string(), title: z.string().optional(), text: z.string().optional(), color: z.number().int().min(0).max(7).optional().describe("Farbindex 0–7 (0 = Standard), kein Farbname.") },
    async ({ email, password, group, id, ...patch }) =>
      withClient({ email, password }, async (c) => ok(await c.notes.update(group, id, patch))),
  );
  server.tool(
    "notes_delete",
    "Delete a note.",
    { ...CredsShape, group: z.string().optional(), id: z.string() },
    async ({ email, password, group, id }) =>
      withClient({ email, password }, async (c) => {
        await c.notes.remove(group, id);
        return ok({ ok: true });
      }),
  );

  // ─── Messenger / Quickmessage ───────────────────────────────────────────
  server.tool(
    "chat_users",
    "List messenger contacts.",
    { ...CredsShape, only_online: z.boolean().default(false) },
    async ({ email, password, only_online }) =>
      withClient({ email, password }, async (c) => ok(await c.messenger.users(only_online))),
  );
  server.tool(
    "chat_send",
    "Send a quick message to a user.",
    { ...CredsShape, to_login: z.string(), text: z.string() },
    async ({ email, password, to_login, text }) =>
      withClient({ email, password }, async (c) => {
        await c.messenger.send(to_login, text);
        return ok({ ok: true });
      }),
  );
  server.tool(
    "chat_history",
    "Fetch message history.",
    // Kein `group_by_chat`: das kennt `get_history` nicht, und weil es hier mit
    // `.default(true)` immer mitgeschickt wurde, hat der Server jeden Aufruf
    // abgelehnt — das Tool war damit dauerhaft kaputt.
    { ...CredsShape, start_id: z.number().int().optional() },
    async ({ email, password, ...rest }) =>
      withClient({ email, password }, async (c) => ok(await c.messenger.history(rest))),
  );
  server.tool(
    "chat_read",
    "Read pending unread quick messages.",
    CredsShape,
    async (creds) => withClient(creds, async (c) => ok(await c.messenger.readUnread())),
  );

  // ─── Files ──────────────────────────────────────────────────────────────
  server.tool(
    "files_list",
    "List files in a folder.",
    {
      ...CredsShape,
      group: z.string().optional(),
      folder_id: z.string().optional(),
      recursive: z.boolean().default(false),
      search: z.string().optional(),
    },
    async ({ email, password, ...rest }) =>
      withClient({ email, password }, async (c) => ok(await c.files.list(rest))),
  );

  server.tool(
    "files_download_url",
    "Get a temporary direct-download URL for a file.",
    { ...CredsShape, group: z.string().optional(), id: z.string() },
    async ({ email, password, group, id }) =>
      withClient({ email, password }, async (c) => ok({ url: await c.files.downloadUrl(group, id) })),
  );

  server.tool(
    "files_download",
    "Download a file inline as base64 (embedded resource). Files larger than ~6MB are not inlined — use files_download_url instead.",
    { ...CredsShape, group: z.string().optional(), id: z.string() },
    async ({ email, password, group, id }) =>
      withClient({ email, password }, async (c) => {
        const { name, size, data } = await c.files.download(group, id);
        // Avoid blowing up the response with huge base64 payloads.
        if (Math.max(size, data.length) > 6 * 1024 * 1024) {
          const url = await c.files.downloadUrl(group, id);
          return ok({
            name,
            size,
            note: "File too large to inline — fetch it via this direct-download URL.",
            url,
          });
        }
        const base64 = Buffer.from(data).toString("base64");
        return fileResult(id, name, size, base64);
      }),
  );

  server.tool(
    "files_upload",
    "Upload a small (<5MB) base64-encoded file. For larger uploads use WebDAV directly.",
    {
      ...CredsShape,
      group: z.string().optional(),
      folder_id: z.string(),
      name: z.string(),
      data_base64: z.string(),
      description: z.string().optional(),
    },
    async ({ email, password, group, folder_id, name, data_base64, description }) =>
      withClient({ email, password }, async (c) =>
        ok(await c.files.upload({ group, folder_id, name, data: data_base64, description })),
      ),
  );

  server.tool(
    "files_mkdir",
    "Create a folder.",
    { ...CredsShape, group: z.string().optional(), parent_id: z.string(), name: z.string() },
    async ({ email, password, group, parent_id, name }) =>
      withClient({ email, password }, async (c) => ok(await c.files.mkdir(group, parent_id, name))),
  );

  server.tool(
    "files_delete",
    "Delete a file.",
    { ...CredsShape, group: z.string().optional(), id: z.string() },
    async ({ email, password, group, id }) =>
      withClient({ email, password }, async (c) => {
        await c.files.remove(group, id);
        return ok({ ok: true });
      }),
  );

  server.tool(
    "files_rename",
    "Rename or move a file or folder. Pass `new_name` to rename and/or `new_parent_id` to move.",
    {
      ...CredsShape,
      group: z.string().optional(),
      id: z.string(),
      type: z.enum(["file", "folder"]).optional().describe("If omitted, both setFile and setFolder are tried."),
      new_name: z.string().optional(),
      new_parent_id: z.string().optional(),
      description: z.string().optional(),
    },
    async ({ email, password, group, id, type, new_name, new_parent_id, description }) =>
      withClient({ email, password }, async (c) => {
        if (!new_name && !new_parent_id && description === undefined) {
          throw new Error("Provide at least one of new_name, new_parent_id, description");
        }
        const patch: Partial<{ name: string; description: string; parent_id: string }> = {};
        if (new_name) patch.name = new_name;
        if (new_parent_id) patch.parent_id = new_parent_id;
        if (description !== undefined) patch.description = description;
        if (type === "folder") return ok(await c.files.setFolder(group, id, patch));
        if (type === "file") return ok(await c.files.setFile(group, id, patch));
        // Type unknown — try file first, fall back to folder.
        try { return ok(await c.files.setFile(group, id, patch)); }
        catch { return ok(await c.files.setFolder(group, id, patch)); }
      }),
  );

  server.tool(
    "files_quota",
    "Get used/limit storage quota.",
    { ...CredsShape, group: z.string().optional() },
    async ({ email, password, group }) =>
      withClient({ email, password }, async (c) => ok(await c.files.quota(group))),
  );

  // ─── Notifications / messages ───────────────────────────────────────────
  server.tool(
    "notifications_list",
    "List system notifications (Mitteilungen).",
    CredsShape,
    async (creds) => withClient(creds, async (c) => ok(await c.notifications.list())),
  );
  server.tool(
    "notifications_dismiss",
    "Dismiss a notification.",
    { ...CredsShape, id: z.string() },
    async ({ email, password, id }) =>
      withClient({ email, password }, async (c) => {
        await c.notifications.dismiss(id);
        return ok({ ok: true });
      }),
  );

  // ─── Profile / Addresses / Forum / Wiki / Members / Resources ────────────
  server.tool(
    "profile_get",
    "Get a profile (own if `login` omitted).",
    { ...CredsShape, login: z.string().optional() },
    async ({ email, password, login }) =>
      withClient({ email, password }, async (c) => ok(await c.profile.get(login))),
  );

  server.tool(
    "addresses_list",
    "List address book entries.",
    { ...CredsShape, group: z.string().optional() },
    async ({ email, password, group }) =>
      withClient({ email, password }, async (c) => ok(await c.addresses.list(group))),
  );

  server.tool(
    "forum_list",
    "List forum threads in a group.",
    { ...CredsShape, group: z.string(), parent_id: z.string().optional() },
    async ({ email, password, group, parent_id }) =>
      withClient({ email, password }, async (c) => ok(await c.forum.list(group, parent_id))),
  );

  server.tool(
    "forum_post",
    "Post a forum entry.",
    { ...CredsShape, group: z.string(), title: z.string(), text: z.string(), parent_id: z.string().optional().describe("Elternbeitrag; weglassen für ein neues Thema."), icon: z.number().int().min(0).max(5).optional().describe("Symbol des Beitrags, 0–5 (Standard 0).") },
    async ({ email, password, group, ...entry }) =>
      withClient({ email, password }, async (c) => ok(await c.forum.post(group, entry))),
  );

  server.tool(
    "wiki_list",
    "List wiki pages in a group.",
    { ...CredsShape, group: z.string() },
    async ({ email, password, group }) =>
      withClient({ email, password }, async (c) => ok(await c.wiki.list(group))),
  );

  server.tool(
    "wiki_read",
    "Read a wiki page.",
    { ...CredsShape, group: z.string(), id: z.string() },
    async ({ email, password, group, id }) =>
      withClient({ email, password }, async (c) => ok(await c.wiki.page(group, id))),
  );

  server.tool(
    "wiki_create",
    "Create a wiki page.",
    { ...CredsShape, group: z.string(), title: z.string(), text: z.string() },
    async ({ email, password, group, title, text }) =>
      withClient({ email, password }, async (c) => ok(await c.wiki.create(group, { title, text }))),
  );

  server.tool(
    "wiki_update",
    "Update a wiki page.",
    { ...CredsShape, group: z.string(), id: z.string(), title: z.string().optional(), text: z.string().optional() },
    async ({ email, password, group, id, title, text }) =>
      withClient({ email, password }, async (c) => ok(await c.wiki.update(group, id, { title, text }))),
  );

  server.tool(
    "wiki_delete",
    "Delete a wiki page.",
    { ...CredsShape, group: z.string(), id: z.string() },
    async ({ email, password, group, id }) =>
      withClient({ email, password }, async (c) => {
        await c.wiki.remove(group, id);
        return ok({ ok: true });
      }),
  );

  server.tool(
    "members_list",
    "List members of a group/room.",
    { ...CredsShape, group: z.string() },
    async ({ email, password, group }) =>
      withClient({ email, password }, async (c) => ok(await c.members.users(group))),
  );

  server.tool(
    "members_broadcast",
    "Broadcast a quick message to all members of a group.",
    { ...CredsShape, group: z.string(), text: z.string() },
    async ({ email, password, group, text }) =>
      withClient({ email, password }, async (c) => {
        await c.members.broadcast(group, text);
        return ok({ ok: true });
      }),
  );

  server.tool(
    "resources_list",
    "List bookable resources in a group.",
    { ...CredsShape, group: z.string() },
    async ({ email, password, group }) =>
      withClient({ email, password }, async (c) => ok(await c.resources.list(group))),
  );

  server.tool(
    "resources_bookings",
    "List resource bookings in a window.",
    {
      ...CredsShape,
      group: z.string(),
      start: z.number().int().optional(),
      end: z.number().int().optional(),
      resource_id: z.string().optional(),
    },
    async ({ email, password, group, ...rest }) =>
      withClient({ email, password }, async (c) => ok(await c.resources.bookings(group, rest))),
  );

  server.tool(
    "resources_book",
    "Book a resource.",
    {
      ...CredsShape,
      group: z.string(),
      resource_id: z.string(),
      start: z.number().int(),
      end: z.number().int(),
      title: z.string().optional(),
    },
    async ({ email, password, group, ...rest }) =>
      withClient({ email, password }, async (c) => ok(await c.resources.book(group, rest))),
  );

  // ─── Stundenplan (DaVinci) ──────────────────────────────────────────────
  //
  // Not a LernSax feature: the timetable lives on a school-run DaVinci server
  // whose endpoint and login the user configured in the web app. We read that
  // stored config rather than asking for it per call — there is no sensible
  // way for a chat client to know a school's InfoServer URL.

  /** ISO date in the server's local timezone — the plan is a wall-clock artefact. */
  const todayIso = (): string => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  };
  const addDays = (iso: string, n: number): string => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const mondayOf = (iso: string): string => {
    const d = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return mondayOf(todayIso());
    // getUTCDay: 0 = Sunday, which belongs to the week that started 6 days ago.
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  /**
   * The week to answer with when the caller named no dates.
   *
   * On a weekend the running week is spent — "what does my week look like",
   * asked on a Saturday, is about the days ahead, not the ones already gone.
   * Same rule as the web UI, so both agree on what "this week" means.
   */
  const defaultWeekStart = (): string => {
    const today = todayIso();
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
    if (dow === 6) return addDays(today, 2);
    if (dow === 0) return addDays(today, 1);
    return mondayOf(today);
  };

  /** Resolve the calling identity to the stored timetable config, or explain why not. */
  const withTimetable = <T>(
    creds: { email?: string; password?: string },
    fn: (ctx: { user_id: string; cfg: DaVinciConfig }) => Promise<T>,
  ): Promise<T> => {
    const email = creds.email && creds.password ? creds.email : defaultCreds?.email;
    if (!email) {
      throw new Error("Credentials required — provide email+password or call via an authorized OAuth bearer.");
    }
    const user_id = userIdForEmail(email);
    const cfg = loadDaVinciConfig(user_id);
    if (!cfg) {
      throw new Error(
        "Kein Stundenplan hinterlegt. Der Zugang wird in der Weboberfläche unter Einstellungen → Stundenplan eingerichtet.",
      );
    }
    return fn({ user_id, cfg });
  };

  server.tool(
    "timetable_info",
    "Describe the configured timetable (DaVinci) source: kind of publication, validity window, and which class/teacher the plan is filtered to.",
    CredsShape,
    async (creds) =>
      withTimetable(creds, async ({ user_id, cfg }) => {
        if (cfg.sourceType === "html") {
          const res = await getHtml(user_id, cfg);
          return ok({
            source_type: "html",
            endpoint: cfg.endpoint,
            generated_at: res.generatedAt ?? null,
            class_code: cfg.classCode ?? null,
            teacher_code: cfg.teacherCode ?? null,
            dates: [...new Set(res.entries.map((e) => e.date))].sort(),
            entry_count: res.entries.length,
            fetched_at: new Date(res.fetchedAt).toISOString(),
          });
        }
        const res = await getPayload(user_id, cfg);
        const auto = personalFilter(res.payload);
        return ok({
          source_type: "infoserver",
          endpoint: cfg.endpoint,
          info: describeDaVinci(res.payload),
          class_code: cfg.classCode || (auto?.type === "class" ? auto.code : null),
          teacher_code: cfg.teacherCode || (auto?.type === "teacher" ? auto.code : null),
          filter_source: cfg.classCode || cfg.teacherCode ? "settings" : auto ? "server-identity" : "none",
          include_supervisions: cfg.includeSupervisions ?? false,
          fetched_at: new Date(res.fetchedAt).toISOString(),
        });
      }),
  );

  server.tool(
    "timetable_get",
    "Read the timetable / substitution plan for a date range. Defaults to the current week (Monday–Sunday); on Saturdays and Sundays it defaults to the coming week instead. Entries carry the effective teachers and rooms with substitutions already folded in; `change` marks anything deviating from the regular plan (cancelled, substituted, moved, extra).",
    {
      ...CredsShape,
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
        .describe("Inclusive start date, YYYY-MM-DD. Default: Monday of the current week — or of the coming week when asked on a Saturday or Sunday, since the running week is already spent."),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
        .describe("Inclusive end date, YYYY-MM-DD. Default: `from` + 6 days."),
      class_code: z.string().optional().describe("Override the class configured in Settings."),
      teacher_code: z.string().optional().describe("Override the teacher short code configured in Settings."),
      room_code: z.string().optional().describe("Keep only lessons in this room."),
      changes_only: z.boolean().optional().describe("Return only entries that deviate from the regular plan."),
    },
    async ({ email, password, from, to, class_code, teacher_code, room_code, changes_only }) =>
      withTimetable({ email, password }, async ({ user_id, cfg }) => {
        const start = from ?? defaultWeekStart();
        const end = to ?? addDays(start, 6);
        if (end < start) throw new Error("`to` liegt vor `from`.");

        let entries: DaVinciEntry[];
        let classCode = class_code ?? cfg.classCode;
        let teacherCode = teacher_code ?? cfg.teacherCode;
        let notes: Record<string, string> = {};
        let fetchedAt: number;

        if (cfg.sourceType === "html") {
          // A published export carries no login, so nobody can identify us —
          // the class has to come from the stored config or from the call.
          const res = await getHtml(user_id, cfg);
          fetchedAt = res.fetchedAt;
          notes = Object.fromEntries(
            Object.entries(res.notes).filter(([d]) => d >= start && d <= end),
          );
          entries = res.entries.filter(
            (e) => e.date >= start && e.date <= end
              && (!classCode || e.classes.includes(classCode))
              && (!teacherCode || e.teachers.includes(teacherCode)
                || (e.change?.absentTeachers ?? []).includes(teacherCode))
              && (!room_code || e.rooms.includes(room_code)),
          );
        } else {
          const res = await getPayload(user_id, cfg);
          fetchedAt = res.fetchedAt;
          // An explicit pick wins; otherwise fall back to whatever object the
          // server tied our login to.
          const auto = personalFilter(res.payload);
          classCode = classCode || (auto?.type === "class" ? auto.code : undefined);
          teacherCode = teacherCode || (auto?.type === "teacher" ? auto.code : undefined);
          entries = expandDaVinciDays(res.payload, {
            from: start,
            to: end,
            classCode,
            teacherCode,
            roomCode: room_code,
            includeSupervisions: cfg.includeSupervisions ?? false,
          });
        }

        if (changes_only) entries = entries.filter((e) => !!e.change);
        entries.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));

        return ok({
          from: start,
          to: end,
          source_type: cfg.sourceType ?? "infoserver",
          filter: { class_code: classCode ?? null, teacher_code: teacherCode ?? null, room_code: room_code ?? null },
          fetched_at: new Date(fetchedAt).toISOString(),
          day_notes: notes,
          count: entries.length,
          entries,
        });
      }),
  );

  // ─── Raw escape hatch ───────────────────────────────────────────────────
  server.tool(
    "raw_call",
    "Escape hatch — call any LernSax JSON-RPC method directly. Use when no dedicated tool fits.",
    {
      ...CredsShape,
      method: z.string(),
      params: z.record(z.unknown()).optional(),
      focus_object: z.string().optional(),
      focus_login: z.string().optional(),
    },
    async ({ email, password, method, params, focus_object, focus_login }) =>
      withClient({ email, password }, async (c) => {
        const focus = focus_object
          ? { object: focus_object as never, login: focus_login }
          : undefined;
        const r = await c.session.call(method, params ?? {}, focus);
        return ok(r);
      }),
  );

  return { server, cache };
}
