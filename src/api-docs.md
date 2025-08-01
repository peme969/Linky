
# Link Shortener API Documentation

A serverless link shortener API with expiration, password protection, and authentication, powered by Workers KV.

## 🌐 Base URL

```

link.peme969.dev

````

---

## 🔐 Authentication

All `/api/*` routes require a **Bearer Token** in the `Authorization` header:

```http
Authorization: Bearer <API_KEY>
````

---

## 📂 Endpoints

### `POST /api/create`

Shorten a new URL.

**Headers:**

- `Authorization: Bearer <API_KEY>`
- `Content-Type: application/json`

**Body:**

```json
{
  "url": "https://example.com",
  "slug": "customAlias",            // Optional
  "expiration": "2025-08-01 12:00 PM", // Optional (CDT)
  "password": "secret"              // Optional
}
```

**Response:**

```json
{
  "success": true,
  "slug": "customAlias",
  "expirationInSeconds": 86400,
  "formattedExpiration": "August 1, 2025, 12:00 PM CDT"
}
```

---

### `GET /api/links`

List **all** valid (non-expired) shortened URLs—public and password-protected alike.

**Headers:**

- `Authorization: Bearer <API_KEY>`

**Response:**

```json
[
  {
    "slug": "exmpl",
    "url": "https://example.com",
    "metadata": {
      "createdAt": "July 30, 2025, 09:00 AM CDT",
      "expirationInSeconds": 3600,
      "formattedExpiration": "July 30, 2025, 10:00 AM CDT",
      "passwordProtected": false
    }
  },
  {
    "slug": "privatelink",
    "url": "https://private.example.com",
    "metadata": {
      "createdAt": "July 30, 2025, 08:00 AM CDT",
      "expirationInSeconds": 7200,
      "formattedExpiration": "July 30, 2025, 10:00 AM CDT",
      "passwordProtected": true
    }
  }
]
```

---

### `DELETE /api/delete`

Delete a shortened URL by its slug.

**Headers:**

- `Authorization: Bearer <API_KEY>`
- `Content-Type: application/json`

**Body:**

```json
{ "slug": "exmpl" }
```

**Response:**

```json
{ "success": true }
```

---

### `GET /api/auth`

Verify that an API key is valid.

**Headers:**

- `Authorization: Bearer <API_KEY>`

**Response:**

- `200 OK` – Authorized
- `401 Unauthorized` – Invalid key

---

### `GET /:slug`

Redirects to the original URL.

- **If the link is password-protected:**
    - `GET` shows an unlock form.
    - `POST` to the same URL with form-data `password=<secret>` unlocks and redirects.
- **If expired:** returns `410 Gone`.
- **If not found:** returns `404 Not Found`.

---

## ⚠️ Expiration Format

Use CDT:

```
YYYY-MM-DD hh:mm AM/PM
```

---

