import type { LernSaxSession } from "../session.js";

export interface MessengerUser {
  login: string;
  name_hr?: string;
  online?: boolean;
  [k: string]: unknown;
}

export interface QuickMessage {
  id: number;
  from_login: string;
  to_login: string;
  text: string;
  date: number;
  is_unread?: boolean;
  [k: string]: unknown;
}

export class MessengerApi {
  constructor(private readonly session: LernSaxSession) {}
  private focus() { return { object: "messenger" } as const; }

  async users(only_online = false): Promise<MessengerUser[]> {
    const r = await this.session.call("get_users", { only_online }, this.focus());
    return (r.users as MessengerUser[]) ?? [];
  }
  async send(to_login: string, text: string): Promise<void> {
    await this.session.call("send_quick_message", { login: to_login, text }, this.focus());
  }
  async readUnread(): Promise<QuickMessage[]> {
    const r = await this.session.call("read_quick_messages", {}, this.focus());
    return (r.messages as QuickMessage[]) ?? [];
  }
  /**
   * `get_history` kennt laut API-Doku nur `start_id` und `export_session_file`.
   * Ein zusätzlich durchgereichtes `group_by_chat` lehnt der Server ab — die
   * Gruppierung nach Gesprächspartner passiert ohnehin bei uns.
   */
  async history(params: { start_id?: number } = {}): Promise<QuickMessage[]> {
    const r = await this.session.call(
      "get_history",
      params.start_id === undefined ? {} : { start_id: params.start_id },
      this.focus(),
    );
    return (r.messages as QuickMessage[]) ?? [];
  }
  async block(login: string): Promise<void> {
    await this.session.call("block_user", { login }, this.focus());
  }
  async unblock(login: string): Promise<void> {
    await this.session.call("unblock_user", { login }, this.focus());
  }
  async blocklist(): Promise<MessengerUser[]> {
    const r = await this.session.call("get_blocklist", {}, this.focus());
    return (r.users as MessengerUser[]) ?? [];
  }
}
