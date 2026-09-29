/**
 * The one list of operations OpenSax exposes to programs.
 *
 * Every entry is transport-neutral: a name, a description, a zod shape for its
 * arguments and a handler that gets a LernSax client from its context. The MCP
 * server (`server.ts`) registers each entry as a tool, the REST API (`rest.ts`)
 * mounts each one as `POST /api/v1/<name>`, and the OpenAPI document
 * (`openapi.ts`) is generated from the same shapes — so MCP, REST and the docs
 * can't drift apart.
 *
 * The tool name doubles as its scope: an API token lists the tools it may call,
 * and `lernsax` (what the MCP connector is granted) stands for all of them.
 */
import {
  describeDaVinci,
  expandDaVinciDays,
  personalFilter,
  type DaVinciEntry,
  type LernSaxClient,
} from "@lernsax/core";
import { z } from "zod";
import { getHtml, getPayload, loadDaVinciConfig, userIdForEmail, type DaVinciConfig } from "./davinci.js";

export interface ToolContext {
  /** Logged-in client for the calling account. */
  client(): Promise<LernSaxClient>;
  /** Email of the calling account; keys the timetable config. */
  email: string | undefined;
}

export type ToolResult =
  | { kind: "json"; data: unknown }
  | {
      kind: "file";
      id: string;
      name: string;
      size: number;
      data: Uint8Array;
      /** Direct-download link, for transports that won't inline large files. */
      url: () => Promise<string>;
    };

/**
 * A caller mistake the handler detected itself (missing config, contradictory
 * arguments). REST answers it with `status` instead of a 500.
 */
export class ToolInputError extends Error {
  constructor(message: string, public readonly status = 400, public readonly code = "invalid_arguments") {
    super(message);
    this.name = "ToolInputError";
  }
}

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  category: ToolCategory;
  /** True if the tool only reads. Drives the "read-only" preset for tokens. */
  readOnly: boolean;
  shape: S;
  run: (ctx: ToolContext, args: z.objectOutputType<S, z.ZodTypeAny>) => Promise<ToolResult>;
}

export const CATEGORIES = {
  account: "Konto",
  mail: "Mail",
  tasks: "Aufgaben",
  calendar: "Kalender",
  board: "Mitteilungen",
  notes: "Notizen",
  chat: "Messenger",
  files: "Dateien",
  notifications: "Benachrichtigungen",
  people: "Profil & Adressbuch",
  forum: "Forum",
  wiki: "Wiki",
  members: "Mitglieder",
  resources: "Ressourcen",
  timetable: "Stundenplan",
  advanced: "Erweitert",
} as const;
export type ToolCategory = keyof typeof CATEGORIES;

const ok = (data: unknown): ToolResult => ({ kind: "json", data });
const done = (): ToolResult => ok({ ok: true });

// Keeps each handler's `args` typed by its own shape while the list stays
// homogeneous.
const tool = <S extends z.ZodRawShape>(d: ToolDef<S>): ToolDef => d as unknown as ToolDef;

// ─── Stundenplan helpers ────────────────────────────────────────────────────

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

/**
 * Not a LernSax feature: the timetable lives on a school-run DaVinci server
 * whose endpoint and login the user configured in the web app. We read that
 * stored config rather than asking for it per call — there is no sensible
 * way for a chat client to know a school's InfoServer URL.
 */
const withTimetable = <T>(
  ctx: ToolContext,
  fn: (t: { user_id: string; cfg: DaVinciConfig }) => Promise<T>,
): Promise<T> => {
  if (!ctx.email) {
    throw new ToolInputError("Credentials required — provide email+password or call via an authorized OAuth bearer.", 401, "unauthenticated");
  }
  const user_id = userIdForEmail(ctx.email);
  const cfg = loadDaVinciConfig(user_id);
  if (!cfg) {
    throw new ToolInputError(
      "Kein Stundenplan hinterlegt. Der Zugang wird in der Weboberfläche unter Einstellungen → Stundenplan eingerichtet.",
      409,
      "not_configured",
    );
  }
  return fn({ user_id, cfg });
};

