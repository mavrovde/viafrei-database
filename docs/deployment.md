# Deploying viafrei-database

The image runs one long-lived process (`serve`). It migrates the database,
creates the tick tables' daily partitions 30 days ahead and applies the
service-role passwords. It then reports readiness, keeps the partitions ahead
once a day, and serves the optional interface.

## The image

`ghcr.io/mavrovde/viafrei-database:<version>`: pin it by digest. Tags,
versioning and how to verify the signature are in the README's
[Images and versions](../README.md#images-and-versions).

- **User and file system.** It runs as uid/gid 10001 and needs no capability.
  The root file system can be read-only; mount a small tmpfs at `/tmp`
  (`HOME` points there).
- **Ports.** 8080 is readiness (`/healthz`, `/ready`). 8090 is the interface,
  opened only when `DB_HOST` is set.
- **Signals.** `tini` is PID 1. `SIGTERM` closes both listeners and the pool.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | (required) | `postgresql://` URL of the database owner. The role must be able to run every migration and to `set log_statement` (the role-password step switches statement logging off), which in practice means the owner role the database was created with |
| `DB_MIGRATE_LOCK_ATTEMPTS` | 4 (`serve`), 1 (CLI) | Attempts per file when a migration hits a lock timeout (SQLSTATE 55P03) |
| `DB_MIGRATE_LOCK_PAUSE_S` | 20 | Pause between those attempts |
| `VF_DB_PARTITION_DAYS` | 30 (`serve`), 7 (CLI) | Days ahead that partitions are created |
| `VF_DB_PARTITIONS_EVERY_H` | 24 | How often `serve` re-runs partitions ensure |
| `VF_DB_RECHECK_S` | 30 | How often `serve` re-reads the ledger for `/ready` |
| `VF_DB_ROLE_DIR` | unset (step skipped) | Directory of mounted secret files, one per role, each named exactly like the role (`viafrei_mcp`, …) and holding its password |
| `VF_DB_BASELINE_DIR` | `/app/db/baseline` | The baseline (`ledger.tsv` and one `NNNN_baseline.sql`); absent means no baseline |
| `VF_DB_MIGRATIONS_DIR` | `/app/db/migrations` | The migrations after the baseline; the image's own by default |
| `VF_DB_ROLES_SQL_DIR` | `/app/db/roles` | The role-password SQL files |
| `VF_DB_PSQL` | `psql` | The `psql` binary (version 16) |
| `VF_DB_READY_PORT` / `VF_DB_HTTP_PORT` | 8080 / 8090 | The two ports; they must differ |
| `VF_DB_BIND` | `0.0.0.0` | Listen address |
| `DB_HOST` | unset (no interface) | The interface's host name. Requests naming another `Host` get 421 |
| `DB_ALLOW_CIDR` | empty (deny all) | Comma-separated CIDRs allowed to reach the interface |
| `DB_TRUSTED_PROXY_CIDR` | empty | Peers whose `X-Forwarded-For` is believed (your ingress or proxy). It must not overlap `DB_ALLOW_CIDR` |
| `DB_OWNER_TOKEN_SHA256` | unset (actions off) | SHA-256 (lower-case hex) of the owner's sign-in token |
| `DB_SESSION_SECRET` | unset | At least 32 characters; signs the session cookie. Set together with the token hash, or not at all |

Generate the owner token and its hash:

```bash
token="$(openssl rand -base64 32)"; printf '%s' "$token" | sha256sum | cut -c1-64
```

Keep the token in a password manager. Only the hash goes into the deployment.

## Readiness, and making the others wait

`/ready` answers `200 READY <head>` only when all of these hold:

- every migration in the image is applied with an equal checksum;
- the boot's partitions ensure succeeded;
- every role password was applied, or the role step is not configured.

In every other case it answers `503 NOT READY: <why>`. A database that a
NEWER image has already migrated stays ready: the extra versions are reported
but do not block.

Every workload that uses the database should wait for it. In Kubernetes, use
an init container:

```yaml
initContainers:
  - name: wait-for-schema
    image: curlimages/curl:8.17.0  # pin by digest
    command: ["sh", "-c", "until curl -fsS http://viafrei-database:8080/ready; do sleep 2; done"]
    securityContext: { runAsNonRoot: true, allowPrivilegeEscalation: false, capabilities: { drop: [ALL] } }
```

## Example Kubernetes manifest

The values in angle brackets are placeholders.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: viafrei-database, namespace: <namespace> }
spec:
  replicas: 1                # one: see "Replicas" below
  strategy: { type: Recreate }
  selector: { matchLabels: { app: viafrei-database } }
  template:
    metadata: { labels: { app: viafrei-database } }
    spec:
      automountServiceAccountToken: false
      securityContext: { runAsNonRoot: true, runAsUser: 10001, runAsGroup: 10001, seccompProfile: { type: RuntimeDefault } }
      containers:
        - name: viafrei-database
          image: ghcr.io/mavrovde/viafrei-database:<version>@sha256:<digest>
          args: ["serve"]
          ports:
            - { name: ready, containerPort: 8080 }
            - { name: http, containerPort: 8090 }
          env:
            - name: DATABASE_URL
              valueFrom: { secretKeyRef: { name: viafrei-database, key: database-url } }
            - { name: VF_DB_ROLE_DIR, value: /run/secrets/roles }
            - { name: DB_HOST, value: <interface host name> }
            - { name: DB_ALLOW_CIDR, value: "<your address>/32" }
            - { name: DB_TRUSTED_PROXY_CIDR, value: "<ingress pod CIDR>" }
            - name: DB_OWNER_TOKEN_SHA256
              valueFrom: { secretKeyRef: { name: viafrei-database, key: owner-token-sha256 } }
            - name: DB_SESSION_SECRET
              valueFrom: { secretKeyRef: { name: viafrei-database, key: session-secret } }
          livenessProbe: { httpGet: { path: /healthz, port: ready }, periodSeconds: 10 }
          # No readinessProbe on /ready: a long first migration must not get the pod killed
          # or pulled; the other workloads wait on /ready themselves.
          securityContext:
            readOnlyRootFilesystem: true
            allowPrivilegeEscalation: false
            capabilities: { drop: [ALL] }
          resources:
            requests: { cpu: 50m, memory: 96Mi }
            limits: { memory: 256Mi }
          volumeMounts:
            - { name: tmp, mountPath: /tmp }
            - { name: roles, mountPath: /run/secrets/roles, readOnly: true }
      volumes:
        - { name: tmp, emptyDir: { medium: Memory, sizeLimit: 64Mi } }
        - name: roles
          secret: { secretName: viafrei-database-roles, defaultMode: 0400 }
