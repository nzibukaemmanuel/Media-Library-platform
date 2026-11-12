# Media Library API — Lab Report

A report on the **Media Library API** lab: what the brief required, how each requirement was implemented, where to find it in the code, and how it was verified.

> **How this relates to the other documents.** [`README.md`](README.md) is the *user guide* (how to run the API and use every endpoint). This document is the *lab report*: it follows the structure of the lab brief, maps every requirement to code and tests, explains the design decisions, and records the problems found along the way. [`docs/postman/`](docs/postman/Media-Library-API.postman_collection.json) holds the Postman / Insomnia collection the brief asks for.

## Contents

1. [Overview](#1-overview)
2. [Requirements checklist](#2-requirements-checklist)
3. [Architecture](#3-architecture)
4. [How each requirement was implemented](#4-how-each-requirement-was-implemented)
5. [API endpoints](#5-api-endpoints)
6. [Database design](#6-database-design)
7. [Edge cases from the brief](#7-edge-cases-from-the-brief)
8. [Testing](#8-testing)
9. [Evaluation criteria: where the evidence is](#9-evaluation-criteria-where-the-evidence-is)
10. [Optional extension challenges](#10-optional-extension-challenges)
11. [Decisions and interpretations](#11-decisions-and-interpretations)
12. [Problems found and fixed](#12-problems-found-and-fixed)
13. [Limitations and future work](#13-limitations-and-future-work)
14. [Running and verifying the project](#14-running-and-verifying-the-project)
15. [Appendix: commit history](#15-appendix-commit-history)

---

## 1. Overview

**Scenario (from the brief).** A content team stores files by hand, with no structure, no search and no metadata. The task is a RESTful back end that accepts file uploads with metadata, lets the team search and filter the assets, validates every input, and returns consistent responses for success and failure.

**What was built**

| | |
|---|---|
| Endpoints | 14 media routes (upload one or several, list/search, get, update with `PUT` and `PATCH`, delete, tag management, bulk update/delete) plus a health check |
| Source code | A layered Express application: routes → controllers → services → repositories → PostgreSQL |
| Automated tests | **302 tests** in 7 files, all passing |
| API collection | A Postman / Insomnia collection with 23 requests, including the brief's edge cases |
| Commits | see the [appendix](#15-appendix-commit-history); each is one logical change |

**Skills exercised (the brief's learning objectives):** layered architecture; centralised error handling; request validation with Joi; single and multiple file uploads with Multer; pagination, filtering and search; async/await and promise-rejection handling.

**Technology**

| Technology | Role |
|---|---|
| Node.js (developed on 24) | Runtime; `node:test` is the test runner, so the suite adds no dependencies |
| Express 5 | HTTP framework |
| PostgreSQL + `pg` | Database (the brief leaves the choice open) |
| Joi | Request validation |
| Multer | `multipart/form-data` uploads, disk storage |
| dotenv | Configuration from `.env` |

## 2. Requirements checklist

Every requirement in the brief, where it lives, and the test that proves it. All are met.

### 1. Layered architecture

| Requirement | Status | Implementation | Verified by |
|---|---|---|---|
| Four layers: routes → controllers → services → repositories, plus middlewares, models and config | ✅ | `src/routes`, `controllers`, `services`, `repositories`, `middlewares`, `models`, `config` | `architecture.test.js` ("layers exist", "has the files the brief suggests") |
| No business logic inside route files | ✅ | `routes/mediaRoutes.js` only wires URLs to middleware and controllers | `architecture.test.js`: no inline handlers, no async code, no `req`/`res` in routes |
| Controllers delegate business logic to services | ✅ | `controllers/mediaController.js` calls `mediaService` and never a repository or the database | `architecture.test.js` ("controllers delegate to services") |
| Services delegate database operations to repositories | ✅ | `services/mediaService.js` uses `mediaRepository`, never `pg` or the pool; all SQL is in the repository | `architecture.test.js` ("services delegate…", "all SQL lives in the repositories") |
| A `Media` model | ✅ | `models/Media.js` | `media.api.test.js` ("the media object (Media model)") |

### 2. Global error handling and structured responses

| Requirement | Status | Implementation | Verified by |
|---|---|---|---|
| Centralised error middleware, registered last | ✅ | `middlewares/errorHandler.js`; `notFound` then `errorHandler` are the last registrations in `app.js` | `architecture.test.js` ("registers the error handler last"); `errors.test.js` |
| Reusable `AppError` class | ✅ | `utils/AppError.js` (status code, `isOperational`, optional field `details`) | `architecture.test.js`; every 400/404 test |
| Handle operational errors such as 404 and 400 | ✅ | Service throws `AppError`; handler maps it, plus body-parser, multer and PostgreSQL errors | `errors.test.js` (unknown routes, malformed requests, database errors) |
| Success format `{ "status": "success", "data": {} }` | ✅ | `utils/apiResponse.js` `sendSuccess` | `errors.test.js` ("uses the same format on every endpoint": exact keys) |
| Error format `{ "status": "error", "message": "...", "details": [] }` | ✅ | `utils/apiResponse.js` `sendError` | `errors.test.js`; `media.api.test.js` `assertError` checks exact keys on every error |
| Handle unhandled promise rejections | ✅ | `utils/processHandlers.js` (used by `server.js`) | child-process checks (see section 8) |
| Handle uncaught exceptions | ✅ | same | same |
| Log errors and shut down gracefully when necessary | ✅ | stops accepting connections, finishes requests in progress, closes the database pool, exits (forced after 10 s) | same |

### 3. Request validation

| Requirement | Status | Implementation | Verified by |
|---|---|---|---|
| Joi or Zod | ✅ | Joi: `validations/mediaValidation.js` | all validation tests |
| `POST /media`: `title` required, `tags` array, `category` valid enum | ✅ | `createMediaBody` (tags accept an array or a comma-separated string, since forms send text) | `upload.validation.test.js` (metadata cases); `media.api.test.js` ("requires a title", "category") |
| `PUT /media/:id`: validate metadata updates | ✅ | `updateMediaBody` (at least one field; unknown or file fields rejected) | `media.api.test.js` ("PUT /media/:id") |
| `GET /media`: `page`, `limit`, `category`, `search`, `sortBy`, `order` | ✅ | `listMediaQuery` | `media.query.test.js` |
| Reusable validation middleware that runs before controller logic | ✅ | `middlewares/validate.js`: `validate({ params, query, body })` | `errors.test.js`; route order in `routes/mediaRoutes.js` |
| Structured field-level errors (`details: [{ field, message }]`) | ✅ | the middleware builds `Validation failed` + `details` | `errors.test.js` ("validation errors") |

### 4. File uploads with Multer

| Requirement | Status | Implementation | Verified by |
|---|---|---|---|
| Disk storage, saved to `/uploads` | ✅ | `middlewares/upload.js` (`UPLOAD_DIR`, default `uploads`) | `media.api.test.js` ("stores the file…") |
| Accepted types: `image/jpeg`, `image/png`, `application/pdf` only | ✅ | `config/constants.js` `ALLOWED_FILE_TYPES`; `utils/fileTypes.js` | `upload.validation.test.js` (4 accepted, 19 rejected cases) |
| Maximum size 5 MB | ✅ | `DEFAULT_MAX_FILE_SIZE_MB = 5` (`MAX_FILE_SIZE_MB` overrides it) | `upload.validation.test.js` ("allows 5 MB by default": exactly 5 MB accepted, one byte more rejected) |
| `POST /media`: one file (`file`) + `title`, `tags`, `category` | ✅ | `uploadSingle` + `createMedia` | `media.api.test.js` |
| Store `filePath`, `originalName`, `mimeType`, `fileSize`, `title`, `tags`, `category` | ✅ | `models/Media.js` maps the fields; one row per file in `media_assets` | `media.api.test.js` ("stores the file and saves its metadata") |
| `400` for unsupported file types and oversized files | ✅ | Multer file filter and size limit, before anything is stored | `upload.validation.test.js`; nothing is left on disk or in the database |
| Single **and multiple** uploads (learning objective) | ✅ | `POST /media/multiple`, field `files`, up to 10 | `upload.multiple.test.js` (20 tests) |

### 5. Pagination, filtering and search

| Requirement | Status | Implementation | Verified by |
|---|---|---|---|
| `page` (default 1) | ✅ | `repositories/mediaRepository.js` `findAll` | `media.query.test.js` ("pagination") |
| `limit` (default 10, max 50) | ✅ | `DEFAULT_LIMIT = 10`, `MAX_LIMIT = 50` | same; `media.api.test.js` ("defaults to 10 … allows at most 50") |
| `category` filter | ✅ | exact match on the enum column | `media.query.test.js` ("filters by category") |
| `tags` filter (comma-separated) | ✅ | PostgreSQL array operator, backed by a GIN index | `media.query.test.js` ("filters by ALL of several tags") |
| `search` on the title | ✅ | case-insensitive; also matches the description and original file name; `%`, `_` and `\` match literally | `media.query.test.js` ("search") |
| `sortBy` and `order` (`asc` / `desc`) | ✅ | whitelisted fields; `id` breaks ties so paging is stable | `media.query.test.js` ("sorting", "sorting rows that all have the same value") |
| Response `{ status, data: { results, pagination: { total, page, limit, totalPages } } }` | ✅ | `controllers/mediaController.js` `listMedia` | `media.api.test.js`, `errors.test.js` (exact keys) |

### 6. Async/await and promise-rejection handling

| Requirement | Status | Implementation | Verified by |
|---|---|---|---|
| async/await throughout, no `.then()` / `.catch()` chains | ✅ | every source file | `architecture.test.js` ("no source file uses .then() or .catch()") |
| `catchAsync` utility | ✅ | `utils/catchAsync.js`; every controller is wrapped | `architecture.test.js` ("every controller is wrapped in catchAsync") |
| Handle unhandled rejections globally | ✅ | `utils/processHandlers.js` | section 8 |
| At least one use of `Promise.all()` | ✅ | `findAll` fetches the page and the total count at the same time | `architecture.test.js`; timing check in section 8 |

### API endpoints (the brief's summary table)

| Brief | Implemented |
|---|---|
| `POST /media` | ✅ (also under `/api/media`) |
| `GET /media` | ✅ |
| `GET /media/:id` | ✅ |
| `PUT /media/:id` | ✅ (`PATCH` behaves the same) |
| `DELETE /media/:id` (item **and file**) | ✅ |

### Steps and deliverables

| Item | Status |
|---|---|
| Install express, multer, joi, dotenv, a database driver (`pg`) | ✅ (`architecture.test.js` checks `package.json`) |
| Configure the Express app, create the Media model, repository, service, controllers with `catchAsync`, routes and validation middleware, Multer restrictions, global error handling, process-level handlers | ✅ |
| `uploads/` folder, `.env`, `server.js` | ✅ (`uploads/` and `.env` are git-ignored) |
| Test all endpoints with Postman / Insomnia | ✅ collection in `docs/postman/`; its 17 JSON requests were replayed against the running API |
| Test edge cases: invalid file type, oversized file, missing fields, invalid query parameters | ✅ see [section 7](#7-edge-cases-from-the-brief) |

## 3. Architecture

```
 HTTP request
      │
      ▼
┌──────────────┐   URL → middleware chain → controller (no logic)
│   Routes     │   routes/mediaRoutes.js
└──────┬───────┘
       ▼
┌──────────────┐   upload (Multer) → validate (Joi)
│ Middlewares  │   middlewares/upload.js, validate.js
└──────┬───────┘
       ▼
┌──────────────┐   read the request, call ONE service function, send the response
│ Controllers  │   controllers/mediaController.js
└──────┬───────┘
       ▼
┌──────────────┐   business rules: file checks, tag rules, file cleanup
│  Services    │   services/mediaService.js
└──────┬───────┘
       ▼
┌──────────────┐   all SQL; works with the Media model
│ Repositories │   repositories/mediaRepository.js  ◄── models/Media.js
└──────┬───────┘
       ▼
   PostgreSQL

 Any error, at any layer ──► errorHandler ──► one consistent JSON response
```

**Why layers?** Each concern changes independently and is tested independently: the SQL can be rewritten without touching the controllers, and the rules about which files are allowed are enforced in one place. The boundaries are not just a convention: `tests/architecture.test.js` reads the source and fails if a controller imports a repository, a service uses the database, a route contains logic, or SQL appears outside the repository.

```
server.js                  Entry point: connect to DB, start server, graceful shutdown
src/
├── app.js                 Express app: routes, 404, error handler (last)
├── routes/                mediaRoutes.js
├── controllers/           mediaController.js
├── services/              mediaService.js
├── repositories/          mediaRepository.js
├── models/                Media.js
├── validations/           mediaValidation.js (Joi schemas)
├── middlewares/           upload.js · validate.js · errorHandler.js
├── config/                db.js (connection pool) · constants.js (shared limits)
├── database/              schema.sql · initDb.js
└── utils/                 AppError · catchAsync · apiResponse · fileStorage ·
                           fileTypes · errorMessage · processHandlers
tests/                     7 test files + helpers/testApp.js
docs/postman/              Postman / Insomnia collection
```

`src/config/constants.js` holds every limit (allowed file types, categories, sortable fields, tag/title/page/bulk limits). The validation schemas, the service, the model and the repository all import from it, so a rule is defined in exactly one place.

## 4. How each requirement was implemented

### 4.1 Layered architecture

Each layer has one job and only talks to the layer below it.

- **Routes** (`routes/mediaRoutes.js`) contain no functions at all: each line names a URL, the middleware that runs first (upload, validation) and the controller. Fixed paths (`/tags`, `/multiple`, `/bulk-*`) are registered before `/:id`, otherwise Express would treat "tags" as an id.
- **Controllers** are thin: read `req`, call one service function, send the response through `sendSuccess`. Thirteen small functions (`PUT` and `PATCH` share one), each wrapped in `catchAsync`.
- **Services** own the rules: detect the media type, default the tags, reject empty files, delete a stored file if saving fails, refuse to edit the stored-file fields. They throw `AppError`; they know nothing about HTTP.
- **Repositories** own the SQL. Every query is parameterised, so values can never inject SQL; sort columns come from a whitelist.
- **Models** (`models/Media.js`): the one place that knows both the database's `snake_case` columns and the API's `camelCase` fields. `fromRow` converts a row to the API object (and turns PostgreSQL's string `bigint`/`numeric` values into numbers); `toColumns` whitelists the writable fields so `id` and the timestamps can never be set; `sortColumn` turns a sort field into a column name. Column names never leave the repository.

### 4.2 Global error handling and structured responses

`middlewares/errorHandler.js` registers `notFound` and `errorHandler` **last** in `app.js`. Every error, thrown in a handler, passed to `next()`, rejected in a `catchAsync` controller or raised by body parsing or Multer, ends up here and is answered in the brief's format:

```json
{ "status": "error", "message": "Validation failed", "details": [ { "field": "title", "message": "Title is required" } ] }
```

| Source of error | Response |
|---|---|
| `AppError` (validation, not found…) | its own status and message; validation errors carry field-level `details` |
| Unknown route | `404` `Route not found: METHOD /path` |
| Malformed JSON / too-large body / bad encoding | `400` / `413` / `415` |
| PostgreSQL: bad data | `400` (invalid value, too long, missing, out of range) or `409` (duplicate, linked record) |
| PostgreSQL: unreachable | `503 The service is temporarily unavailable` |
| Anything else (a bug) | `500 Internal server error` |

**Security.** For unexpected errors the client never sees the real message, SQL detail or stack trace; they are logged on the server. Only with `NODE_ENV=development` does a `stack` field appear, and never for client errors. Expected client errors (400/404/409) are not logged as failures, which keeps the log meaningful.

**Process-level handlers** (`utils/processHandlers.js`, used by `server.js`). `SIGINT`/`SIGTERM` (exit 0), an unhandled promise rejection, an uncaught exception and a failure to listen on the port (exit 1) all lead to the same shutdown: stop accepting connections, let requests already in progress finish, close the database pool, exit. A 10-second timer forces the exit if closing hangs, and it runs only once. After an escaped error the program's state cannot be trusted, so the safest response is to log it, shut down cleanly and let a process manager start a fresh instance.

### 4.3 Request validation

`validations/mediaValidation.js` defines a Joi schema for every request; `validate({ params, query, body })` applies them **before** the controller runs.

- **The brief's rules:** `POST /media` requires `title`, accepts `tags` as an array (or a comma-separated string, because HTML forms only send text) and a `category` from the enum; `PUT /media/:id` validates the metadata fields (at least one is needed); `GET /media` validates `page`, `limit`, `category`, `search`, `sortBy`, `order` and the other filters.
- **All problems are reported together**, each as `{ field, message }` with a capitalised sentence, as in the brief's example (`"Title is required"`).
- **Unknown fields are rejected**, so a client sending `filePath` or a misspelt filter gets a clear error instead of having it silently ignored.
- **Converted values reach the controller:** `"640"` becomes `640`, strings are trimmed, categories are lower-cased.
- **Express 5 detail:** `req.query` is read-only there, so the middleware replaces it through a defined property.
- **Upload clean-up:** if Multer already stored the file(s) and the form fields then fail validation, the files are deleted, so a rejected request leaves nothing on disk (for one file and for several).

### 4.4 File uploads with Multer

`middlewares/upload.js` builds the single-file and multiple-file middleware from one function.

- **Disk storage** in `UPLOAD_DIR` (default `uploads`), under a **generated name** (`<timestamp>-<uuid>.<ext>`). Two uploads with the same name can never collide, and the client's file name never reaches the file system, so `../../evil.png` cannot escape the folder. The original name is kept in `originalName`; names are decoded as UTF-8 so non-Latin names survive.
- **Restrictions** (checked before anything is written): the MIME type must be `image/jpeg`, `image/png` or `application/pdf`, **and** the file extension must agree with it (`.jpg`/`.jpeg`, `.png`, `.pdf`). The MIME type comes from the client and can be faked, so the extension is checked too: this rejects `virus.exe` sent as `image/png` and a PNG declared as a PDF. The size limit is 5 MB (`MAX_FILE_SIZE_MB` overrides it) and empty files are rejected.
- **`POST /media`** takes one file in `file` plus `title` (required), `category`, `tags` and optional `description`, `width`, `height`, `duration`. It answers `201` with the created item.
- **`POST /media/multiple`** takes up to 10 files in `files`. `category`, `description` and `tags` apply to all; each title is the file's own name. Every file is checked first and all records are saved with a **single `INSERT`**, so the request is all-or-nothing: if any file or row is refused, nothing is stored and every stored file of the request is removed.
- **Stored information:** the brief's `filePath`, `originalName`, `mimeType`, `fileSize`, `title`, `tags` and `category` are all stored, together with the generated `fileName`, the detected `mediaType` and the timestamps.

### 4.5 Pagination, filtering and search

| Brief parameter | Implementation |
|---|---|
| `page` (default 1) | 1-based; a page past the end returns an empty `results` list, not an error |
| `limit` (default 10, max 50) | `DEFAULT_LIMIT`, `MAX_LIMIT`; invalid values are a `400` |
| `category` | exact match; invalid values are a `400` |
| `tags` (comma-separated) | items having **all** the given tags |
| `search` | case-insensitive match on the title (and description and original name); `%`, `_` and `\` are escaped, so searching `100%` finds "100%" instead of acting as a wildcard |
| `sortBy` | `createdAt`, `updatedAt`, `title`, `fileSize`, `mediaType`, `originalName`, `category`; anything else is a `400` (this also closes off SQL injection through sorting) |
| `order` | `asc` / `desc`, case-insensitive, default `desc` |

Extra filters beyond the brief: `tag`, `anyTags`, `mediaType`, `mimeType`, `minSize`/`maxSize`, `createdFrom`/`createdTo`.

**`id` is always the tie-breaker.** Without it, rows with equal sort values (many items of the same category, say) can appear on two pages or on none. The tie-breaker makes paging stable; a test inserts rows with equal values in scrambled order to prove it.

### 4.6 Async/await and promise-rejection handling

- **No promise chains.** Every source file uses `async/await`; `architecture.test.js` scans the source and fails if a `.then()` or `.catch()` appears. (Multer's storage API is callback based, so its callbacks are called from inside `async/await` code.)
- **`catchAsync`** (`utils/catchAsync.js`) wraps every controller so any failure, a rejected promise or a synchronous throw, is passed to `next()`. Express 5 already forwards rejected promises, but `catchAsync` makes this explicit, covers synchronous throws the same way, and guarantees Express always receives a real `Error`: Express treats `next(undefined)`, `next(0)` or `next('route')` as *instructions*, so a handler that rejected with such a value used to fall through to the 404 handler.
- **`Promise.all`** (`findAll`): a list request needs two independent queries, the requested page and the total count for pagination. They run together instead of one after the other:

  ```js
  const [countResult, pageResult] = await Promise.all([
    pool.query(/* SELECT COUNT(*) ... */),
    pool.query(/* SELECT ... LIMIT ... OFFSET ... */),
  ]);
  ```

  A list request takes as long as the *slower* query instead of the sum. With 300 ms of artificial latency on each query, both started within a few milliseconds of each other and the call took about 300–450 ms instead of 600+. If one query fails, `Promise.all` rejects and the error handler takes over, without leaving an unhandled rejection (which matters, because an unhandled rejection shuts the process down). The two queries are not one snapshot, so under concurrent writes the total can differ by one row from the page, which is harmless for pagination.

## 5. API endpoints

The paths are `/media/...`; `/api/media/...` is an alias that behaves identically. The full reference, with request parameters and real responses, is in the [README](README.md#endpoints).

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/media` | Upload one file with metadata |
| `POST` | `/media/multiple` | Upload up to 10 files |
| `GET` | `/media` | List with search, filters, sorting, pagination |
| `GET` | `/media/:id` | One item |
| `PUT` / `PATCH` | `/media/:id` | Update metadata |
| `DELETE` | `/media/:id` | Delete the item **and its file** |
| `GET` | `/media/tags` | All tags with counts |
| `POST` / `DELETE` | `/media/:id/tags` | Add / remove tags on one item |
| `PATCH` | `/media/tags/rename` | Rename a tag everywhere |
| `DELETE` | `/media/tags/:tag` | Remove a tag everywhere |
| `POST` | `/media/bulk-update` | Same change to many items |
| `POST` | `/media/bulk-delete` | Delete many items and files |
| `GET` | `/api/health` | Health check |

## 6. Database design

One table, `media_assets` (`src/database/schema.sql`):

| Column | Type | Notes |
|---|---|---|
| `id` | `SERIAL` primary key | |
| `title` | `VARCHAR(255)` not null | |
| `description` | `TEXT` | optional |
| `category` | enum `media_category`, default `general` | `general`, `marketing`, `design`, `documentation`, `reports`, `other` |
| `media_type` | enum `media_type` | the enum lists image, video, audio, document; uploads produce `image` and `document` |
| `file_name` | `VARCHAR(255)` | generated name on disk |
| `original_name` | `VARCHAR(255)` | the name the user uploaded |
| `file_path` | `TEXT` | where the file is stored |
| `mime_type` | `VARCHAR(127)` | |
| `file_size` | `BIGINT`, `CHECK >= 0` | bytes |
| `width`, `height` | `INTEGER`, `CHECK > 0` | optional |
| `duration` | `NUMERIC(10,2)`, `CHECK >= 0` | optional, seconds |
| `tags` | `TEXT[]`, default `{}` | PostgreSQL array |
| `created_at`, `updated_at` | `TIMESTAMPTZ` default `now()` | |

**Design choices.** Enums for `media_type` and `category` make the database itself reject an invalid value; `CHECK` constraints are the last line of defence behind the Joi validation; tags as an array keep the lab to one table and make "has all these tags" a single operator, backed by a **GIN index**; indexes on type, category and `created_at DESC` (the default sort); a `BEFORE UPDATE` **trigger** keeps `updated_at` current so no code path can forget to.

**The schema script is idempotent and upgrades older databases.** `npm run db:init` uses `IF NOT EXISTS` / `CREATE OR REPLACE`, and `ALTER TABLE … ADD COLUMN IF NOT EXISTS category …` adds the new column to a database created before categories existed (existing rows become `general`). This was checked on a scratch database that held a row created by the old schema, and `tests/database.init.test.js` re-checks the behaviour.

## 7. Edge cases from the brief

The brief lists four edge cases to test. Each is covered by automated tests and by a request in the Postman collection's **Edge cases** folder.

| Edge case | Result | Automated tests |
|---|---|---|
| **Invalid file type** | `400` `Unsupported file type: video/mp4. Allowed types: image/jpeg, image/png, application/pdf`; also a name that disagrees with the type (`A .exe file is not allowed for image/png`). Nothing is stored | `upload.validation.test.js` ("file type and extension": 19 rejected cases); `upload.multiple.test.js` |
| **Oversized file** | `400` `File is too large (max 5 MB)`. Exactly 5 MB is accepted, one byte more is rejected. Nothing is stored | `upload.validation.test.js` ("file size", "allows 5 MB by default") |
| **Missing fields** | `400` `Validation failed` with `details` naming the field (`Title is required`); a missing file is `A file is required`. The uploaded file is removed | `media.api.test.js` ("requires a title"); `upload.validation.test.js` (metadata cases) |
| **Invalid query parameters** | `400` `Validation failed` listing every bad parameter (`page`, `limit`, `order`, `sortBy`, `category`, dates, sizes) | `media.query.test.js` (dozens of rejected inputs); `errors.test.js` |

## 8. Testing

### Strategy

- **Real app, real database.** The tests start the actual Express app on a random port and call it over HTTP against PostgreSQL. Nothing important is mocked, so they exercise routing, validation, Multer, the service, SQL and error handling together.
- **A separate test database.** `media_library_test` (configurable with `TEST_DB_NAME`) is created automatically and emptied between tests. The helper **refuses to run unless the name ends in `_test`**, so the tests can never touch real data. Uploads go to a temporary folder.
- **Failures are simulated** by temporarily replacing `pool.query` with a function that throws (an outage, a constraint violation, a bug), because they cannot be triggered on demand.
- **Structure is tested too.** `architecture.test.js` reads the source and enforces the brief's structural rules (see section 2).
- **No new dependencies:** Node's built-in `node:test`. `npm test` runs files one at a time because they share the database.

### Coverage

| File | Tests | Focus |
|---|---|---|
| `tests/architecture.test.js` | 23 | Layers, boundaries, no logic in routes, no SQL outside the repository, no promise chains, `catchAsync`, `Promise.all`, error handler last |
| `tests/media.api.test.js` | 55 | Every endpoint, the media object, categories, both path prefixes, `PUT`, `order`, page sizes |
| `tests/upload.validation.test.js` | 64 | Accepted and rejected types, extensions, 5 MB limit, file names, multipart shape, metadata, cleanup |
| `tests/upload.multiple.test.js` | 20 | Multiple upload: storage, shared fields, limits, all-or-nothing |
| `tests/media.query.test.js` | 81 | Pagination, sorting (including ties), every filter, search |
| `tests/errors.test.js` | 53 | Error handling, response formats, simulated database failures, development vs production |
| `tests/database.init.test.js` | 6 | `npm run db:init`: applies, re-runs, keeps data, category column, error reporting |
| **Total** | **302** | all passing |

### Process-level handlers

These cannot be tested inside the test runner (they end the process), so they were checked by running the real `server.js` in child processes and by driving the handler logic with a fake process object: each signal and failure type, a double trigger, a database that fails to close, a forced exit after the timeout, an in-flight request that finishes before the exit, and idle keep-alive connections that must not delay shutdown. The listen error (port in use) is simulated, because Windows lets two sockets share a port.

### Do the tests catch problems?

A test suite that has never failed has not proved it can. After writing each suite the code was **deliberately broken** and the matching tests had to fail. Examples from this lab:

| Deliberate breakage | Caught? |
|---|---|
| Default upload limit changed back to 50 MB | yes |
| The extension no longer has to agree with the MIME type | yes, by several tests |
| A rejected multiple upload leaves its files on disk | yes |
| The `/media` path prefix not mounted; the `PUT` route removed | yes |
| Default page size back to 20 | yes |
| LIKE wildcards not escaped; `maxSize` made exclusive; search ignoring the description | yes |
| The `id` tie-breaker removed from sorting | yes (the first version of this test did **not** catch it, so it was strengthened) |
| A controller importing a repository; SQL in a service; a `.then()` chain added | yes, by the architecture tests |
| 500 responses leaking the real message; stacks sent for client errors; server errors not logged; the `catchAsync` bug put back | yes |

The Postman collection was also checked: its 17 requests that need no file were replayed against the running API and each returned the status the collection claims.

## 9. Evaluation criteria: where the evidence is

| Criterion | Weight | Evidence |
|---|---|---|
| **Layered architecture** | 20% | Four layers plus middlewares, models and config, as in the brief's suggested structure; `Media` model implemented; boundaries enforced by `architecture.test.js` (section 4.1) |
| **Global error handling** | 20% | `AppError`; one `errorHandler` registered last; exact `status`/`message`/`details` format on every error; process-level handlers with graceful shutdown (section 4.2); `errors.test.js` |
| **Request validation** | 15% | Joi schemas for upload, update and list; reusable `validate` middleware before the controller; field-level `details` (section 4.3) |
| **File upload handling** | 20% | Multer disk storage, JPEG/PNG/PDF and 5 MB, `POST /media`, metadata stored, single and multiple uploads, nothing left behind on rejection (section 4.4) |
| **Pagination, filtering & search** | 15% | All brief parameters plus extra filters; the exact `results`/`pagination` response; stable sorting (section 4.5) |
| **Async/await & promise handling** | 10% | No promise chains (tested), `catchAsync` on every controller, `Promise.all` for records + total count, global rejection handlers (section 4.6) |

## 10. Optional extension challenges

| Extension | Status |
|---|---|
| Multiple file uploads | ✅ `POST /media/multiple` (all-or-nothing) |
| Cloud storage (Cloudinary, AWS S3) | not done: files are stored on local disk |
| Authentication and authorization | not done |
| Image thumbnail generation | not done |
| Soft delete | not done: delete is permanent |
| Audit logging | not done: only server failures are logged |

Beyond the brief the API also offers tag management (add, remove, rename, delete, counts), bulk update and delete, extra filters (size, date range, MIME type), and an alias path under `/api/media`.

## 11. Decisions and interpretations

Where the brief left room, these are the choices made and why.

| Topic | Decision | Reasoning |
|---|---|---|
| Category values | `general` (default), `marketing`, `design`, `documentation`, `reports`, `other` | The brief says "valid enum" without listing values; these suit a content team. They live in one constant and one SQL enum |
| Category required? | Optional, default `general` | Only `title` is marked required in the brief |
| `PUT` semantics | Updates only the fields sent; `PATCH` behaves identically | The stored file can never be replaced, so a full replacement would add nothing |
| Paths | `/media` is primary; `/api/media` is an alias | Matches the brief's endpoint table while keeping the earlier path working |
| `tags` filter | Items having **all** the given tags | The brief says "comma-separated tags" without saying all or any; `anyTags` gives the other meaning |
| `search` | Matches title, description and original name, not only the title | More useful for a content team; the title is always included |
| Success responses | Exactly `status` and `data`: no `message`, `meta` or `count` | Follows the brief's example format literally |
| Validation `details` | `{ field, message }` only; `field` is `null` for a problem with the whole request | The brief's example; a client can show each message next to its field |
| Pagination object | exactly `total`, `page`, `limit`, `totalPages` | The brief's example |
| Camel-case fields | `filePath`, `originalName`, `mimeType`, `fileSize` | The names used in the brief; the database keeps `snake_case`, and the Media model maps between them |
| Numeric fields | `fileSize` and `duration` are numbers | PostgreSQL returns `bigint`/`numeric` as strings; the model converts them |
| Record deleted before the file | The database record is the source of truth | A stuck file never blocks deletion; a failed file delete is reported as `fileDeleted: false` |
| `page` and `offset` | mutually exclusive | One unambiguous way to page |
| Exit after an unhandled rejection or uncaught exception | yes | State is no longer trustworthy; a fresh process is safest (needs a process manager to restart) |

## 12. Problems found and fixed

Real defects discovered while building and testing, and how each was resolved.

| # | Problem | How it was found | Fix | Commit |
|---|---|---|---|---|
| 1 | The API differed from the lab brief in several places: no `category`, a different response format, many more file types and a 50 MB limit, optional `title`, `PATCH` only, `/api/media` only, `sortOrder` instead of `order`, limits 20/100 instead of 10/50, an empty `Media` model | Re-reading the actual brief after the first implementation was complete | Five alignment commits (see below) | `d76164d`, `8a2f6c4`, `1fa5e3c`, `b5689e6`, and the final commit |
| 2 | A rejected **multiple** upload would have left all its files on disk: the validation middleware deleted only `req.file` | The new multiple-upload tests | Delete `req.files` as well | `1fa5e3c` |
| 3 | Response field order depended on the table's column history (a column added by an upgrade comes last) | Capturing real responses for the README | The model emits fields in a fixed order | final commit |
| 4 | Non-ASCII file names were corrupted (`写真.png` → `å†™çœŸ.png`) | Upload edge-case tests | Decode file names as UTF-8 | `50e9814` |
| 5 | Empty (0-byte) files were accepted as media | same | Reject with `400` | `50e9814` |
| 6 | Too many tags, or a too-long tag, was not reported against the `tags` field | same | Check each tag of a comma-separated string in the schema | `50e9814` |
| 7 | An async handler that rejected with `undefined`, `0`, `''` or `'route'` fell through to a false "Route not found" | Error-handling tests | `catchAsync` always passes a real `Error` | `43df566` |
| 8 | `maxSize` alone and `createdTo` alone were rejected; blank `?search=` caused errors | List-validation tests | Compare only when the other value is present; blank means "not provided" | `1ebbe15` |
| 9 | A fractional `MAX_FILE_SIZE_MB` crashed uploads (Multer needs whole bytes) | Upload route test | Round down to whole bytes | `8801c96` |
| 10 | Shutdown could hang about 5 s: an idle keep-alive connection that went idle after shutdown began stayed open | Shutdown test with an in-flight request | Keep closing idle connections until the server is down | `6641e6c` |
| 11 | On a port conflict the server printed "Server running…" while nothing was listening: Express 5 passes listen errors to the callback, which ignored them | Child-process shutdown test | Check the callback's error argument and shut down | `6641e6c` |
| 12 | `connectDB` leaked a pooled connection when a query failed; `db:init` printed an empty error for a refused connection | Async audit | `pool.query`; one `getErrorMessage` helper | `d3f0b56` |
| 13 | A weak test: the id tie-breaker could be removed without any test failing (PostgreSQL happened to return ties in id order) | Deliberate breakage check | Insert rows with explicit ids in scrambled order | `fac1ca8` |

**How the alignment with the brief was done (item 1).** The brief was applied in five commits, each leaving the whole suite green:

1. **Category and the Media model:** the `category` enum end to end (schema, validation, storage, filter), `models/Media.js`, the brief's camelCase field names with numeric `fileSize`, and a required `title`.
2. **Response format:** `{ status, data }`, `{ status, message, details }` and `data.results`/`data.pagination`.
3. **Uploads:** JPEG/PNG/PDF only, 5 MB, and multiple-file upload.
4. **Routes and query parameters:** `/media`, `PUT`, `order`, limits 10/50.
5. **Cleanup and documentation:** the last `.catch`, structure tests, a stable field order, the Postman collection, and these documents.

## 13. Limitations and future work

1. **Files cannot be downloaded.** The API stores files and manages metadata, but no endpoint returns a file's contents. This is the biggest functional gap.
2. **No authentication or authorisation** (an optional extension). Anyone who can reach the API can upload, edit and delete.
3. **`filePath` exposes the server's disk path** in every response; a public API should not reveal it (a download URL would replace it).
4. **Content is not inspected.** The type check uses the file name and the client-reported type; a renamed non-image would pass. Real content sniffing needs an extra package (for example `file-type`).
5. **Local-disk storage** ties files to one server (cloud storage is an optional extension).
6. **No rate limiting**, no soft delete, no audit log, no thumbnails.
7. **The `media_type` enum still lists `video` and `audio`**, which uploads can no longer produce. Removing values from a PostgreSQL enum is awkward, and leaving them is harmless.

## 14. Running and verifying the project

Full instructions are in the [README](README.md#quick-start). In short:

```bash
npm install
cp .env.example .env      # then fill in your PostgreSQL details
npm run db:init           # create / upgrade the table (safe to repeat)
npm run dev               # start the API
npm test                  # run the 302 tests (creates its own test database)
```

**A two-minute demonstration** (with the server running):

```bash
curl http://localhost:3000/api/health

# upload an image with metadata
curl -X POST http://localhost:3000/media -F "file=@photo.png" -F "title=My photo" -F "category=design" -F "tags=demo, test"

# search, filter, sort and page
curl "http://localhost:3000/media?search=photo&category=design&tags=demo&sortBy=title&order=asc&page=1&limit=10"

# a rejected upload shows the validation and error handling
curl -X POST http://localhost:3000/media -F "file=@clip.mp4;type=video/mp4" -F "title=A clip"
```

Or import [`docs/postman/Media-Library-API.postman_collection.json`](docs/postman/Media-Library-API.postman_collection.json) into Postman or Insomnia and run **Upload a file**, then the other folders.

## 15. Appendix: commit history

Every change is a single logical commit. In order:

| # | Commit | Message |
|---|---|---|
| 1 | `ca75ae3` | Add package.json |
| 2 | `166eeeb` | Add dependencies, lockfile and gitignore |
| 3 | `d97b681` | Update dependencies |
| 4 | `4e8bd04` | Update dependencies |
| 5 | `846f886` | Add server and source files |
| 6 | `0bf3e63` | Update package.json |
| 7 | `737f5a1` | Add .env.example and fix .gitignore |
| 8 | `74d6fed` | Set up Express app with JSON parsing, health check and 404 handler |
| 9 | `f3bbaba` | Implement server entry point that starts the Express app |
| 10 | `0fc6b5b` | Add layered project structure and joi/multer dependencies |
| 11 | `23e18be` | Implement PostgreSQL connection pool in config/db.js |
| 12 | `f723087` | Add PostgreSQL schema for media assets and db:init script |
| 13 | `371de22` | Configure PostgreSQL connection and connect on server startup |
| 14 | `ae91295` | Use node: prefix for built-in module imports in initDb.js |
| 15 | `463f61d` | Implement media repository CRUD operations |
| 16 | `e8a2d65` | Mark startServer() promise as intentionally ignored in server.js |
| 17 | `a4a7eb7` | Add search and filtering to media repository |
| 18 | `22ec733` | Use String.raw for the LIKE escape replacement in escapeLike |
| 19 | `db19471` | Add pagination metadata, limit validation and more sort columns |
| 20 | `0c0ccb6` | Implement AppError class for expected, client-facing errors |
| 21 | `d35785f` | Implement media service business logic |
| 22 | `722fae4` | Add bulk update and library-wide tag operations to media repository |
| 23 | `10f7e50` | Add media metadata management to the service |
| 24 | `8fa7eca` | Add safe file storage helper and bulk delete to repository |
| 25 | `1bdcaf9` | Implement media file deletion logic in the service |
| 26 | `ac619f7` | Implement catchAsync wrapper for async route handlers |
| 27 | `c8bb8d3` | feat: implement media controllers |
| 28 | `8801c96` | Implement multer upload middleware and export detectMediaType |
| 29 | `adbc1df` | Configure media API routes under /api/media |
| 30 | `1497532` | feat: define Joi validation schemas for media requests |
| 31 | `b638328` | feat: implement reusable request validation middleware |
| 32 | `15e6227` | feat: validate media upload and update requests |
| 33 | `1ebbe15` | feat: validate media search and pagination parameters |
| 34 | `1b65a32` | feat: implement media file type and size restrictions |
| 35 | `583c64e` | feat: implement centralized error handling middleware |
| 36 | `45d0625` | feat: standardize API success and error responses |
| 37 | `6641e6c` | feat: handle unhandled promise rejections and uncaught exceptions |
| 38 | `2dedf4c` | feat: implement parallel media retrieval using Promise.all |
| 39 | `d3f0b56` | refactor: standardize async await error handling |
| 40 | `438560b` | test: add media API endpoint tests |
| 41 | `50e9814` | fix: handle unicode file names, empty uploads and tag limits in uploads |
| 42 | `d8af3b2` | test: cover media upload validation edge cases |
| 43 | `43df566` | fix: pass a real Error to Express from catchAsync |
| 44 | `fac1ca8` | test: verify pagination filtering and search functionality |
| 45 | `5249750` | test: verify global error handling and API responses |
| 46 | `b09fcf2` | chore: document env settings and ignore uploads |
| 47 | `7189409` | docs: document media library API endpoints and usage |
| 48 | `d76164d` | feat: add media category and implement the Media model |
| 49 | `8a2f6c4` | feat: standardize responses to the lab's status/data/details format |
| 50 | `1fa5e3c` | feat: align file uploads with the brief (JPEG/PNG/PDF, 5 MB, multiple files) |
| 51 | `b5689e6` | feat: align routes and query parameters with the brief |
| 52 | *(this commit)* | feat: finish the lab alignment: structure tests, documentation and API collection |