const boardKind = z.enum(["general", "teacher", "pupil"]).default("general");
const colorIndex = z.number().int().min(0).max(7).optional().describe("Farbindex 0–7 (0 = Standard), kein Farbname.");

export const TOOLS: readonly ToolDef[] = [
  // ─── Meta ────────────────────────────────────────────────────────────────
  tool({
    name: "whoami",
    description: "Return the logged-in user's profile (name, email, group memberships).",
    category: "account",
    readOnly: true,
    shape: {},
    run: async (ctx) => {
      const c = await ctx.client();
      return ok({ user: c.whoami(), groups: c.groups() });
    },
  }),
  tool({
    name: "groups_list",
    description: "List all groups, classes, and rooms the user is a member of.",
    category: "account",
    readOnly: true,
    shape: {},
    run: async (ctx) => ok((await ctx.client()).groups()),
  }),

  // ─── Mail ────────────────────────────────────────────────────────────────
  tool({
    name: "mail_folders",
    description: "List all mail folders (inbox, sent, drafts, custom).",
    category: "mail",
    readOnly: true,
    shape: {},
    run: async (ctx) => ok(await (await ctx.client()).mail.getFolders()),
  }),
  tool({
    name: "mail_list",
    description: "List messages in a folder.",
    category: "mail",
    readOnly: true,
    shape: {
      folder_id: z.string(),
      limit: z.number().int().positive().max(200).optional(),
      offset: z.number().int().min(0).optional(),
      is_unread: z.boolean().optional(),
      search: z.string().optional(),
    },
    run: async (ctx, args) => ok(await (await ctx.client()).mail.getMessages(args)),
  }),
  tool({
    name: "mail_read",
    description: "Read one mail in full (body + attachment metadata).",
    category: "mail",
    readOnly: true,
    shape: { folder_id: z.string(), message_id: z.string() },
    run: async (ctx, { folder_id, message_id }) =>
      ok(await (await ctx.client()).mail.readMessage(folder_id, message_id)),
  }),
  tool({
    name: "mail_send",
    description: "Send a mail. `to` is a comma-separated list. Pass `reply_id`/`forward_id` to reply to or forward an existing message, and `attachments` (base64) to attach files.",
    category: "mail",
    readOnly: false,
    shape: {
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
    run: async (ctx, { attachments, ...rest }) => {
      const c = await ctx.client();
      const import_session_files: string[] = [];
      for (const att of attachments ?? []) {
        import_session_files.push(await c.mail.addSessionFile(att.name, att.data_base64));
      }
      return ok(await c.mail.sendMail(import_session_files.length ? { ...rest, import_session_files } : rest));
    },
  }),
  tool({
    name: "mail_save_draft",
    description: "Save a mail to the Drafts folder. Note: LernSax only supports CREATING drafts — there is no in-place update, so each call adds a new draft (delete the old one via mail_delete if replacing). Returns an empty body (no draft id).",
    category: "mail",
    readOnly: false,
    shape: {
      to: z.string().optional(),
      cc: z.string().optional(),
      bcc: z.string().optional(),
      subject: z.string().optional(),
      body_plain: z.string().optional(),
      body_html: z.string().optional(),
    },
    run: async (ctx, args) => ok(await (await ctx.client()).mail.saveDraft(args)),
  }),
  tool({
    name: "mail_flag",
    description: "Mark a mail read/unread/flagged.",
    category: "mail",
    readOnly: false,
    shape: {
      folder_id: z.string(),
      message_id: z.string(),
      is_unread: z.boolean().optional(),
      is_flagged: z.boolean().optional(),
    },
    run: async (ctx, args) => {
      await (await ctx.client()).mail.setMessage(args);
      return done();
    },
  }),
  tool({
    name: "mail_move",
    description: "Move a mail to another folder.",
    category: "mail",
    readOnly: false,
    shape: { folder_id: z.string(), message_id: z.string(), target_folder_id: z.string() },
    run: async (ctx, { folder_id, message_id, target_folder_id }) => {
      await (await ctx.client()).mail.moveMessage(folder_id, message_id, target_folder_id);
      return done();
    },
  }),
  tool({
    name: "mail_delete",
    description: "Delete a mail.",
    category: "mail",
    readOnly: false,
    shape: { folder_id: z.string(), message_id: z.string() },
    run: async (ctx, { folder_id, message_id }) => {
      await (await ctx.client()).mail.deleteMessage(folder_id, message_id);
      return done();
    },
  }),

  // ─── Tasks ───────────────────────────────────────────────────────────────
  tool({
    name: "tasks_list",
    description: "List tasks. Omit `group` for personal scope; otherwise group login or human-readable name.",
    category: "tasks",
    readOnly: true,
    shape: { group: z.string().optional(), include_completed: z.boolean().default(false) },
    run: async (ctx, { group, include_completed }) => {
      let entries = await (await ctx.client()).tasks.list(group);
      if (!include_completed) entries = entries.filter((e) => !e.completed);
      return ok(entries);
    },
  }),
  tool({
    name: "tasks_create",
    description: "Create a task.",
    category: "tasks",
    readOnly: false,
    shape: {
      group: z.string().optional(),
      title: z.string(),
      description: z.string().optional(),
      start_date: z.number().int().optional(),
      due_date: z.number().int().optional(),
    },
    run: async (ctx, { group, ...entry }) => ok(await (await ctx.client()).tasks.create(group, entry)),
  }),
  tool({
    name: "tasks_update",
    description: "Update a task.",
    category: "tasks",
    readOnly: false,
    shape: {
      group: z.string().optional(),
      id: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      start_date: z.number().int().optional(),
      due_date: z.number().int().optional(),
      completed: z.boolean().optional(),
    },
    run: async (ctx, { group, id, ...patch }) => ok(await (await ctx.client()).tasks.update(group, id, patch)),
  }),
  tool({
    name: "tasks_delete",
    description: "Delete a task.",
    category: "tasks",
    readOnly: false,
    shape: { group: z.string().optional(), id: z.string() },
    run: async (ctx, { group, id }) => {
      await (await ctx.client()).tasks.remove(group, id);
      return done();
    },
  }),

  // ─── Calendar ────────────────────────────────────────────────────────────
  tool({
    name: "calendar_list",
    description: "List all calendar entries for the focus (filter client-side by start_date).",
    category: "calendar",
    readOnly: true,
    shape: { group: z.string().optional() },
    run: async (ctx, { group }) => ok(await (await ctx.client()).calendar.list({ group })),
  }),
  tool({
    name: "calendar_holidays",
    description: "List holidays / superior calendar entries (Ferien, Feiertage).",
    category: "calendar",
    readOnly: true,
    shape: {},
    run: async (ctx) => ok(await (await ctx.client()).calendar.holidays()),
  }),
  tool({
    name: "calendar_create",
    description: "Create a calendar entry. Times are unix seconds.",
    category: "calendar",
    readOnly: false,
    shape: {
      group: z.string().optional(),
      title: z.string(),
      start_date: z.number().int(),
      end_date: z.number().int(),
      description: z.string().optional(),
      location: z.string().optional(),
      is_all_day: z.union([z.literal(0), z.literal(1)]).optional(),
      rrule: z.string().optional(),
    },
    run: async (ctx, { group, ...entry }) => ok(await (await ctx.client()).calendar.create(group, entry)),
  }),
  tool({
    name: "calendar_update",
    description: "Update a calendar entry.",
    category: "calendar",
    readOnly: false,
    shape: {
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
    run: async (ctx, { group, id, ...patch }) => ok(await (await ctx.client()).calendar.update(group, id, patch)),
  }),
  tool({
    name: "calendar_delete",
    description: "Delete a calendar entry.",
    category: "calendar",
    readOnly: false,
    shape: { group: z.string().optional(), id: z.string() },
    run: async (ctx, { group, id }) => {
      await (await ctx.client()).calendar.remove(group, id);
      return done();
    },
  }),

  // ─── Board / Mitteilungen ───────────────────────────────────────────────
  tool({
    name: "board_list",
    description: "List board posts in a group.",
    category: "board",
    readOnly: true,
    shape: { group: z.string(), kind: boardKind },
    run: async (ctx, { group, kind }) => ok(await (await ctx.client()).board.list(group, kind)),
  }),
  tool({
    name: "board_post",
    description: "Post to a group board.",
    category: "board",
    readOnly: false,
    shape: {
      group: z.string(),
      kind: boardKind,
      title: z.string(),
      text: z.string(),
      color: z.number().int().min(0).max(7).optional(),
      delete_date: z.number().int().optional(),
    },
    run: async (ctx, { group, kind, ...entry }) => ok(await (await ctx.client()).board.post(group, entry, kind)),
  }),
  tool({
    name: "board_update",
    description: "Edit a board post.",
    category: "board",
    readOnly: false,
    shape: {
      group: z.string(),
      kind: boardKind,
      id: z.string(),
      title: z.string().optional(),
      text: z.string().optional(),
      color: z.number().int().min(0).max(7).optional(),
      delete_date: z.number().int().optional(),
    },
    run: async (ctx, { group, kind, id, ...patch }) => ok(await (await ctx.client()).board.update(group, id, patch, kind)),
  }),
  tool({
    name: "board_delete",
    description: "Delete a board post.",
    category: "board",
    readOnly: false,
    shape: { group: z.string(), kind: boardKind, id: z.string() },
    run: async (ctx, { group, kind, id }) => {
      await (await ctx.client()).board.remove(group, id, kind);
      return done();
    },
  }),

  // ─── Notes ──────────────────────────────────────────────────────────────
  tool({
    name: "notes_list",
    description: "List notes.",
    category: "notes",
    readOnly: true,
    shape: { group: z.string().optional() },
    run: async (ctx, { group }) => ok(await (await ctx.client()).notes.list(group)),
  }),
  tool({
    name: "notes_create",
    description: "Create a note.",
    category: "notes",
    readOnly: false,
    shape: { group: z.string().optional(), title: z.string().optional(), text: z.string(), color: colorIndex },
    run: async (ctx, { group, ...entry }) => ok(await (await ctx.client()).notes.create(group, entry)),
  }),
  tool({
    name: "notes_update",
    description: "Edit a note.",
    category: "notes",
    readOnly: false,
    shape: { group: z.string().optional(), id: z.string(), title: z.string().optional(), text: z.string().optional(), color: colorIndex },
    run: async (ctx, { group, id, ...patch }) => ok(await (await ctx.client()).notes.update(group, id, patch)),
  }),
  tool({
    name: "notes_delete",
    description: "Delete a note.",
    category: "notes",
    readOnly: false,
    shape: { group: z.string().optional(), id: z.string() },
    run: async (ctx, { group, id }) => {
      await (await ctx.client()).notes.remove(group, id);
      return done();
    },
  }),

  // ─── Messenger / Quickmessage ───────────────────────────────────────────
  tool({
    name: "chat_users",
    description: "List messenger contacts.",
    category: "chat",
    readOnly: true,
    shape: { only_online: z.boolean().default(false) },
    run: async (ctx, { only_online }) => ok(await (await ctx.client()).messenger.users(only_online)),
  }),
  tool({
    name: "chat_send",
    description: "Send a quick message to a user.",
    category: "chat",
    readOnly: false,
    shape: { to_login: z.string(), text: z.string() },
    run: async (ctx, { to_login, text }) => {
      await (await ctx.client()).messenger.send(to_login, text);
      return done();
    },
  }),
  tool({
    name: "chat_history",
    description: "Fetch message history.",
    category: "chat",
    readOnly: true,
    // Kein `group_by_chat`: das kennt `get_history` nicht, und weil es hier mit
    // `.default(true)` immer mitgeschickt wurde, hat der Server jeden Aufruf
    // abgelehnt — das Tool war damit dauerhaft kaputt.
    shape: { start_id: z.number().int().optional() },
    run: async (ctx, args) => ok(await (await ctx.client()).messenger.history(args)),
  }),
  tool({
    name: "chat_read",
    description: "Read pending unread quick messages.",
    category: "chat",
    // Reading marks the messages as read on LernSax's side.
    readOnly: false,
    shape: {},
    run: async (ctx) => ok(await (await ctx.client()).messenger.readUnread()),
  }),

  // ─── Files ──────────────────────────────────────────────────────────────
  tool({
    name: "files_list",
    description: "List files in a folder.",
    category: "files",
    readOnly: true,
    shape: {
      group: z.string().optional(),
      folder_id: z.string().optional(),
      recursive: z.boolean().default(false),
      search: z.string().optional(),
    },
    run: async (ctx, args) => ok(await (await ctx.client()).files.list(args)),
  }),
  tool({
    name: "files_download_url",
    description: "Get a temporary direct-download URL for a file.",
    category: "files",
    readOnly: true,
    shape: { group: z.string().optional(), id: z.string() },
    run: async (ctx, { group, id }) => ok({ url: await (await ctx.client()).files.downloadUrl(group, id) }),
  }),
  tool({
    name: "files_download",
    description: "Download a file. Over MCP it is inlined as base64 (embedded resource); files larger than ~6MB are not inlined there — use files_download_url instead. The REST API answers with the raw file.",
    category: "files",
    readOnly: true,
    shape: { group: z.string().optional(), id: z.string() },
    run: async (ctx, { group, id }) => {
      const c = await ctx.client();
      const { name, size, data } = await c.files.download(group, id);
      return { kind: "file", id, name, size, data, url: () => c.files.downloadUrl(group, id) };
    },
  }),
  tool({
    name: "files_upload",
    description: "Upload a small (<5MB) base64-encoded file. For larger uploads use WebDAV directly.",
    category: "files",
    readOnly: false,
    shape: {
      group: z.string().optional(),
      folder_id: z.string(),
      name: z.string(),
      data_base64: z.string(),
      description: z.string().optional(),
    },
    run: async (ctx, { group, folder_id, name, data_base64, description }) =>
      ok(await (await ctx.client()).files.upload({ group, folder_id, name, data: data_base64, description })),
  }),
  tool({
    name: "files_mkdir",
    description: "Create a folder.",
    category: "files",
    readOnly: false,
    shape: { group: z.string().optional(), parent_id: z.string(), name: z.string() },
    run: async (ctx, { group, parent_id, name }) => ok(await (await ctx.client()).files.mkdir(group, parent_id, name)),
  }),
  tool({
    name: "files_delete",
    description: "Delete a file.",
    category: "files",
    readOnly: false,
    shape: { group: z.string().optional(), id: z.string() },
    run: async (ctx, { group, id }) => {
      await (await ctx.client()).files.remove(group, id);
      return done();
    },
  }),
  tool({
    name: "files_rename",
    description: "Rename or move a file or folder. Pass `new_name` to rename and/or `new_parent_id` to move.",
    category: "files",
    readOnly: false,
    shape: {
      group: z.string().optional(),
      id: z.string(),
      type: z.enum(["file", "folder"]).optional().describe("If omitted, both setFile and setFolder are tried."),
      new_name: z.string().optional(),
      new_parent_id: z.string().optional(),
      description: z.string().optional(),
    },
    run: async (ctx, { group, id, type, new_name, new_parent_id, description }) => {
      if (!new_name && !new_parent_id && description === undefined) {
        throw new ToolInputError("Provide at least one of new_name, new_parent_id, description");
      }
      const c = await ctx.client();
      const patch: Partial<{ name: string; description: string; parent_id: string }> = {};
      if (new_name) patch.name = new_name;
      if (new_parent_id) patch.parent_id = new_parent_id;
      if (description !== undefined) patch.description = description;
      if (type === "folder") return ok(await c.files.setFolder(group, id, patch));
      if (type === "file") return ok(await c.files.setFile(group, id, patch));
      // Type unknown — try file first, fall back to folder.
      try { return ok(await c.files.setFile(group, id, patch)); }
      catch { return ok(await c.files.setFolder(group, id, patch)); }
    },
  }),
  tool({
    name: "files_quota",
    description: "Get used/limit storage quota.",
    category: "files",
    readOnly: true,
    shape: { group: z.string().optional() },
    run: async (ctx, { group }) => ok(await (await ctx.client()).files.quota(group)),
  }),

  // ─── Notifications / messages ───────────────────────────────────────────
  tool({
    name: "notifications_list",
    description: "List system notifications (Mitteilungen).",
    category: "notifications",
    readOnly: true,
    shape: {},
    run: async (ctx) => ok(await (await ctx.client()).notifications.list()),
  }),
  tool({
    name: "notifications_dismiss",
    description: "Dismiss a notification.",
    category: "notifications",
    readOnly: false,
    shape: { id: z.string() },
    run: async (ctx, { id }) => {
      await (await ctx.client()).notifications.dismiss(id);
      return done();
    },
  }),

  // ─── Profile / Addresses / Forum / Wiki / Members / Resources ────────────
  tool({
    name: "profile_get",
    description: "Get a profile (own if `login` omitted).",
    category: "people",
    readOnly: true,
    shape: { login: z.string().optional() },
    run: async (ctx, { login }) => ok(await (await ctx.client()).profile.get(login)),
  }),
  tool({
    name: "addresses_list",
    description: "List address book entries.",
    category: "people",
    readOnly: true,
    shape: { group: z.string().optional() },
    run: async (ctx, { group }) => ok(await (await ctx.client()).addresses.list(group)),
  }),
  tool({
    name: "forum_list",
    description: "List forum threads in a group.",
    category: "forum",
    readOnly: true,
    shape: { group: z.string(), parent_id: z.string().optional() },
    run: async (ctx, { group, parent_id }) => ok(await (await ctx.client()).forum.list(group, parent_id)),
  }),
  tool({
    name: "forum_post",
    description: "Post a forum entry.",
    category: "forum",
    readOnly: false,
    shape: {
      group: z.string(),
      title: z.string(),
      text: z.string(),
      parent_id: z.string().optional().describe("Elternbeitrag; weglassen für ein neues Thema."),
      icon: z.number().int().min(0).max(5).optional().describe("Symbol des Beitrags, 0–5 (Standard 0)."),
    },
    run: async (ctx, { group, ...entry }) => ok(await (await ctx.client()).forum.post(group, entry)),
  }),
  tool({
    name: "wiki_list",
    description: "List wiki pages in a group.",
    category: "wiki",
    readOnly: true,
    shape: { group: z.string() },
    run: async (ctx, { group }) => ok(await (await ctx.client()).wiki.list(group)),
  }),
  tool({
    name: "wiki_read",
    description: "Read a wiki page.",
    category: "wiki",
    readOnly: true,
    shape: { group: z.string(), id: z.string() },
    run: async (ctx, { group, id }) => ok(await (await ctx.client()).wiki.page(group, id)),
  }),
  tool({
    name: "wiki_create",
    description: "Create a wiki page.",
    category: "wiki",
    readOnly: false,
    shape: { group: z.string(), title: z.string(), text: z.string() },
    run: async (ctx, { group, title, text }) => ok(await (await ctx.client()).wiki.create(group, { title, text })),
  }),
  tool({
    name: "wiki_update",
    description: "Update a wiki page.",
    category: "wiki",
    readOnly: false,
    shape: { group: z.string(), id: z.string(), title: z.string().optional(), text: z.string().optional() },
    run: async (ctx, { group, id, title, text }) => ok(await (await ctx.client()).wiki.update(group, id, { title, text })),
  }),
  tool({
    name: "wiki_delete",
    description: "Delete a wiki page.",
    category: "wiki",
    readOnly: false,
    shape: { group: z.string(), id: z.string() },
    run: async (ctx, { group, id }) => {
      await (await ctx.client()).wiki.remove(group, id);
      return done();
    },
  }),
  tool({
    name: "members_list",
    description: "List members of a group/room.",
    category: "members",
    readOnly: true,
    shape: { group: z.string() },
    run: async (ctx, { group }) => ok(await (await ctx.client()).members.users(group)),
  }),
  tool({
    name: "members_broadcast",
    description: "Broadcast a quick message to all members of a group.",
    category: "members",
    readOnly: false,
    shape: { group: z.string(), text: z.string() },
    run: async (ctx, { group, text }) => {
      await (await ctx.client()).members.broadcast(group, text);
      return done();
    },
  }),
  tool({
    name: "resources_list",
    description: "List bookable resources in a group.",
    category: "resources",
    readOnly: true,
    shape: { group: z.string() },
    run: async (ctx, { group }) => ok(await (await ctx.client()).resources.list(group)),
  }),
  tool({
    name: "resources_bookings",
    description: "List resource bookings in a window.",
    category: "resources",
    readOnly: true,
    shape: {
      group: z.string(),
      start: z.number().int().optional(),
      end: z.number().int().optional(),
      resource_id: z.string().optional(),
    },
    run: async (ctx, { group, ...rest }) => ok(await (await ctx.client()).resources.bookings(group, rest)),
  }),
  tool({
    name: "resources_book",
    description: "Book a resource.",
    category: "resources",
    readOnly: false,
    shape: {
      group: z.string(),
      resource_id: z.string(),
      start: z.number().int(),
      end: z.number().int(),
      title: z.string().optional(),
    },
    run: async (ctx, { group, ...rest }) => ok(await (await ctx.client()).resources.book(group, rest)),
  }),

  // ─── Stundenplan (DaVinci) ──────────────────────────────────────────────
  tool({
    name: "timetable_info",
    description: "Describe the configured timetable (DaVinci) source: kind of publication, validity window, and which class/teacher the plan is filtered to.",
    category: "timetable",
    readOnly: true,
    shape: {},
    run: async (ctx) =>
      withTimetable(ctx, async ({ user_id, cfg }) => {
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
  }),
  tool({
    name: "timetable_get",
    description: "Read the timetable / substitution plan for a date range. Defaults to the current week (Monday–Sunday); on Saturdays and Sundays it defaults to the coming week instead. Entries carry the effective teachers and rooms with substitutions already folded in; `change` marks anything deviating from the regular plan (cancelled, substituted, moved, extra).",
    category: "timetable",
    readOnly: true,
    shape: {
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
        .describe("Inclusive start date, YYYY-MM-DD. Default: Monday of the current week — or of the coming week when asked on a Saturday or Sunday, since the running week is already spent."),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
        .describe("Inclusive end date, YYYY-MM-DD. Default: `from` + 6 days."),
      class_code: z.string().optional().describe("Override the class configured in Settings."),
      teacher_code: z.string().optional().describe("Override the teacher short code configured in Settings."),
      room_code: z.string().optional().describe("Keep only lessons in this room."),
      changes_only: z.boolean().optional().describe("Return only entries that deviate from the regular plan."),
    },
    run: async (ctx, { from, to, class_code, teacher_code, room_code, changes_only }) =>
      withTimetable(ctx, async ({ user_id, cfg }) => {
        const start = from ?? defaultWeekStart();
        const end = to ?? addDays(start, 6);
        if (end < start) throw new ToolInputError("`to` liegt vor `from`.");

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
  }),

  // ─── Raw escape hatch ───────────────────────────────────────────────────
  tool({
    name: "raw_call",
    description: "Escape hatch — call any LernSax JSON-RPC method directly. Use when no dedicated tool fits. Granting this scope amounts to full account access.",
    category: "advanced",
    readOnly: false,
    shape: {
      method: z.string(),
      params: z.record(z.unknown()).optional(),
      focus_object: z.string().optional(),
      focus_login: z.string().optional(),
    },
    run: async (ctx, { method, params, focus_object, focus_login }) => {
      const focus = focus_object ? { object: focus_object as never, login: focus_login } : undefined;
      return ok(await (await ctx.client()).session.call(method, params ?? {}, focus));
    },
  }),
];

/** Content type for a downloaded file, guessed from its extension. */
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
export function mimeForName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export const TOOL_NAMES: readonly string[] = TOOLS.map((t) => t.name);

export function findTool(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}

/** Scope that grants every tool — what the MCP connector's OAuth flow hands out. */
export const FULL_ACCESS_SCOPE = "lernsax";

/**
 * Which tools a set of granted scopes unlocks: every tool for `lernsax`,
 * otherwise exactly the tools named. Unknown scopes (`openid`, a tool that was
 * since removed) unlock nothing.
 */
export function toolsForScopes(scopes: readonly string[]): Set<string> {
  if (scopes.includes(FULL_ACCESS_SCOPE)) return new Set(TOOL_NAMES);
  return new Set(scopes.filter((s) => TOOL_NAMES.includes(s)));
}
