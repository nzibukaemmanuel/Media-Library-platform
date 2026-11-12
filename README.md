# Media Library Platform

A REST API for storing and organising media files (images, video, audio and documents). Upload a file with some descriptive metadata, then search, filter, sort, tag, edit and delete your library through a JSON API.

Built with Node.js, Express 5, PostgreSQL, Joi (validation) and Multer (uploads).

- [Quick start](#quick-start)
- [Configuration](#configuration)
- [API conventions](#api-conventions)
- [The media object](#the-media-object)
- [Endpoints](#endpoints)
  - [Upload media](#upload-media) · [List and search](#list-and-search-media) · [Get one](#get-one-media-item) · [Update](#update-media) · [Delete](#delete-media)
  - [Tags](#tags) · [Bulk operations](#bulk-operations) · [Health check](#health-check)
- [Upload rules](#upload-rules)
- [Errors](#errors)
- [Project structure](#project-structure)
- [Running the tests](#running-the-tests)
- [Known limitations](#known-limitations)

## Quick start

**Requirements:** a recent Node.js (developed and tested on Node 24; `npm test` relies on `node --test` glob support, which needs Node 21 or newer) and a running PostgreSQL server.

```bash
npm install

# 1. Create your settings file and fill in your PostgreSQL details
cp .env.example .env          # Windows (cmd): copy .env.example .env

# 2. Create the database named in DB_NAME (once), e.g. with psql:
#    CREATE DATABASE media_library;

# 3. Create the tables (safe to run again)
npm run db:init

# 4. Start the server
npm run dev      # restarts on file changes (nodemon)
npm start        # plain Node, for production
```

The server logs `Server running on http://localhost:3000` (or your `PORT`). Check it:

```bash
curl http://localhost:3000/api/health
```

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
| `MAX_FILE_SIZE_MB` | `50` | Largest accepted upload, in megabytes |
| `TEST_DB_NAME` | `media_library_test` | Database used by `npm test`. Must end in `_test` |

## API conventions

- **Base path:** all media endpoints live under `/api/media`.
- **Request bodies:** JSON (`Content-Type: application/json`), except uploading a file, which is `multipart/form-data`. JSON bodies are limited to 100 KB.
- **Every response is JSON** with one of two shapes, so a client only has to check `success`.

**Success**

```json
{
  "success": true,
  "message": "Media retrieved successfully",
  "data": { },
  "meta": { }
}
```

- `data` is always present: the resource, a list, an object describing the result, or `null` when there is nothing to return.
- `meta` is present only when there is extra information (the count and pagination of a list).

**Error**

```json
{
  "success": false,
  "message": "Why it failed",
  "errors": [{ "source": "body", "field": "title", "message": "title is required" }]
}
```

- Errors never contain `data`.
- `errors` is present only for validation failures. Each entry names where the problem is (`source`: `params`, `query` or `body`) and which `field`. All problems in a request are reported together, and `message` joins them.

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
  "media_type": "image",
  "file_name": "1794495734953-f6680c93-945e-487b-973a-c7d1ce2a8e38.png",
  "original_name": "beach.png",
  "file_path": "/srv/media-library/uploads/1794495734953-f6680c93-945e-487b-973a-c7d1ce2a8e38.png",
  "mime_type": "image/png",
  "file_size": "16",
  "width": 1920,
  "height": 1080,
  "duration": null,
  "tags": ["summer", "beach"],
  "created_at": "2026-11-12T15:02:14.963Z",
  "updated_at": "2026-11-12T15:02:14.963Z"
}
```

| Field | Type | Notes |
|---|---|---|
| `id` | integer | Assigned by the database |
| `title` | string | 1 to 255 characters. Defaults to the file name without its extension |
| `description` | string or `null` | Up to 5000 characters |
| `media_type` | string | `image`, `video`, `audio` or `document`, detected from the file. Cannot be changed |
| `file_name` | string | Generated name the file is stored under (timestamp + UUID + extension) |
| `original_name` | string | The name the file had when it was uploaded (up to 255 characters) |
| `file_path` | string | Absolute path of the file **on the server** (the examples use a Linux path; yours is wherever `UPLOAD_DIR` points) |
| `mime_type` | string | The type the client reported, e.g. `image/png` |
| `file_size` | **string** | Size in bytes. Returned as a string because PostgreSQL's `bigint` is; use `Number(...)` |
| `width`, `height` | integer or `null` | Pixels; optional, you supply them |
| `duration` | **string** or `null` | Seconds with two decimals, e.g. `"42.50"`; optional, you supply it |
| `tags` | string array | Lower-case, no duplicates, at most 20, each up to 50 characters |
| `created_at`, `updated_at` | ISO 8601 string | `updated_at` changes automatically on every update |

`media_type`, `file_name`, `original_name`, `file_path`, `mime_type` and `file_size` describe the stored file and can never be edited through the API.

## Endpoints

Examples use `curl` against `http://localhost:3000`. The responses are real output from the running API.

### Upload media

`POST /api/media` — `multipart/form-data`

| Form field | Required | Description |
|---|---|---|
| `file` | yes | The file. One file per request; the field must be named `file` |
| `title` | no | 1 to 255 characters (default: the file name) |
| `description` | no | Up to 5000 characters |
| `tags` | no | `"a, b"`, or repeat the field once per tag |
| `width`, `height` | no | Positive whole numbers |
| `duration` | no | Seconds, zero or more |

```bash
curl -X POST http://localhost:3000/api/media \
  -F "file=@beach.png" \
  -F "title=Beach sunset" \
  -F "description=Evening at the coast" \
  -F "tags=Summer, beach" \
  -F "width=1920" -F "height=1080"
```

**201 Created**

```json
{
  "success": true,
  "message": "Media uploaded successfully",
  "data": {
    "id": 1,
    "title": "Beach sunset",
    "description": "Evening at the coast",
    "media_type": "image",
    "file_name": "1794495734953-f6680c93-945e-487b-973a-c7d1ce2a8e38.png",
    "original_name": "beach.png",
    "file_path": "/srv/media-library/uploads/1794495734953-f6680c93-945e-487b-973a-c7d1ce2a8e38.png",
    "mime_type": "image/png",
    "file_size": "16",
    "width": 1920,
    "height": 1080,
    "duration": null,
    "tags": ["summer", "beach"],
    "created_at": "2026-11-12T15:02:14.963Z",
    "updated_at": "2026-11-12T15:02:14.963Z"
  }
}
```

A rejected upload (wrong type, too large, invalid fields...) always returns `400` and leaves nothing behind: no file in the upload folder and no database record. See [Upload rules](#upload-rules).

### List and search media

`GET /api/media`

All parameters are optional and combine with AND. An empty value (`?search=`) is treated as if the parameter were not sent. Unknown parameters are rejected.

**Filters**

| Parameter | Description |
|---|---|
| `search` | Text to find in the title, description or original file name. Case-insensitive, matches part of a word; `%`, `_` and `\` match literally. Up to 255 characters |
| `mediaType` | `image`, `video`, `audio` or `document`. Several allowed: `image,video` or `mediaType=image&mediaType=video` |
| `mimeType` | Exact MIME type, e.g. `image/png` |
| `tag` | Items that have this tag |
| `tags` | Items that have **all** of these tags (`tags=a,b`) |
| `anyTags` | Items that have **at least one** of these tags |
| `minSize`, `maxSize` | File size in bytes, inclusive. Either can be used alone |
| `createdFrom`, `createdTo` | ISO 8601 date or date-time, inclusive. Either can be used alone |

**Sorting**

| Parameter | Description |
|---|---|
| `sortBy` | `created_at` (default), `updated_at`, `title`, `file_size`, `media_type` or `original_name` |
| `sortOrder` | `desc` (default) or `asc` |

Items with equal values are ordered by `id`, so paging through them never repeats or skips an item.

**Pagination**

| Parameter | Description |
|---|---|
| `page` | Page number, starting at 1 (default 1) |
| `limit` | Items per page, 1 to 100 (default 20) |
| `offset` | Items to skip, as an alternative to `page`. Do not send both |

```bash
curl "http://localhost:3000/api/media?mediaType=image,video&tag=summer&sortBy=title&sortOrder=asc&limit=2"
```

**200 OK** (items shortened here)

```json
{
  "success": true,
  "message": "Media retrieved successfully",
  "data": [
    { "id": 1, "title": "Beach sunset", "media_type": "image", "file_size": "16", "duration": null, "tags": ["summer", "beach"] },
    { "id": 2, "title": "Intro clip", "media_type": "video", "file_size": "16", "duration": "42.50", "tags": ["summer"] }
  ],
  "meta": {
    "count": 2,
    "pagination": { "page": 1, "limit": 2, "total": 2, "totalPages": 1, "hasNext": false, "hasPrev": false }
  }
}
```

`meta.count` is the number of items on this page; `meta.pagination.total` is the number of items matching the filters across all pages. A page past the end returns `200` with an empty `data` list.

### Get one media item

`GET /api/media/:id` → `200` with the [media object](#the-media-object) in `data`, or `404` if it does not exist.

### Update media

`PATCH /api/media/:id` — JSON body with at least one of `title`, `description`, `tags`, `width`, `height`, `duration`. Sending `tags` **replaces** the whole tag list (use the tag endpoints below to add or remove individual tags). Any other field, such as `file_path` or `media_type`, is rejected.

```bash
curl -X PATCH http://localhost:3000/api/media/1 \
  -H "Content-Type: application/json" \
  -d '{ "title": "Beach at sunset", "tags": ["summer", "coast"] }'
```

**200 OK** — `message`: `Media updated successfully`, `data`: the updated media object.

### Delete media

`DELETE /api/media/:id` removes the record and then the stored file.

```json
{
  "success": true,
  "message": "Media deleted successfully",
  "data": { "id": 2, "fileDeleted": true }
}
```

The record is the source of truth: if the file was already gone or could not be removed, the record is still deleted, `fileDeleted` is `false`, and the message says so. A file outside the upload folder is never deleted.

### Tags

Tags are lower-cased, trimmed and de-duplicated. They can be sent as a comma-separated string (`"a, b"`) or an array (`["a", "b"]`).

| Endpoint | Body | Description |
|---|---|---|
| `GET /api/media/tags` | – | Every tag with how many items use it, most used first |
| `POST /api/media/:id/tags` | `{ "tags": ["holiday"] }` | Add tags to one item, keeping the existing ones |
| `DELETE /api/media/:id/tags` | `{ "tags": ["holiday"] }` | Remove tags from one item; tags it does not have are ignored |
| `PATCH /api/media/tags/rename` | `{ "from": "coast", "to": "seaside" }` | Rename a tag on every item. If an item already has the new tag the two merge |
| `DELETE /api/media/tags/:tag` | – | Remove a tag from every item |

`DELETE /api/media/:id/tags` takes a JSON body. Some HTTP clients and proxies drop request bodies on `DELETE`; if yours does, replace the whole tag list with `PATCH /api/media/:id` instead.

`GET /api/media/tags` →

```json
{
  "success": true,
  "message": "Tags retrieved successfully",
  "data": [
    { "tag": "summer", "count": 2 },
    { "tag": "coast", "count": 1 },
    { "tag": "work", "count": 1 }
  ],
  "meta": { "count": 3 }
}
```

`PATCH /api/media/tags/rename` →

```json
{
  "success": true,
  "message": "Tag renamed on 1 media item(s)",
  "data": { "tag": "seaside", "previousTag": "coast", "changed": 1 }
}
```

Renaming or deleting a tag nobody has returns `404`.

### Bulk operations

Both take 1 to 100 unique ids. Ids that do not exist do not fail the request; they are reported in `notFound`.

**`POST /api/media/bulk-update`** — body: `{ "ids": [1, 2], ...fields }` with at least one of `title`, `description`, `tags`, `width`, `height`, `duration`. The same values are applied to every item.

```bash
curl -X POST http://localhost:3000/api/media/bulk-update \
  -H "Content-Type: application/json" \
  -d '{ "ids": [1, 2, 9999], "description": "Summer 2025" }'
```

```json
{
  "success": true,
  "message": "2 media item(s) updated",
  "data": {
    "updated": [ { "id": 2, "description": "Summer 2025" }, { "id": 1, "description": "Summer 2025" } ],
    "notFound": [9999]
  }
}
```

(`updated` holds the full media objects; shortened here.)

**`POST /api/media/bulk-delete`** — body: `{ "ids": [1, 9999] }`

```json
{
  "success": true,
  "message": "1 media item(s) deleted",
  "data": { "deleted": [1], "notFound": [9999], "filesNotDeleted": [] }
}
```

`filesNotDeleted` lists items whose record was deleted but whose file could not be removed, so you can clean those up by hand.

### Health check

`GET /api/health` → `200` with `"message": "Server is running successfully"` and `"data": null`. `GET /` returns a short welcome message.

## Upload rules

Uploads are checked **before** anything is stored. The file is accepted only if all of these hold:

1. **The reported type is supported:** `image/*`, `video/*`, `audio/*`, `text/*`, or one of PDF, Word, Excel, PowerPoint or RTF.
2. **The extension is allowed for that type.** The MIME type is sent by the client and can be faked, so the file name's extension must also fit it:

   | Type | Allowed extensions |
   |---|---|
   | image | `.jpg` `.jpeg` `.png` `.gif` `.webp` `.bmp` `.avif` |
   | video | `.mp4` `.webm` `.mov` `.mkv` `.avi` `.m4v` |
   | audio | `.mp3` `.wav` `.ogg` `.m4a` `.flac` `.aac` |
   | document | `.pdf` `.doc` `.docx` `.xls` `.xlsx` `.ppt` `.pptx` `.rtf` `.txt` `.csv` `.md` |

   Extensions are case-insensitive and only the last one counts (`photo.exe.png` is a PNG; `photo.png.exe` is rejected). SVG, HTML and script files are deliberately not accepted, because they can carry executable code if served back to a browser. A file with no extension is rejected.
3. **The size is within `MAX_FILE_SIZE_MB`** (default 50 MB) and the file is **not empty**.
4. **Exactly one file**, sent in the form field `file`.
5. **The metadata fields are valid** (title, description, tags, width, height, duration; see above). No other fields are allowed.

Stored files are saved under a generated name (`<timestamp>-<uuid>.<ext>`), never under the name the client sent, so names cannot collide and a path in a file name (`../../x.png`) can never escape the upload folder. The original name, including spaces and non-Latin characters, is kept in `original_name`.

> The type check looks at the file name and the type the client reports, not at the file's actual contents.

## Errors

All errors use the [error shape](#api-conventions). Real examples:

**Validation (400)** — every problem is listed:

```json
{
  "success": false,
  "message": "sortBy must be one of [created_at, updated_at, title, file_size, media_type, original_name]; page must be greater than or equal to 1",
  "errors": [
    { "source": "query", "field": "sortBy", "message": "sortBy must be one of [created_at, updated_at, title, file_size, media_type, original_name]" },
    { "source": "query", "field": "page", "message": "page must be greater than or equal to 1" }
  ]
}
```

**Rejected file (400)**

```json
{ "success": false, "message": "A .exe file is not allowed as image media (allowed: .jpg, .jpeg, .png, .gif, .webp, .bmp, .avif)" }
```

Other `400` messages: `A file is required`, `The uploaded file is empty`, `File is too large (max 50 MB)`, `Send the file in a form field named "file"`, `Upload one file at a time`, `Request body contains invalid JSON`.

**Not found (404)**

```json
{ "success": false, "message": "Media not found" }
```

```json
{ "success": false, "message": "Route not found: GET /api/nothing" }
```

**Database trouble**

- `409` — `This record already exists` / `This record is linked to other data`
- `503` — `{ "success": false, "message": "The service is temporarily unavailable" }` when the database cannot be reached. The API recovers by itself once it is back.

**Unexpected error (500)**

```json
{ "success": false, "message": "Internal server error" }
```

The real cause (message, stack, SQL detail) is written to the server log and never sent to the client. With `NODE_ENV=development` unexpected errors also include a `stack` field to help while coding.

## Project structure

```
server.js                  Entry point: connects to the database, starts the server, handles shutdown
src/
  app.js                   Express app: routes, 404 handler, error handler
  routes/                  URL -> middleware -> controller (mediaRoutes.js)
  controllers/             Read the request, call the service, send the response
  services/                Business rules: file type checks, tag rules, file cleanup
  repositories/            All SQL (the only place that talks to the database)
  validations/             Joi schemas for every request
  middlewares/             upload (Multer), validate (Joi), errorHandler
  config/                  Database pool (db.js) and shared limits (constants.js)
  database/                schema.sql and the db:init script
  utils/                   AppError, catchAsync, apiResponse, fileStorage, fileTypes,
                           errorMessage, processHandlers
tests/                     Automated tests (see below)
```

A request flows `route → validate → controller → service → repository → PostgreSQL`, and any error on the way is turned into a consistent JSON response by `errorHandler`.

The database has a single table, `media_assets`, defined in `src/database/schema.sql` (a `media_type` enum, indexes on type, creation date and tags, and a trigger that keeps `updated_at` current). `npm run db:init` applies it and is safe to run repeatedly.

## Running the tests

```bash
npm test
```

Runs the automated suite with Node's built-in test runner (no extra packages). The tests start the real app and talk to it over HTTP.

- **They use their own database**, `media_library_test` (or `TEST_DB_NAME`), created automatically, and a temporary upload folder. The name must end in `_test`, so the tests can never touch your real data. Your PostgreSQL user needs permission to create databases.
- Files run one at a time because they share that database.

| File | What it covers |
|---|---|
| `tests/media.api.test.js` | Every endpoint's normal behaviour and basic errors |
| `tests/upload.validation.test.js` | File types and extensions, size limit, file names, multipart shape, metadata validation, cleanup of rejected uploads |
| `tests/media.query.test.js` | Pagination, sorting, every filter, search (wildcards, injection, accents) |
| `tests/errors.test.js` | Error handling, response shapes, simulated database failures, development vs production output |

## Known limitations

- **Files cannot be downloaded yet.** The API stores files and manages their metadata, but there is no endpoint (and no static file serving) that returns a file's contents.
- **No authentication or authorisation.** Anyone who can reach the API can upload, edit and delete. Put it behind your own access control before exposing it.
- **`file_path` shows the server's storage path** in every media object, which a public API would normally not reveal.
- **`file_size` and `duration` are strings** in responses (PostgreSQL `bigint` and `numeric`).
- **Uploads are stored on local disk**, in `UPLOAD_DIR`, so running several server instances needs shared storage.
- **No rate limiting.**
- **Uploaded content is not inspected**; the type check uses the file name and the type the client reports.
