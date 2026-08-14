# Contributing

Thanks for looking. Two ways to use this repository, and the first one needs nothing from us.

## Take it

Fork it, copy `src/` into your project, gut what you do not need. You do not owe anybody a pull
request, and there is no upstream to stay compatible with: whatever you end up with is yours.
The comments are written for exactly that reader, the one who is about to change something and
wants to know what it will cost. MIT, so the only thing you have to carry is the attribution in
[NOTICE](./NOTICE) for the parts that are not ours (the face data, and the demo's audio).

If you want a starting point smaller than the whole thing, the engine is `src/field.tsx` plus
the `field-*` files it names in its header, each one concern in one file (the cursor physics,
the drag, the light pockets, the pointer, the shader, the viewport, the shared units). Read the
one you are changing whole, cut the ones you do not want. Everything else is separable the same
way: the formations, the three.js adapter, the face.

## Or send a change back

```sh
pnpm install
pnpm demo      # builds the engine, then serves examples/demo on http://localhost:5173
```

The demo is documentation you can run. Every control in it maps to one `DsField` prop or one
`FieldFormation` field at its real range, with no display scaling in between. If you add a
prop, add its control.

Before opening a pull request:

```sh
pnpm typecheck
pnpm lint
pnpm build
```

All three run in CI on every pull request and every push to main, plus a demo build so the
workspace link is exercised. There are no unit tests yet. The determinism contract, the prefix
stable samplers and `parseFaceAsset` are the three things most worth covering, and that is the
next thing this repo should grow.

## Two rules that are not taste

Everything else is negotiable. These two are not, because breaking either produces a bug that
is very hard to trace back to its cause.

**Every scatter goes through `fieldHash01`.** No `Math.random`, no `Date.now`, nothing that
reads the clock inside a builder or a per frame path. Formations are rebuilt on every viewport
change, so a shape that reshuffles itself turns a resize into a full remorph.

**Point `i` depends on `i` and a seed, never on the count.** That prefix stability is what lets
a count knob glide instead of reshuffling the cloud.

## Changing the engine

The numbers in the engine are tuned rather than derived, so a change to one of them is a change
to how the thing feels. That is not a reason to leave them alone; it is a reason to say what
moved and why, so the next person reading the diff knows whether it was on purpose. If you
change what a comment describes, change the comment with it.

New formations are welcome as long as they are shapes rather than layouts: no assumptions about
where a page puts its copy, no branding, no hardcoded breakpoints. Every magic number becomes an
option whose default reproduces the look you are contributing.

## House style

- Sentence case headings, in docs and in the UI.
- No em dashes anywhere: docs, code, comments, commit messages. Use a period, a comma, a colon
  or parentheses. CI does not check this, reviewers do.
- English only.
- Prefer editing a file in place over adding a parallel one.
