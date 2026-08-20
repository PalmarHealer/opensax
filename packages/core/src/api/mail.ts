import type { LernSaxSession } from "../session.js";

export interface MailFolder {
  id: string;
  name: string;
  is_inbox?: boolean;
  is_sent?: boolean;
  is_drafts?: boolean;
  is_trash?: boolean;
  is_system?: boolean;
  unread?: number;
  total?: number;
  m_date?: number;
  [k: string]: unknown;
}

/** LernSax returns email parties as `{ addr, name }`. */
export interface MailParty {
  addr: string;
  name?: string;
}

export interface MailEnvelope {
  id: number;
  folder_id?: string;
  subject?: string;
  from?: MailParty[];
  to?: MailParty[];
  cc?: MailParty[];
  reply_to?: MailParty[];
  date?: number;
  is_unread?: 0 | 1;
  is_flagged?: 0 | 1;
  is_answered?: 0 | 1;
  is_forwarded?: 0 | 1;
  is_deleted?: 0 | 1;
  has_attachments?: boolean;
  size?: number;
  preview?: string;
  [k: string]: unknown;
}

export interface MailAttachment {
  id: string;
  name: string;
  size: number;
  mime?: string;
}

export interface MailFull extends MailEnvelope {
  body_plain?: string;
  body_html?: string;
  files?: MailAttachment[];
}

export class MailApi {
  constructor(private readonly session: LernSaxSession) {}

  private focus() {
    return { object: "mailbox" } as const;
  }

  async getFolders(): Promise<MailFolder[]> {
    const r = await this.session.call("get_folders", {}, this.focus());
    return (r.folders as MailFolder[]) ?? [];
  }

  async getMessages(params: {
    folder_id: string;
    limit?: number;
    offset?: number;
    is_unread?: boolean;
    search?: string;
    search_in?: Array<"from" | "subject" | "body" | "recipients">;
  }): Promise<MailEnvelope[]> {
    const r = await this.session.call("get_messages", params, this.focus());
    return (r.messages as MailEnvelope[]) ?? [];
  }

  async readMessage(folder_id: string, message_id: number | string): Promise<MailFull> {
    const r = await this.session.call(
      "read_message",
      { folder_id, message_id },
      this.focus(),
    );
    // Server wraps the payload in { message: {...} }.
    return ((r.message as MailFull) ?? (r as MailFull));
  }

  async sendMail(params: {
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    body_plain?: string;
    body_html?: string;
    import_session_files?: string[];
    reply_id?: string | number;
    forward_id?: string | number;
  }): Promise<Record<string, unknown>> {
    return this.session.call("send_mail", params, this.focus());
  }

  /**
   * Save a message into the Drafts folder. NOTE: the LernSax `save_draft` RPC
   * can only CREATE a draft — it rejects any `message_id`/`id` param and returns
   * an empty body (no id). To "update" a draft, callers must create a fresh one
   * and delete the previous version (see the web save-draft route).
   */
  async saveDraft(params: {
    to?: string;
    cc?: string;
    bcc?: string;
    subject?: string;
    body_plain?: string;
    body_html?: string;
  }): Promise<Record<string, unknown>> {
    return this.session.call("save_draft", params, this.focus());
  }

  async deleteMessage(folder_id: string, message_id: number | string): Promise<void> {
    await this.session.call("delete_message", { folder_id, message_id }, this.focus());
  }

  async moveMessage(folder_id: string, message_id: number | string, target_folder_id: string): Promise<void> {
    await this.session.call(
      "move_message",
      { folder_id, message_id, target_folder_id },
      this.focus(),
    );
  }

  async setMessage(params: {
    folder_id: string;
    message_id: number | string;
    is_unread?: boolean;
    is_flagged?: boolean;
    is_answered?: boolean;
  }): Promise<void> {
    await this.session.call("set_message", params, this.focus());
  }

  async getUnreadMessages(): Promise<MailEnvelope[]> {
    const r = await this.session.call("get_unread_messages", {}, this.focus());
    return (r.messages as MailEnvelope[]) ?? [];
  }

  /**
   * Stages a mail attachment as a session-file and returns the temporary
   * download URL. The actual payload is fetched separately (no auth needed).
   */
  async getAttachmentSessionFile(params: {
    folder_id: string;
    message_id: number | string;
    file_id: string;
  }): Promise<{ id: string; name: string; size: number; download_url: string }> {
    const r = await this.session.call("export_session_file", params, this.focus());
    const file = (r.file ?? r) as { id: string; name: string; size: number; download_url: string };
    return file;
  }

  /**
   * Stages a file as a session-file so it can be attached to an outgoing mail
   * (pass the returned id via `import_session_files` to {@link sendMail}).
   *
   * Verified against the live API: method `add_file` under the `session_files`
   * focus, with base64 `data` and NO `data_encoding` field. Returns
   * `{ file: { id, name, size, download_url } }`. The id is read defensively in
   * case the response shape varies.
   */
  async addSessionFile(name: string, dataBase64: string): Promise<string> {
    const r = await this.session.call(
      "add_file",
      { name, data: dataBase64 },
      { object: "session_files" },
    );
    const file = (r.file ?? r) as { id?: string };
    return (file.id ?? (r.id as string)) ?? "";
  }

  async addFolder(params: { name: string; parent_id?: string; expires?: number }): Promise<Record<string, unknown>> {
    return this.session.call("add_folder", params, this.focus());
  }

  async deleteFolder(folder_id: string): Promise<void> {
    await this.session.call("delete_folder", { folder_id }, this.focus());
  }

  async setFolder(folder_id: string, patch: { name?: string; expires?: number }): Promise<void> {
    await this.session.call("set_folder", { folder_id, ...patch }, this.focus());
  }

  // ── Signature (one per mailbox) ─────────────────────────────────────
  async getSignature(): Promise<{ text: string; position_answer: "start" | "end"; position_forward: "start" | "end" }> {
    const r = await this.session.call("get_signature", {}, this.focus());
    const sig = (r.signature ?? r) as { text?: string; position_answer?: "start" | "end"; position_forward?: "start" | "end" };
    return {
      text: sig.text ?? "",
      position_answer: sig.position_answer ?? "end",
      position_forward: sig.position_forward ?? "end",
    };
  }
  async setSignature(params: { text: string; position_answer?: "start" | "end"; position_forward?: "start" | "end" }): Promise<void> {
    await this.session.call("set_signature", params, this.focus());
  }

  /** Mailbox state: quota usage + unread count. */
  async mailboxState(): Promise<{ quota?: { usage: number; free: number; limit: number }; unread_messages?: number; mode?: string }> {
    const r = await this.session.call("get_state", {}, this.focus());
    return r as { quota?: { usage: number; free: number; limit: number }; unread_messages?: number };
  }
}

/** Convenience: best display name for a mail party. */
export function mailPartyDisplay(p: MailParty | undefined): string {
  if (!p) return "";
  return p.name && p.name !== p.addr ? `${p.name} <${p.addr}>` : p.addr;
}
