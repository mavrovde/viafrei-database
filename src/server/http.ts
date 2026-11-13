/**
 * The two listeners.
 *
 *   readiness port (VF_DB_READY_PORT, 8080) — cluster-internal, never routed
 *     by the edge or an Ingress: GET /healthz (live: 200 while the process
 *     runs) and GET /ready (200 `READY <head>` only when the service is ready,
 *     else 503). Nothing else; no allow-list, the NetworkPolicy admits the
 *     namespace's workloads only.
 *   interface port (VF_DB_HTTP_PORT, 8090) — the interface host (DB_HOST) through the edge.
 *     Every request passes the access policy first (403, empty body). GET / is
 *     the diagnostics page, GET /api/status.json the same as JSON, and the four
 *     actions need the owner session, an Origin naming this host, the CSRF
 *     token and a single-use confirmation.
 */
import http from "node:http";
import type { DatabaseService } from "../service.js";
import type { AccessPolicy } from "./access.js";
import { clientAddress } from "./access.js";
import {
  ConfirmLedger,
  LoginLimiter,
  SessionRegistry,
  clearedSessionCookie,
  confirmMatches,
  csrfMatches,
  csrfToken,
  mintConfirm,
  originAllowed,
  sessionCookie,
  tokenMatches,
  verifySession,
  type OwnerAuth,
} from "./auth.js";
import { ACTIONS, STYLE, confirmPage, statusPage, type Action, type Owner } from "./html.js";
import { TABLE_NAME } from "../actions.js";
import type { Logger } from "../log.js";

/**
 * On every response of the interface — pages, the stylesheet, the redirect and
 * every refusal (403, 404, 421, 429, 500). The pages load one resource, the
 * same-origin /style.css, and no script, frame, font or image, so the
 * cross-origin isolation headers (COOP, COEP, CORP) break nothing. No HSTS:
 * the process never speaks TLS; the TLS-terminating proxy in front sets it.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": "default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

/** The readiness port answers plain text to the orchestrator only; it still says nosniff and no-store. */
export const READINESS_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
};

export function readinessHandler(svc: Pick<DatabaseService, "snapshot">): http.RequestListener {
  return (req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { ...READINESS_HEADERS, "Content-Type": "text/plain" }).end();
      return;
    }
    if (path === "/healthz") {
      res.writeHead(200, { ...READINESS_HEADERS, "Content-Type": "text/plain; charset=utf-8" }).end("ok\n");
      return;
    }
    if (path === "/ready") {
      const s = svc.snapshot();
      res.writeHead(s.readiness.ready ? 200 : 503, { ...READINESS_HEADERS, "Content-Type": "text/plain; charset=utf-8" }).end(s.readiness.ready ? `READY ${String(s.imageHead)}\n` : `NOT READY: ${s.readiness.detail}\n`);
      return;
    }
    res.writeHead(404, { ...READINESS_HEADERS, "Content-Type": "text/plain" }).end();
  };
}

const MAX_BODY = 4096;

function readForm(req: http.IncomingMessage): Promise<URLSearchParams | null> {
  return new Promise((resolve) => {
    const type = (req.headers["content-type"] ?? "").split(";")[0]?.trim();
    if (type !== "application/x-www-form-urlencoded") {
      req.resume();
      resolve(null);
      return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (b: Buffer) => {
      size += b.length;
      if (size > MAX_BODY) {
        req.destroy();
        resolve(null);
      } else chunks.push(b);
    });
    req.on("end", () => resolve(new URLSearchParams(Buffer.concat(chunks).toString("utf8"))));
    req.on("error", () => resolve(null));
  });
}

/** Is the subject valid for the action? The confirm page and the POST apply the same rule. */
export function subjectValid(action: Action, subject: string): boolean {
  if (action === "migrate" || action === "check") return subject === "-";
  if (action === "partitions") return /^\d{1,3}$/.test(subject) && Number(subject) <= 400;
  return TABLE_NAME.test(subject);
}

export type InterfaceDeps = {
  readonly svc: DatabaseService;
  readonly policy: AccessPolicy;
  readonly auth: OwnerAuth;
  readonly log: Logger;
  readonly now?: () => Date;
};

