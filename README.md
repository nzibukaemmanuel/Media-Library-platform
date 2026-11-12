# Media Library Platform

A REST API for a content team's media library. Upload images and PDFs together with metadata (title, category, tags), then search, filter, sort, page through, edit and delete them.

Built with Node.js, Express 5, PostgreSQL, Joi (validation) and Multer (uploads), organised in four layers: routes → controllers → services → repositories.

- [Quick start](#quick-start)
- [Configuration](#configuration)
- [API conventions](#api-conventions)
- [The media object](#the-media-object)
- [Endpoints](#endpoints)
  - [Upload one file](#upload-one-file) · [Upload several files](#upload-several-files) · [List and search](#list-and-search-media) · [Get one](#get-one-media-item) · [Update](#update-media) · [Delete](#delete-media)
  - [Tags](#tags) · [Bulk operations](#bulk-operations) · [Health check](#health-check)
- [Upload rules](#upload-rules)
- [Errors](#errors)
- [Testing the API with Postman or Insomnia](#testing-the-api-with-postman-or-insomnia)
- [Project structure](#project-structure)
- [Running the automated tests](#running-the-automated-tests)
- [Known limitations](#known-limitations)

See also [`LAB_DOCUMENTATION.md`](LAB_DOCUMENTATION.md) for the lab report: requirements, design decisions, and how each requirement was met and verified.

## Quick start

**Requirements:** a recent Node.js (developed and tested on Node 24; `npm test` relies on `node --test` glob support, which needs Node 21 or newer) and a running PostgreSQL server.

```bash
npm install

# 1. Create your settings file and fill in your PostgreSQL details
cp .env.example .env          # Windows (cmd): copy .env.example .env

# 2. Create the database named in DB_NAME (once), e.g. with psql:
#    CREATE DATABASE media_library;

# 3. Create the tables (safe to run again; also upgrades an older database)
npm run db:init

# 4. Start the server
npm run dev      # restarts on file changes (nodemon)
npm start        # plain Node, for production
```

The server logs `Server running on http://localhost:3000` (or your `PORT`). Check it:

```bash
curl http://localhost:3000/api/health
```

> **Upgrading an existing database?** Run `npm run db:init` once. It adds the `category` column (existing items become `general`) and leaves your data untouched.

The server refuses to start if it cannot reach the database, and shuts down cleanly (finishing requests in progress, then closing database connections) on `Ctrl+C`, on a stop signal, and after an unexpected crash such as an unhandled promise rejection.

## Configuration

Settings are read from environment variables, loaded from a `.env` file. `.env` is ignored by git; `.env.example` shows every setting.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5000` | Port the server listens on |
| `NODE_ENV` | – | Set to `development` to include a stack trace in unexpected-error (500/503) responses. Leave it unset or `production` in live use |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | – | Database name (required) |
| `DB_USER` | – | Database user |
| `DB_PASSWORD` | – | Database password |
| `UPLOAD_DIR` | `uploads` | Folder for uploaded files, created on demand. Relative paths resolve from where you start the server. Files are only ever deleted from inside this folder |
| `MAX_FILE_SIZE_MB` | `5` | Largest accepted upload, in megabytes |
| `TEST_DB_NAME` | `media_library_test` | Database used by `npm test`. Must end in `_test` |

## API conventions

- **Base path:** the media endpoints live under `/media`. `/api/media` is kept as an alias that behaves identically.
- **Request bodies:** JSON (`Content-Type: application/json`), except uploading files, which is `multipart/form-data`. JSON bodies are limited to 100 KB.
- **Every response is JSON** in one of two formats, so a client only has to check `status`.

**Success**

```json
{
  "status": "success",
  "data": {}
}
```

- `data` is always present: the resource, a list object, or an object describing the result.
- Lists are `data: { "results": [...], "pagination": { "total", "page", "limit", "totalPages" } }`.

**Error**

```json
{
  "status": "error",
  "message": "Validation failed",
  "details": [
    { "field": "title", "message": "Title is required" }
  ]
}
```

- Errors never contain `data`.
- `details` is always present. For validation failures it lists every problem as `{ field, message }` (`field` is `null` for a problem with the request as a whole). For every other error it is an empty array.
- Validation failures always have the message `Validation failed`; all other errors describe what went wrong in `message`.

**Status codes**

| Code | Meaning |
|---|---|
| `200` | Success |
| `201` | Created (upload) |
| `400` | The request is invalid: bad parameters, bad body, rejected file |
| `404` | The route or the media item does not exist |
| `409` | The database rejected the change because of a conflict |
| `413` | The request body is too large |
| `415` | Unsupported request encoding |
| `500` | Unexpected server error (details are logged, never sent) |
| `503` | The database is temporarily unavailable |

## The media object

Every endpoint that returns a media item uses this shape:

```json
{
  "id": 1,
  "title": "Beach sunset",
  "description": "Evening at the coast",
  "category": "design",
  "mediaType": "image",
  "fileName": "1794498277901-52555a87-9a33-4b75-83d9-6695e31b31b3.png",
  "originalName": "beach.png",
  "filePath": "/srv/media-library/uploads/1794498277901-52555a87-9a33-4b75-83d9-6695e31b31b3.png",
  "mimeType": "image/png",
  "fileSize": 17,
  "width": null,
  "height": null,
  "duration": null,
  "tags": ["summer", "beach"],
  "createdAt": "2026-11-12T15:44:37.908Z",
  "updatedAt": "2026-11-12T15:44:37.908Z"
}
```

| Field | Type | Notes |
|---|---|---|
| `id` | integer | Assigned by the database |
| `title` | string | Required on upload, 1 to 255 characters |
| `description` | string or `null` | Up to 5000 characters |
| `category` | string | One of `general` (default), `marketing`, `design`, `documentation`, `reports`, `other` |
| `mediaType` | string | `image` (JPEG, PNG) or `document` (PDF), detected from the file. Cannot be changed |
| `fileName` | string | Generated name the file is stored under (timestamp + UUID + extension) |
| `originalName` | string | The name the file had when it was uploaded |
| `filePath` | string | Absolute path of the file **on the server** (the examples use a Linux path; yours is wherever `UPLOAD_DIR` points) |
| `mimeType` | string | `image/jpeg`, `image/png` or `application/pdf` |
| `fileSize` | number | Size in bytes |
| `width`, `height` | integer or `null` | Pixels; optional, you supply them |
| `duration` | number or `null` | Seconds, two decimals; optional, you supply it |
| `tags` | string array | Lower-case, no duplicates, at most 20, each up to 50 characters |
| `createdAt`, `updatedAt` | ISO 8601 string | `updatedAt` changes automatically on every update |

`mediaType`, `fileName`, `originalName`, `filePath`, `mimeType` and `fileSize` describe the stored file and can never be edited through the API.

## Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/media` | Upload one media file |
| `POST` | `/media/multiple` | Upload several files at once |
| `GET` | `/media` | List media with search, filters, sorting and pagination |
| `GET` | `/media/:id` | Get one media item |
| `PUT` / `PATCH` | `/media/:id` | Update media metadata |
| `DELETE` | `/media/:id` | Delete the item and its file |
| `GET` | `/media/tags` | All tags with usage counts |
| `POST` / `DELETE` | `/media/:id/tags` | Add or remove tags on one item |
| `PATCH` | `/media/tags/rename` | Rename a tag everywhere |
| `DELETE` | `/media/tags/:tag` | Remove a tag everywhere |
| `POST` | `/media/bulk-update` | Apply the same change to many items |
| `POST` | `/media/bulk-delete` | Delete many items and their files |
| `GET` | `/api/health` | Health check |

Examples use `curl` against `http://localhost:3000`. The responses are real output from the running API.

### Upload one file

`POST /media` — `multipart/form-data`

| Form field | Required | Description |
|---|---|---|
| `file` | yes | The file: JPEG, PNG or PDF, at most 5 MB. One file per request; the field must be named `file` |
| `title` | **yes** | 1 to 255 characters |
| `category` | no | One of the categories above (default `general`) |
| `tags` | no | `"a, b"`, or repeat the field once per tag |
| `description` | no | Up to 5000 characters |
| `width`, `height` | no | Positive whole numbers |
| `duration` | no | Seconds, zero or more |

```bash
curl -X POST http://localhost:3000/media \
  -F "file=@beach.png" \
  -F "title=Beach sunset" \
  -F "category=design" \
  -F "tags=Summer, beach" \
  -F "description=Evening at the coast"
```

**201 Created**

```json
{
  "status": "success",
  "data": {
    "id": 1,
    "title": "Beach sunset",
    "description": "Evening at the coast",
    "category": "design",
    "mediaType": "image",
    "fileName": "1794498277901-52555a87-9a33-4b75-83d9-6695e31b31b3.png",
    "originalName": "beach.png",
    "filePath": "/srv/media-library/uploads/1794498277901-52555a87-9a33-4b75-83d9-6695e31b31b3.png",
    "mimeType": "image/png",
    "fileSize": 17,
    "width": null,
    "height": null,
    "duration": null,
    "tags": ["summer", "beach"],
    "createdAt": "2026-11-12T15:44:37.908Z",
    "updatedAt": "2026-11-12T15:44:37.908Z"
  }
}
```

A rejected upload (wrong type, too large, missing title...) always returns `400` and leaves nothing behind: no file in the upload folder and no database record. See [Upload rules](#upload-rules).

### Upload several files

`POST /media/multiple` — `multipart/form-data`

Send up to 10 files in the form field **`files`** (repeat the field once per file). `category`, `description` and `tags` are optional and apply to every file; each item's title is its file name. `title`, `width`, `height` and `duration` are per-file details and are not accepted here.

```bash
curl -X POST http://localhost:3000/media/multiple \
  -F "files=@banner.jpg" -F "files=@flyer.pdf" \
  -F "category=marketing" -F "tags=campaign"
```

**201 Created** — `data: { "results": [ ...one media object per file, in the order sent... ] }`

The request is **all or nothing**: every file is checked before anything is saved and the records are created with a single statement, so if one file is invalid (or the database refuses one) nothing is stored.

### List and search media

`GET /media`

All parameters are optional and combine with AND. An empty value (`?search=`) is treated as if the parameter were not sent. Unknown parameters are rejected.

| Parameter | Description |
|---|---|
| `page` | Page number, starting at 1 (default `1`) |
| `limit` | Results per page, 1 to **50** (default **10**) |
| `category` | Only items in this category |
| `tags` | Items that have **all** of these comma-separated tags (`tags=summer,beach`) |
| `search` | Text to find in the title, description or original file name. Case-insensitive, matches part of a word; `%`, `_` and `\` match literally. Up to 255 characters |
| `sortBy` | Field to sort by: `createdAt` (default), `updatedAt`, `title`, `fileSize`, `mediaType`, `originalName` or `category` |
| `order` | `asc` or `desc` (default `desc`) |

Further filters: `tag` (a single tag), `anyTags` (at least one of these tags), `mediaType` (`image` or `document`, one or several), `mimeType` (exact), `minSize` / `maxSize` (bytes, inclusive) and `createdFrom` / `createdTo` (ISO 8601, inclusive). `offset` can be used instead of `page`, but not together with it.

Items with equal values are ordered by `id`, so paging through them never repeats or skips an item.

```bash
curl "http://localhost:3000/media?category=marketing&tags=summer&sortBy=title&order=asc&page=1&limit=10"
```

**200 OK** (items shortened here)

```json
{
  "status": "success",
  "data": {
    "results": [
      { "id": 2, "title": "Summer brochure", "category": "marketing", "mediaType": "document", "tags": ["summer"] }
    ],
    "pagination": { "total": 1, "page": 1, "limit": 10, "totalPages": 1 }
  }
}
```

`pagination.total` is the number of items matching the filters across all pages. A page past the end returns `200` with an empty `results` list.

### Get one media item

`GET /media/:id` → `200` with the [media object](#the-media-object) in `data`, or `404` if it does not exist.

### Update media

`PUT /media/:id` or `PATCH /media/:id` — JSON body with at least one of `title`, `description`, `category`, `tags`, `width`, `height`, `duration`. Both methods behave the same: only the fields you send are changed, because the stored file can never be replaced. Sending `tags` **replaces** the whole tag list (use the tag endpoints below to add or remove individual tags). Any other field, such as `filePath` or `mediaType`, is rejected.

```bash
curl -X PUT http://localhost:3000/media/1 \
  -H "Content-Type: application/json" \
  -d '{ "title": "Beach at sunset", "tags": ["summer", "coast"] }'
```

**200 OK** — `data`: the updated media object.

### Delete media

`DELETE /media/:id` removes the record and then the stored file.

```json
{
  "status": "success",
  "data": { "id": 2, "fileDeleted": true }
}
```

The record is the source of truth: if the file was already gone or could not be removed, the record is still deleted and `fileDeleted` is `false`. A file outside the upload folder is never deleted.

### Tags

Tags are lower-cased, trimmed and de-duplicated. They can be sent as a comma-separated string (`"a, b"`) or an array (`["a", "b"]`).

| Endpoint | Body | Description |
|---|---|---|
| `GET /media/tags` | – | Every tag with how many items use it, most used first |
| `POST /media/:id/tags` | `{ "tags": ["holiday"] }` | Add tags to one item, keeping the existing ones |
| `DELETE /media/:id/tags` | `{ "tags": ["holiday"] }` | Remove tags from one item; tags it does not have are ignored |
| `PATCH /media/tags/rename` | `{ "from": "coast", "to": "seaside" }` | Rename a tag on every item. If an item already has the new tag the two merge |
| `DELETE /media/tags/:tag` | – | Remove a tag from every item |

`DELETE /media/:id/tags` takes a JSON body. Some HTTP clients and proxies drop request bodies on `DELETE`; if yours does, replace the whole tag list with `PUT /media/:id` instead.

`GET /media/tags` → `data` is the list:

```json
{
  "status": "success",
  "data": [
    { "tag": "campaign", "count": 2 },
    { "tag": "summer", "count": 2 },
    { "tag": "work", "count": 1 }
  ]
}
```

`PATCH /media/tags/rename` → `{ "status": "success", "data": { "tag": "seaside", "previousTag": "coast", "changed": 1 } }`. Renaming or deleting a tag nobody has returns `404`.

### Bulk operations

Both take 1 to 100 unique ids. Ids that do not exist do not fail the request; they are reported in `notFound`.

**`POST /media/bulk-update`** — body: `{ "ids": [1, 2], ...fields }` with at least one of `title`, `description`, `category`, `tags`, `width`, `height`, `duration`. The same values are applied to every item.

```json
{
  "status": "success",
  "data": {
    "updated": [ { "id": 2, "category": "general" }, { "id": 1, "category": "general" } ],
    "notFound": [9999]
  }
}
```

(`updated` holds the full media objects; shortened here.)

**`POST /media/bulk-delete`** — body: `{ "ids": [1, 9999] }`

```json
{
  "status": "success",
  "data": { "deleted": [1], "notFound": [9999], "filesNotDeleted": [] }
}
```

`filesNotDeleted` lists items whose record was deleted but whose file could not be removed, so you can clean those up by hand.

### Health check

`GET /api/health` → `200` with `data: { "message": "Server is running successfully" }`. `GET /` returns a short welcome message.

## Upload rules

Uploads are checked **before** anything is stored. A file is accepted only if all of these hold:

1. **The type is one of three:** `image/jpeg`, `image/png` or `application/pdf`. Anything else (GIF, WebP, video, audio, Word, text, HTML, SVG, archives...) is rejected.
2. **The extension agrees with the type.** The MIME type is sent by the client and can be faked, so the file name must also fit it:

   | Type | Allowed extensions |
   |---|---|
   | `image/jpeg` | `.jpg` `.jpeg` |
   | `image/png` | `.png` |
   | `application/pdf` | `.pdf` |

   Extensions are case-insensitive and only the last one counts (`photo.exe.png` is a PNG; `photo.png.exe` is rejected). A file with no extension is rejected.
3. **The size is at most `MAX_FILE_SIZE_MB`** (default 5 MB) and the file is **not empty**.
4. **One file in the field `file`** (`/media`), or up to 10 files in the field `files` (`/media/multiple`).
5. **The other fields are valid:** a `title` is required on a single upload; see the field table above. No other fields are allowed.

Stored files are saved under a generated name (`<timestamp>-<uuid>.<ext>`), never under the name the client sent, so names cannot collide and a path in a file name (`../../x.png`) can never escape the upload folder. The original name, including spaces and non-Latin characters, is kept in `originalName`.

> The type check looks at the file name and the type the client reports, not at the file's actual contents.

## Errors

All errors use the [error format](#api-conventions). Real examples:

**Validation (400)** — every problem is listed:

```json
{
  "status": "error",
  "message": "Validation failed",
  "details": [
    { "field": "title", "message": "Title is required" },
    { "field": "category", "message": "Category must be one of: general, marketing, design, documentation, reports, other" }
  ]
}
```

Query parameters are validated the same way:

```json
{
  "status": "error",
  "message": "Validation failed",
  "details": [
    { "field": "order", "message": "Order must be one of [asc, desc]" },
    { "field": "page", "message": "Page must be greater than or equal to 1" },
    { "field": "limit", "message": "Limit must be less than or equal to 50" }
  ]
}
```

**Rejected file (400)**

```json
{
  "status": "error",
  "message": "Unsupported file type: video/mp4. Allowed types: image/jpeg, image/png, application/pdf",
  "details": []
}
```

```json
{
  "status": "error",
  "message": "A .exe file is not allowed for image/png (allowed: .png)",
  "details": []
}
```

Other `400` messages: `A file is required`, `At least one file is required`, `The uploaded file is empty`, `File is too large (max 5 MB)`, `Send the file in a form field named "file"`, `Upload one file at a time`, `Upload at most 10 files at once`, `Request body contains invalid JSON`.

**Not found (404)**

```json
{ "status": "error", "message": "Media not found", "details": [] }
```

```json
{ "status": "error", "message": "Route not found: GET /media/nothing/here", "details": [] }
```

**Database trouble**

- `409` — `This record already exists` / `This record is linked to other data`
- `503` — `{ "status": "error", "message": "The service is temporarily unavailable", "details": [] }` when the database cannot be reached. The API recovers by itself once it is back.

**Unexpected error (500)**

```json
{ "status": "error", "message": "Internal server error", "details": [] }
```

The real cause (message, stack, SQL detail) is written to the server log and never sent to the client. With `NODE_ENV=development` unexpected errors also include a `stack` field to help while coding.

## Testing the API with Postman or Insomnia

[`docs/postman/Media-Library-API.postman_collection.json`](docs/postman/Media-Library-API.postman_collection.json) contains a request for every endpoint (23 in total), with example bodies, and a test on each one that checks the response format. It imports into **Postman** (Import → File) and into **Insomnia** (Import → From File).

1. Start the API (`npm run dev`). If it is not on `http://localhost:3000`, change the `baseUrl` collection variable.
2. Run **Upload a file** first (choose a JPEG, PNG or PDF in the Body tab). It saves the new item's id in `{{mediaId}}`, which the other requests use.
3. The **Edge cases** folder holds the requests the brief asks you to try: an invalid file type, an oversized file, a missing title, an invalid category, invalid query parameters, a missing item, an invalid id and an unknown route. Each should return the standard error format.

## Project structure

```
server.js                  Entry point: connects to the database, starts the server, handles shutdown
src/
  app.js                   Express app: routes, 404 handler, error handler (registered last)
  routes/                  URL -> middleware -> controller (mediaRoutes.js). No logic
  controllers/             Read the request, call the service, send the response (mediaController.js)
  services/                Business rules: file checks, tag rules, file cleanup (mediaService.js)
  repositories/            All SQL; the only layer that talks to the database (mediaRepository.js)
  models/                  Media.js: the media object and its mapping to database columns
  validations/             Joi schemas for every request
  middlewares/             upload (Multer), validate (Joi), errorHandler
  config/                  Database pool (db.js) and shared limits (constants.js)
  database/                schema.sql and the db:init script
  utils/                   AppError, catchAsync, apiResponse, fileStorage, fileTypes,
                           errorMessage, processHandlers
tests/                     Automated tests (see below)
docs/postman/              Postman / Insomnia collection
uploads/                   Uploaded files (created on demand, ignored by git)
```

A request flows `route → upload/validate middleware → controller → service → repository → PostgreSQL`, and any error on the way is turned into a consistent JSON response by `errorHandler`. The boundaries between layers are enforced by an automated test (see below).

The database has a single table, `media_assets`, defined in `src/database/schema.sql` (enums for `media_type` and `media_category`, indexes on type, category, creation date and tags, and a trigger that keeps `updated_at` current). `npm run db:init` applies it and is safe to run repeatedly.

## Running the automated tests

```bash
npm test
```

Runs the suite with Node's built-in test runner (no extra packages). The tests start the real app and talk to it over HTTP.

- **They use their own database**, `media_library_test` (or `TEST_DB_NAME`), created automatically, and a temporary upload folder. The name must end in `_test`, so the tests can never touch your real data. Your PostgreSQL user needs permission to create databases.
- Files run one at a time because they share that database.

| File | What it covers |
|---|---|
| `tests/architecture.test.js` | The brief's structure rules: the four layers and their boundaries, no business logic in routes, no SQL outside the repository, no `.then()`/`.catch()` chains, `catchAsync` on every controller, `Promise.all`, error handler registered last |
| `tests/media.api.test.js` | Every endpoint's normal behaviour and basic errors, the media object, categories, both path prefixes, `PUT`, `order` and the page sizes |
| `tests/upload.validation.test.js` | The three accepted types, extension rules, the 5 MB limit, file names, multipart mistakes, metadata validation, cleanup of rejected uploads |
| `tests/upload.multiple.test.js` | Multiple-file upload: storage, shared fields, limits, and the all-or-nothing behaviour |
| `tests/media.query.test.js` | Pagination, sorting, every filter, search (wildcards, injection, accents) |
| `tests/errors.test.js` | Error handling, response formats, simulated database failures, development vs production output |
| `tests/database.init.test.js` | `npm run db:init`: applies the schema, can be re-run, keeps data, creates the category column, reports errors |

## Known limitations

- **Files cannot be downloaded yet.** The API stores files and manages their metadata, but there is no endpoint (and no static file serving) that returns a file's contents.
- **No authentication or authorisation.** Anyone who can reach the API can upload, edit and delete. Put it behind your own access control before exposing it.
- **`filePath` shows the server's storage path** in every media object, which a public API would normally not reveal.
- **Uploads are stored on local disk**, in `UPLOAD_DIR`, so running several server instances needs shared storage (cloud storage was an optional extension).
- **No rate limiting.**
- **Uploaded content is not inspected**; the type check uses the file name and the type the client reports.
