# adonis-req-logger

Request logging for AdonisJS: one structured log line per HTTP request, emitted
through the application's existing pino logger. This glossary fixes the words the
package uses in its record, its config, and its docs. It is a glossary only —
the record shape, config surface, and locked decisions live in
[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Language

### The record

**Canonical record**:
The single structured object logged when a request completes, containing
everything the package knows about that request. Fixed in shape: adding a field
is a minor release, removing or renaming one is breaking.
_Avoid_: log entry, event, trace

**Summary line**:
The fixed human-readable `msg` string accompanying the canonical record
(`GET /users/1 200 12ms`). Part of the public API — consumers grep it.
_Avoid_: message, log message

### Host and machine

These two are routinely confused, and the confusion is expensive: a transport
can silently overwrite one with the other. Keep them apart in code, docs, and
config.

**Host**:
The domain the client asked for, as it arrived on the request. Recorded as
`request.host` — lowercased, port stripped, never a Loki label. It is
attacker-controlled input, and it may resolve to an internal ingress host rather
than a public domain when a proxy rewrites `Host`.
_Avoid_: hostname, domain, vhost, public host

**Hostname**:
The machine or container the application runs on — infrastructure identity, not
request identity. The package never emits it: `pino-loki` lifts a top-level
`hostname` key out of the log body into the Loki stream label, so emitting one
would overwrite the machine label *and* vanish from the body.
_Avoid_: host, server, instance

**Domain**:
Not used as a field or config name. A host may be an IP literal (`[2001:db8::1]`),
`localhost`, or an internal ingress name, none of which are domains.
_Avoid_: use **Host** instead