export function interfaceHandler(d: InterfaceDeps): http.RequestListener {
  const now = d.now ?? ((): Date => new Date());
  const confirms = new ConfirmLedger();
  const limiter = new LoginLimiter();
  const sessions = new SessionRegistry();
  let notice: string | null = null;

  const send = (res: http.ServerResponse, status: number, type: string, body: string, extra: Record<string, string> = {}): void => {
    res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": type, ...extra }).end(body);
  };
  const redirect = (res: http.ServerResponse, extra: Record<string, string> = {}): void => {
    res.writeHead(303, { ...SECURITY_HEADERS, Location: "/", ...extra }).end();
  };
  const refuse = (res: http.ServerResponse, status = 403): void => {
    res.writeHead(status, { ...SECURITY_HEADERS, "Content-Length": "0" }).end();
  };

  return (req, res) => {
    void (async () => {
      const verdict = d.policy.decide({ peer: req.socket.remoteAddress, forwardedFor: req.headers["x-forwarded-for"], host: req.headers.host });
      if (verdict !== "allowed") {
        d.policy.recordDenial(verdict);
        refuse(res, verdict === "host" ? 421 : 403);
        return;
      }
      const url = new URL(req.url ?? "/", "http://interface.invalid");
      const at = now();
      const signed = d.auth === null ? null : verifySession(req.headers.cookie, d.auth.sessionSecret, at);
      const rand = signed !== null && sessions.has(signed, at) ? signed : null;
      const owner: Owner = d.auth === null ? { signedIn: false, enabled: false } : rand === null ? { signedIn: false, enabled: true } : { signedIn: true, csrf: csrfToken(d.auth.sessionSecret, rand) };

      if (req.method === "GET" && url.pathname === "/style.css") return send(res, 200, "text/css; charset=utf-8", STYLE);
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/api/status.json")) {
        let diag = null;
        let err: string | null = null;
        try {
          diag = await d.svc.diagnostics();
        } catch (e) {
          err = (e as Error).message.slice(0, 200);
        }
        if (url.pathname === "/api/status.json") {
          const s = d.svc.snapshot();
          return send(res, 200, "application/json", JSON.stringify({ snapshot: { ...s, schema: s.schema === null ? null : { ...s.schema, pending: s.schema.pending.map((f) => f.name) } }, diagnostics: diag, error: err }));
        }
        const shown = notice;
        notice = null;
        return send(res, 200, "text/html; charset=utf-8", statusPage(d.svc.snapshot(), diag, err, owner, shown));
      }
      if (req.method === "GET" && url.pathname === "/confirm") {
        if (d.auth === null || rand === null) return refuse(res);
        const action = url.searchParams.get("action") ?? "";
        const subject = (url.searchParams.get("subject") ?? "-").trim() || "-";
        if (!(ACTIONS as readonly string[]).includes(action) || !subjectValid(action as Action, subject)) return send(res, 400, "text/plain; charset=utf-8", "not an action this interface runs\n");
        return send(res, 200, "text/html; charset=utf-8", confirmPage(action as Action, subject, csrfToken(d.auth.sessionSecret, rand), mintConfirm(d.auth.sessionSecret, rand, action, subject, at)));
      }
      if (req.method !== "POST") return refuse(res, 404);
      // Every POST: actions on, Origin of this host.
      if (d.auth === null || !originAllowed(req.headers.origin, d.policy.host)) return refuse(res);
      const form = await readForm(req);
      if (form === null) return refuse(res, 400);
      const peerKey = clientAddress({ peer: req.socket.remoteAddress, forwardedFor: req.headers["x-forwarded-for"], trustedProxies: d.policy.trustedProxies });
      const key = peerKey === null ? "?" : Buffer.from(peerKey.bytes).toString("hex");

      if (url.pathname === "/login") {
        if (limiter.blocked(key, at.getTime())) return refuse(res, 429);
        if (!tokenMatches(form.get("token") ?? "", d.auth.tokenSha256)) {
          limiter.fail(key, at.getTime());
          d.log.warn({ outcome: "token-refused" }, "owner sign-in refused");
          return refuse(res);
        }
        d.log.info({ outcome: "signed-in" }, "owner signed in");
        return redirect(res, { "Set-Cookie": sessionCookie(sessions.issue(d.auth.sessionSecret, at)) });
      }
      if (rand === null || !csrfMatches(d.auth.sessionSecret, rand, form.get("csrf"))) return refuse(res);
      if (url.pathname === "/logout") {
        sessions.revoke(rand);
        return redirect(res, { "Set-Cookie": clearedSessionCookie });
      }
      if (url.pathname !== "/action") return refuse(res, 404);
      const action = form.get("action") ?? "";
      const subject = form.get("subject") ?? "";
      const confirm = form.get("confirm") ?? "";
      if (!(ACTIONS as readonly string[]).includes(action) || !subjectValid(action as Action, subject)) return refuse(res, 400);
      if (!confirmMatches(d.auth.sessionSecret, rand, action, subject, confirm, at) || !confirms.consume(confirm, at)) return refuse(res);
      d.log.info({ action, subject, outcome: "started" }, "owner action");
      const a = action as Action;
      // Started, not awaited: a migrate can take minutes; the page shows it as running and its result when done.
      const job =
        a === "migrate" ? d.svc.migrate("owner") : a === "partitions" ? d.svc.ensurePartitions("owner", Number(subject)) : a === "analyze" ? d.svc.analyze(subject, "owner") : d.svc.check("owner");
      void job.catch(() => undefined);
      notice = `${a} ${subject === "-" ? "" : subject} started`;
      return redirect(res);
    })().catch((e: unknown) => {
      d.log.error({ err: (e as Error).message.slice(0, 200) }, "interface request failed");
      if (!res.headersSent) refuse(res, 500);
    });
  };
}
