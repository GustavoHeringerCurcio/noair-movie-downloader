# 01 — Architecture

System design for the project. Owns: components, data flow, boundaries. Does NOT contain implementation detail.

## 1. High-level diagram

```
<COMPONENT A> <----> <COMPONENT B>
        \                /
         \--> <COMPONENT C> <-- <EXTERNAL SYSTEM>
```

## 2. Components

### 2.1 `<Component A>`
- Responsibility: `<WHAT IT DOES>`
- Talks to: `<COMPONENT(S)>`
- Boundary/constraints: `<RULES>`

### 2.2 `<Component B>`
- Responsibility: `<WHAT IT DOES>`
- Talks to: `<COMPONENT(S)>`
- Boundary/constraints: `<RULES>`

_(repeat per component)_

## 3. Data flow

### Flow: `<NAME>`
1. `<STEP>`
2. `<STEP>`
3. `<STEP>`

_(repeat per flow)_

## 4. Tech boundaries
- Language/runtime: `<DECISION>`
- Frameworks: `<DECISION>`
- Storage: `<DECISION>`
- External services: `<DECISION>`
- Anything else relevant: `<DECISION>`

## 5. Non-functional requirements
- `<NFR>` (e.g. startup time, concurrency, failure handling)
