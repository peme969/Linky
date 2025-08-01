# Link Shortener API Documentation

A serverless, password-protected link shortener API with expiration and authentication, powered by Workers KV.

## Base URL



https://link.peme969.dev


## Authentication

All `/api/*` routes (except redirects) require a **Bearer Token**:



Authorization: Bearer <API_KEY>


## Password Protection

- To create a password-protected link, include `password` in the create request.
- To access a protected link, send the password in the `X-Link-Password` header on GET requests.

## Endpoints

### POST `/api/create`
Create a new shortened link.

**Headers:**
- `Authorization: Bearer <API_KEY>`
- `Content-Type: application/json`

**Body:**
```json
{
  "url": "https://example.com",
  "password": "secret123",      // Optional
  "expiration": "2025-08-01 12:00 PM",  // Optional
  "slug": "customAlias"               // Optional
}


### Response:

{
  "success": true,
  "slug": "customAlias",
  "expirationInSeconds": 86400,
  "passwordProtected": true
}


GET /api/links

List all your (public & private) shortened links.

Headers:

Authorization: Bearer <API_KEY>

Response:

[
  {
    "slug": "exmpl",
    "url": "https://example.com",
    "passwordProtected": false,
    "metadata": {
      "createdAt": "July 30, 2025, 09:00 AM CDT",
      "formattedExpiration": "July 31, 2025, 09:00 AM CDT",
      "expiresAtUtc": 1690813200000,
      "expirationInSeconds": 86400
    }
  }
]


DELETE /api/delete

Delete a link by slug.

Headers:

Authorization: Bearer <API_KEY>

Content-Type: application/json

Body:

{ "slug": "exmpl" }


Response:

{ "success": true }


GET /:slug

Redirects to the original URL.

If the link is expired → 410 Gone

If not found → 404 Not Found

If password-protected and header missing/wrong → 401 Unauthorized

Otherwise → 302 Redirect

Password Header

X-Link-Password: secret123