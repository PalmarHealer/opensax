import { LernSaxError } from "../errors.js";
import type { FocusSpec, LernSaxSession } from "../session.js";
import { WwsSession, decodeEntities, firstForm, wwsRedirect } from "../wws.js";

/** Author/timestamp metadata as LernSax returns it on `get_entries`/`get_entry`. */
export type ForumStamp = number | { date?: number; user?: { login?: string; name_hr?: string } };

export interface ForumEntry {
  id: string;
  title: string;
  text?: string;
  author?: { login: string; name_hr?: string };
  parent_id?: string;
  created?: ForumStamp;
  modified?: ForumStamp;
  reply_count?: number;
  /** Symbol 0–5: Info, Humor, Frage, Antwort, Pro, Kontra */
  icon?: number;
  level?: number;
  children?: { count?: number };
  files?: Array<{ id: string; name: string; size: number }>;
  pinned?: number;
  locked?: number;
  [k: string]: unknown;
}

export class ForumApi {
  constructor(
    private readonly session: LernSaxSession,
    /** für den Umweg über die Weboberfläche, s. {@link edit} */
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}
  private focus(group: string): FocusSpec {
    const login = this.session.resolveGroup(group);
    if (!login) throw new Error(`Unknown group: ${group}`);
    return { object: "forum", login };
  }
  async list(group: string, parent_id?: string): Promise<ForumEntry[]> {
    const r = await this.session.call("get_entries", parent_id ? { parent_id } : {}, this.focus(group));
    return (r.entries as ForumEntry[]) ?? [];
  }
  async get(group: string, id: string): Promise<ForumEntry> {
    const r = await this.session.call("get_entry", { id }, this.focus(group));
    return ((r.entry as ForumEntry) ?? (r as ForumEntry));
  }
  /**
   * `parent_id` und `icon` sind laut API-Doku beide Pflicht — auch für ein neues
   * Thema, das per Definition keinen Elternbeitrag hat. Fehlen sie, antwortet
   * der Server mit `Parameter "parent_id" required` und, sobald das behoben ist,
   * mit derselben Meldung für `icon`. "0" steht für die Wurzel, Icon 0 für das
   * Standardsymbol (die Doku lässt 0–5 zu).
   */
  async post(
    group: string,
    entry: { title: string; text: string; parent_id?: string; icon?: number },
  ): Promise<ForumEntry> {
    const r = await this.session.call(
      "add_entry",
      {
        title: entry.title,
        text: entry.text,
        parent_id: entry.parent_id ?? "0",
        icon: entry.icon ?? 0,
      },
      this.focus(group),
    );
    return r as ForumEntry;
  }
  /**
   * Beitrag löschen (samt Antworten).
   *
   * `delete_entry` klappt nur mit Forum-Adminrecht; für eigene Beiträge
   * antwortet die API schlicht mit „ERROR“, obwohl die Weboberfläche das Löschen
   * erlaubt. Dann nehmen wir deren „Löschen“-Button.
   */
  async remove(group: string, id: string): Promise<void> {
    try {
      await this.session.call("delete_entry", { id }, this.focus(group));
      return;
    } catch {
      // weiter über die Weboberfläche
    }
    const { wws, read, form } = await this.openEntry(group, id);
    if (!/name="delete"/.test(read)) throw fail("Keine Berechtigung, diesen Beitrag zu löschen");
    // Das „Sind Sie sicher?“ ist nur ein data-confirm im Browser.
    await wws.post(form.action, new URLSearchParams([...form.fields, ["delete", "Löschen"]]));

    // Die Antwortseite hat keine verlässliche Erfolgsmeldung — also nachsehen.
    const still = await this.session
      .call("get_entry", { id }, this.focus(group))
      .then((r) => Boolean((r.entry as ForumEntry | undefined)?.id))
      .catch(() => false);
    if (still) throw fail("Löschen fehlgeschlagen");
  }

  /**
   * Beitrag überarbeiten.
   *
   * Die JSON-RPC-API kennt dafür keine Methode (`set_entry` & Co. liefern
   * „Unknown command“), die Weboberfläche schon. Wir klicken uns deshalb durch
   * dieselben Seiten wie ein Browser: Forum des Raums → Beitrag lesen →
   * „Überarbeiten“ → Formular mit `save` absenden. Die Vorschau-Stufe dazwischen
   * ist optional; der Server speichert auch direkt.
   */
  async edit(
    group: string,
    id: string,
    entry: { title: string; text: string; icon?: number },
  ): Promise<void> {
    const { wws, read, form: readForm } = await this.openEntry(group, id);
    if (!/name="edit"/.test(read)) throw fail("Keine Berechtigung, diesen Beitrag zu überarbeiten");

    const toEdit = await wws.post(readForm.action, new URLSearchParams([...readForm.fields, ["edit", "Überarbeiten"]]));
    const editUrl = wwsRedirect(toEdit);
    if (!editUrl) throw fail("Bearbeiten-Ansicht nicht erreichbar");

    const form = firstForm(await wws.get(editUrl));
    if (!form) throw fail("Bearbeiten-Formular nicht gefunden");
    const body = new URLSearchParams(form.fields);
    body.set("subject", entry.title);
    body.set("text", entry.text);
    if (entry.icon !== undefined) body.set("icon", String(entry.icon));
    body.set("save", "Veröffentlichen");

    const result = await wws.post(form.action, body);
    if (!/Eintrag gespeichert/.test(result) && !/Eintrag\+gespeichert/.test(wwsRedirect(result) ?? "")) {
      // Validierungsfehler (leerer Betreff o. ä.) zeigt LernSax auf derselben Seite an.
      const hint = /class="[^"]*(?:error|warning)[^"]*"[^>]*>([^<]+)</i.exec(result)?.[1]?.trim();
      throw fail(hint ? `LernSax: ${decodeEntities(hint)}` : "Speichern fehlgeschlagen");
    }
  }

  /**
   * Lese-Ansicht eines Beitrags in der Weboberfläche öffnen. Ihr Formular trägt
   * die Buttons „Überarbeiten“ und „Löschen“ — sofern man sie benutzen darf.
   */
  private async openEntry(group: string, id: string) {
    const login = this.session.resolveGroup(group);
    if (!login) throw new Error(`Unknown group: ${group}`);
    const room = this.session.groups.find((g) => g.login === login)?.name_hr ?? login;

    const wws = await WwsSession.open(this.session, this.fetchImpl);
    const sid = await wws.enterRoom(room);

    // Das Forum verlinkt Beiträge über `fr(id)`, das eine signierte Popup-URL
    // um die ID ergänzt — nur so kommt man an die Lese-Ansicht heran.
    const forum = await wws.get(`109660.php?sid=${sid}`);
    const readBase = /function fr\(id\)\s*\{\s*return OpenPopUp\('([^']+)'\s*\+\s*id\)/.exec(forum)?.[1];
    if (!readBase) throw fail("Forum des Raums nicht erreichbar");

    const read = await wws.get(decodeEntities(readBase) + encodeURIComponent(id));
    const form = firstForm(read);
    if (!form) throw fail("Beitrag nicht gefunden");
    return { wws, read, form };
  }
}

function fail(message: string): LernSaxError {
  return new LernSaxError(message, 0, "forum_web");
}
