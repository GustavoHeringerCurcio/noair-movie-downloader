# 02 — Specs

Concrete, verifiable contracts. Owns: API, data model, UI, provider behavior. No rationale, no alternatives.

## 1. API contract

### `<ENDPOINT OR METHOD>` `<PATH>`
- Auth: `<NONE | ...>`
- Request:
  - Query/params: `<PARAM>: <TYPE>` — `<MEANING>`
  - Body: `{ <FIELD>: <TYPE> }`
- Response: `200` → `{ <FIELD>: <TYPE> }`
- Errors: `<CODE>` → `<MEANING>`

_(repeat per endpoint/method)_

## 2. Data model

### Table / entity: `<NAME>`
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `<field>` | `<type>` | `<yes/no>` | `<note>` |

_(repeat per entity)_

- Migration strategy: `<DECISION>`

## 3. UI / CLI

### Screen / command: `<NAME>`
- Entry: `<HOW USER GETS HERE>`
- Elements:
  - `<ELEMENT>` — `<BEHAVIOR>`
- Actions:
  - `<ACTION>` — `<RESULT>` — `<ERROR HANDLING>`

_(repeat per screen/command)_

## 4. Provider / integration behavior

### `<INTEGRATION>`
- Endpoint/base URL: `<URL>`
- Timeouts/retries: `<DECISION>`
- Error mapping: `<INPUT>` → `<OUTPUT>`
- Known quirks: `<QUIRK>`

_(repeat per integration)_

## 5. Canonical naming (single source of truth)
| Term | Canonical name |
|------|----------------|
| `<term>` | `<canonical>` |
