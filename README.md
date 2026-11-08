# SpEL message editor — spike

A React editor for CMS messages that contain SpEL (`#{…}`). Content editors get help while they type, the expression is checked against the data model, and a live preview shows the rendered message for sample customers.

**Spike / throwaway.** The schema, sample data and functions are mocked. Nothing changes on the BE.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # core unit tests (lexer, parser, checker, evaluator, completion)
npm run build
```

## What editors get

| Feature | Example |
|---|---|
| Text and expressions styled differently | Prose stays in a normal font; `#{…}` is shown as tinted code |
| Autocomplete that knows the data | `customer.` → `firstName`, `loyalty · can be empty`, … · `#` → functions with tab-stop snippets |
| Checks as you type | typos (*Did you mean 'firstName'?*), `=` vs `==`, unclosed `(`/`#{`, non-true/false conditions, `'Gold'` vs `'GOLD'`, using a field in a filter where `#root.` is needed |
| One-click fixes | `.` → `?.`, swap in the suggested name, `'Gold'` → `'GOLD'`, add/remove `()` |
| Null-safety warnings | `customer.loyalty.points` → *'loyalty' can be empty for some customers* |
| Live preview for several sample customers | Each sample shows a status dot; the preview flags *Would fail for Ben: customer.loyalty is empty* |
| Breakdown | Step-by-step evaluation of the expression under the cursor: which branch of a ternary was used, each step of a property path, filters |
| Sidebar | Data tree, functions and common patterns. Click to insert (it wraps in `#{}` when you're in plain text) |

Try the **Example** dropdown: *Loyalty points* fails for one sample, *Sale savings* is a long expression, *Common mistakes* shows the checks.

## Structure

```
src/spel/        framework-free core (no React, no CodeMirror)
  template.ts      split text / #{…} (Spring TemplateParserContext rules)
  lexer.ts         tokens with absolute positions
  parser.ts        recursive descent, Spring precedence, friendly errors
  checker.ts       type-checks against the schema → diagnostics, quick fixes, completion context
  evaluator.ts     browser-side interpreter for the preview (Java-ish semantics)
  completion.ts    autocomplete via a cursor-marker trick + the checker
  explain.ts       evaluation trace → Breakdown tree
  analyze.ts       analyzeTemplate / validateTemplate (public entry points)
src/editor/      CodeMirror 6 wiring + <SpelEditor/>
src/components/  demo UI (sidebar, checks, preview, breakdown)
src/mock/        MOCK schema, sample customers, functions, example templates
```

## Plugging into the real app

`<SpelEditor>` is controlled, so it works with react-hook-form's `Controller`:

```tsx
<Controller
  name="body"
  control={control}
  render={({ field }) => (
    <SpelEditor value={field.value} onChange={field.onChange} onBlur={field.onBlur} schema={schema} />
  )}
/>
```

Validation with zod uses the same core:

```ts
const bodySchema = z.string().superRefine((value, ctx) => {
  validateTemplate(value, schema).errors.forEach((e) => ctx.addIssue({ code: 'custom', message: e.message }));
});
```

## Known limits (by design for a spike)

- **The preview is approximate.** It's a browser re-implementation of a SpEL subset. Number formatting (`3` vs `3.0`), Java methods we didn't mirror, `T(...)`, `new`, `@beans` and server-only functions show as *server value* instead of a guess.
- **The schema is mocked.** Real version: the BE serves it, ideally generated from the Java model passed to SpEL, along with registered functions and variables.
- Only the first syntax error per expression is reported (Spring behaves the same).
- Not covered: assignment, inline-map evaluation edge cases, `?.[…]` safe indexing, collection selection on maps.

## Possible next steps

1. A BE endpoint that serves the schema (types, nullability, enum values, functions).
2. A BE "dry-run render" endpoint for exact fidelity: preview with the real engine, keep the FE checks for instant feedback.
3. Real sample data, e.g. anonymised fixtures or "preview as customer X".
4. Wire into the CMS form behind a feature flag. The plain input stays as a fallback.
