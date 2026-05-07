import type { LernSaxSession } from "../session.js";

export interface NotificationParty {
  login: string;
  name_hr: string;
  type: number;
  alias?: string;
}

export interface Notification {
  id: string;
  /** Numeric code as string (e.g. "5", "13") */
  message: string;
  /** Human-readable text */
  message_hr: string;
  /** Unix seconds, but the server returns it as a string */
  date: string;
  data?: string | null;
  from_user?: NotificationParty;
  from_group?: NotificationParty;
  from_id?: string | null;
  is_unread: 0 | 1;
  /** "mail", "files", etc. — null for system notifications */
  object: string | null;
  [k: string]: unknown;
}

export class NotificationsApi {
  constructor(private readonly session: LernSaxSession) {}
  private focus() { return { object: "messages" } as const; }

  async list(): Promise<Notification[]> {
    const r = await this.session.call("get_messages", {}, this.focus());
    return (r.messages as Notification[]) ?? [];
  }
  async dismiss(id: string): Promise<void> {
    await this.session.call("delete_message", { id }, this.focus());
  }
}

/** Convert the string-date that LernSax returns to a JS number (unix seconds). */
export function notificationDate(n: { date: string | number }): number {
  return typeof n.date === "number" ? n.date : Number.parseInt(n.date, 10);
}
