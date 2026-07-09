# adonis-req-logger

> Request logging for AdonisJS — one structured, canonical log line per HTTP
> request, with per-request Lucid query stats.

```
[13:09:17.033] INFO: GET /demo/users 200 41ms · 1 query 1.9ms
[13:09:17.298] WARN: GET /demo/slow-query 200 317ms · 1 query 315.8ms
```

This is the development monorepo. The published package lives in
[`packages/adonis-req-logger`](packages/adonis-req-logger) — its
[README](packages/adonis-req-logger/README.md) has installation and
configuration docs.

## Quick start (in an AdonisJS v7 app)

```sh
node ace add adonis-req-logger
```

## Version support

Package majors track AdonisJS majors: `7.x` supports AdonisJS v7 (`main`,
npm `latest`); a `5.x` line for AdonisJS v5 is planned on branch `v5.x`
(npm tag `adonis5`). Details in the
[versioning policy](docs/ARCHITECTURE.md#versioning--support-policy).

## Repo layout

| Path                                                         | What it is                              |
| ------------------------------------------------------------ | --------------------------------------- |
| [`packages/adonis-req-logger`](packages/adonis-req-logger)   | The package published to npm            |
| [`apps/backend`](apps/backend)                               | Example AdonisJS app used as a testbed  |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)               | Design document and locked decisions    |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). This project follows the
[Contributor Covenant](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)