---
apiVersion: v1
kind: Service
metadata: { name: viafrei-database, namespace: <namespace> }
spec:
  selector: { app: viafrei-database }
  ports: [{ name: ready, port: 8080, targetPort: ready }]
---
# The interface gets its own Service, so that only the ingress routes it.
apiVersion: v1
kind: Service
metadata: { name: viafrei-database-http, namespace: <namespace> }
spec:
  selector: { app: viafrei-database }
  ports: [{ name: http, port: 8090, targetPort: http }]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: viafrei-database, namespace: <namespace> }
spec:
  podSelector: { matchLabels: { app: viafrei-database } }
  policyTypes: [Ingress]
  ingress:
    - from: [{ podSelector: {} }]                      # the namespace's workloads: readiness only
      ports: [{ port: 8080 }]
    - from: [{ namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: <ingress namespace> } } }]
      ports: [{ port: 8090 }]                          # the ingress: interface only
```

Route the interface through your ingress with the same allow-list at the
edge, so a refused address never reaches the pod. Never route port 8080.

## Replicas

Run **one** replica. Migrations would be safe with more (an advisory lock
serialises them), but the interface keeps its sign-in sessions, its
single-use confirmations and its sign-in rate limit in the process: behind a
second replica a confirmation could be used twice, the rate limit would
double, and a sign-out on one replica would not revoke the session on the
other. A restart signs the owner out. `strategy: Recreate` keeps a rollout
from running two at once.

## Checking a deployment

From an address outside the allow-list, `/` on the interface host returns
`403` with an empty body. From an allowed address it returns the page.
Port 8080 is unreachable from outside the cluster. Inside the cluster,
`curl http://viafrei-database:8080/ready` says `READY <head>`.
