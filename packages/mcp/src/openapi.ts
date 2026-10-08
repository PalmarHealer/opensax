/**
 * OpenAPI 3.1 description of the REST API, generated from the tool list.
 *
 * The converter below covers exactly the zod types `tools.ts` uses. Anything
 * else falls back to an unconstrained schema rather than throwing, so a new
 * tool with an exotic argument still shows up in the docs — just less precise.
 */
import { z } from "zod";
import { CATEGORIES, FULL_ACCESS_SCOPE, TOOLS, type ToolDef } from "./tools.js";

type JsonSchema = Record<string, unknown>;

export function zodToJsonSchema(t: z.ZodTypeAny): JsonSchema {
  const withDesc = (s: JsonSchema): JsonSchema => (t.description ? { ...s, description: t.description } : s);

  if (t instanceof z.ZodOptional) return withDesc(zodToJsonSchema(t.unwrap()));
  if (t instanceof z.ZodDefault) {
    return withDesc({ ...zodToJsonSchema(t._def.innerType), default: t._def.defaultValue() });
  }
  if (t instanceof z.ZodString) {
    const s: JsonSchema = { type: "string" };
    for (const c of t._def.checks) {
      if (c.kind === "email") s.format = "email";
      else if (c.kind === "regex") s.pattern = c.regex.source;
      else if (c.kind === "min") s.minLength = c.value;
      else if (c.kind === "max") s.maxLength = c.value;
    }
    return withDesc(s);
  }
  if (t instanceof z.ZodNumber) {
    const s: JsonSchema = { type: "number" };
    for (const c of t._def.checks) {
      if (c.kind === "int") s.type = "integer";
      else if (c.kind === "min") s[c.inclusive ? "minimum" : "exclusiveMinimum"] = c.value;
      else if (c.kind === "max") s[c.inclusive ? "maximum" : "exclusiveMaximum"] = c.value;
    }
    return withDesc(s);
  }
  if (t instanceof z.ZodBoolean) return withDesc({ type: "boolean" });
  if (t instanceof z.ZodEnum) return withDesc({ type: "string", enum: [...t.options] });
  if (t instanceof z.ZodLiteral) return withDesc({ const: t.value });
  if (t instanceof z.ZodUnion) {
    const opts = (t.options as z.ZodTypeAny[]);
    // A union of literals reads better as an enum.
    if (opts.every((o) => o instanceof z.ZodLiteral)) {
      return withDesc({ enum: opts.map((o) => (o as z.ZodLiteral<unknown>).value) });
    }
    return withDesc({ anyOf: opts.map(zodToJsonSchema) });
  }
  if (t instanceof z.ZodArray) return withDesc({ type: "array", items: zodToJsonSchema(t.element) });
  if (t instanceof z.ZodObject) return withDesc(objectSchema(t.shape));
  if (t instanceof z.ZodRecord) {
    return withDesc({ type: "object", additionalProperties: zodToJsonSchema(t._def.valueType) });
  }
  return withDesc({});
}

export function objectSchema(shape: z.ZodRawShape): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const [key, value] of Object.entries(shape)) {
    properties[key] = zodToJsonSchema(value);
    if (!value.isOptional()) required.push(key);
  }
  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
});

function operation(t: ToolDef) {
  const schema = objectSchema(t.shape);
  const hasRequired = Array.isArray(schema.required) && schema.required.length > 0;
  const success = t.returnsFile
    ? {
        description: "Der Dateiinhalt. Name und Typ stehen in `Content-Disposition` und `Content-Type`.",
        content: { "application/octet-stream": { schema: { type: "string", contentMediaType: "application/octet-stream" } } },
      }
    : {
        description: "Antwort von LernSax, als JSON.",
        content: { "application/json": { schema: {} } },
      };
  return {
    operationId: t.name,
    summary: t.name,
    description: t.description,
    tags: [CATEGORIES[t.category]],
    security: [{ bearer: [t.name] }],
    "x-opensax-scope": t.name,
    "x-opensax-read-only": t.readOnly,
    requestBody: {
      required: hasRequired,
      content: { "application/json": { schema } },
    },
    responses: {
      200: success,
      400: errorResponse("Ungültige Argumente."),
      401: errorResponse("Token fehlt, ist unbekannt, abgelaufen oder die Anmeldung dahinter ist erloschen."),
      403: errorResponse("Das Token hat diesen Scope nicht."),
      409: errorResponse("Voraussetzung fehlt, z.B. kein Stundenplan hinterlegt."),
      429: errorResponse("Zu viele Anfragen."),
      502: errorResponse("LernSax hat den Aufruf abgelehnt oder war nicht erreichbar."),
    },
  };
}

export function buildOpenApi(serverUrl: string) {
  const paths: Record<string, unknown> = {
    "/tools": {
      get: {
        operationId: "tools",
        summary: "Freigegebene Tools",
        description: "Listet die Tools, die das vorgelegte Token aufrufen darf, samt Ablaufdatum des Tokens. Braucht keinen bestimmten Scope.",
        tags: ["Token"],
        security: [{ bearer: [] }],
        responses: {
          200: {
            description: "Token-Infos und freigegebene Tools.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/TokenInfo" } } },
          },
          401: errorResponse("Token fehlt, ist unbekannt oder abgelaufen."),
        },
      },
    },
  };
  for (const t of TOOLS) paths[`/${t.name}`] = { post: operation(t) };

  const scopes: Record<string, string> = { [FULL_ACCESS_SCOPE]: "Vollzugriff auf alle Tools (MCP-Connector)." };
  for (const t of TOOLS) scopes[t.name] = t.description;

  return {
    openapi: "3.1.0",
    info: {
      title: "OpenSax API",
      version: "1",
      description:
        "Programmatischer Zugriff auf deinen LernSax-Account. Jede Operation entspricht einem Tool des MCP-Servers "
        + "und wird mit `POST /api/v1/<tool>` und den Argumenten als JSON-Body aufgerufen. "
        + "Authentifizierung per `Authorization: Bearer <token>`; Tokens erstellst du unter Einstellungen → Verbindungen. "
        + "Jedes Tool ist ein eigener Scope.",
    },
    servers: [{ url: serverUrl }],
    tags: [
      { name: "Token" },
      ...[...new Set(TOOLS.map((t) => t.category))].map((c) => ({ name: CATEGORIES[c] })),
    ],
    paths,
    components: {
      securitySchemes: {
        bearer: {
          type: "http",
          scheme: "bearer",
          description: "API-Token aus Einstellungen → Verbindungen oder ein OAuth-Token des MCP-Connectors.",
          "x-opensax-scopes": scopes,
        },
      },
      schemas: {
        Error: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                code: { type: "string", examples: ["invalid_arguments", "insufficient_scope", "token_expired"] },
                message: { type: "string" },
                details: {},
              },
            },
          },
        },
        TokenInfo: {
          type: "object",
          properties: {
            token: {
              type: "object",
              properties: {
                name: { type: "string" },
                kind: { enum: ["oauth", "token"] },
                expires_at: { type: ["string", "null"], format: "date-time" },
              },
            },
            tools: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    "x-opensax-categories": CATEGORIES,
  };
}
