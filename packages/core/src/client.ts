import { LernSaxSession, type Credentials, type SessionOptions } from "./session.js";
import { WebDavClient, type WebDavOptions } from "./webdav.js";
import { LernSaxWebClient, type WebClientOptions } from "./webClient.js";
import { envProxyFetch } from "./proxyFetch.js";
import { MailApi } from "./api/mail.js";
import { TasksApi } from "./api/tasks.js";
import { CalendarApi } from "./api/calendar.js";
import { BoardApi } from "./api/board.js";
import { NotesApi } from "./api/notes.js";
import { MessengerApi } from "./api/messenger.js";
import { FilesApi } from "./api/files.js";
import { ProfileApi } from "./api/profile.js";
import { NotificationsApi } from "./api/notifications.js";
import { AddressesApi } from "./api/addresses.js";
import { ForumApi } from "./api/forum.js";
import { WikiApi } from "./api/wiki.js";
import { MembersApi } from "./api/members.js";
import { ResourcesApi } from "./api/resources.js";

export interface ClientOptions extends SessionOptions {
  webdav?: WebDavOptions;
  web?: WebClientOptions;
}

/**
 * Top-level facade. One per credential pair.
 *
 *   const c = new LernSaxClient({ email, password });
 *   await c.session.ensureSession();
 *   const folders = await c.mail.getFolders();
 */
export class LernSaxClient {
  readonly session: LernSaxSession;
  readonly webdav: WebDavClient;
  readonly web: LernSaxWebClient;

  readonly mail: MailApi;
  readonly tasks: TasksApi;
  readonly calendar: CalendarApi;
  readonly board: BoardApi;
  readonly notes: NotesApi;
  readonly messenger: MessengerApi;
  readonly files: FilesApi;
  readonly profile: ProfileApi;
  readonly notifications: NotificationsApi;
  readonly addresses: AddressesApi;
  readonly forum: ForumApi;
  readonly wiki: WikiApi;
  readonly members: MembersApi;
  readonly resources: ResourcesApi;

  constructor(credentials: Credentials, opts: ClientOptions = {}) {
    // Relay all LernSax-bound traffic through the German egress proxy when
    // LERNSAX_PROXY_URL is set. An explicit fetchImpl from the caller always
    // wins, so tests and custom setups stay in control.
    const relay = envProxyFetch();
    const sessionOpts: SessionOptions = relay && !opts.fetchImpl ? { ...opts, fetchImpl: relay } : opts;
    const webdavOpts: WebDavOptions =
      relay && !opts.webdav?.fetchImpl ? { ...opts.webdav, fetchImpl: relay } : (opts.webdav ?? {});
    const webOpts: WebClientOptions =
      relay && !opts.web?.fetchImpl ? { ...opts.web, fetchImpl: relay } : (opts.web ?? {});

    this.session = new LernSaxSession(credentials, sessionOpts);
    this.webdav = new WebDavClient(credentials, webdavOpts);
    this.web = new LernSaxWebClient(credentials, webOpts);

    this.mail = new MailApi(this.session);
    this.tasks = new TasksApi(this.session);
    this.calendar = new CalendarApi(this.session);
    this.board = new BoardApi(this.session);
    this.notes = new NotesApi(this.session);
    this.messenger = new MessengerApi(this.session);
    this.files = new FilesApi(this.session);
    this.profile = new ProfileApi(this.session);
    this.notifications = new NotificationsApi(this.session);
    this.addresses = new AddressesApi(this.session);
    this.forum = new ForumApi(this.session);
    this.wiki = new WikiApi(this.session);
    this.members = new MembersApi(this.session);
    this.resources = new ResourcesApi(this.session);
  }

  async login(): Promise<void> {
    await this.session.ensureSession();
  }

  async logout(): Promise<void> {
    await this.session.logout();
  }

  /** Convenience: list of groups/rooms the user belongs to (loaded at login). */
  groups() {
    return this.session.groups;
  }

  whoami() {
    return this.session.whoami;
  }
}
