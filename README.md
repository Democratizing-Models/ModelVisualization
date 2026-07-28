# DEMOS Model Viewer

A browser-based viewer for serialized statistical models. It renders a model as
a tree, a dependency graph (DAG), and a node inspector. It runs entirely
client-side (a static site); no data is uploaded.

Each input format is converted to a single internal representation (a directed
acyclic graph of typed nodes connected by reference edges); the rendering layer
operates only on that representation. A new format is added with one adapter and
one registry entry.

GitHub Pages: <https://democratizing-models.github.io/ModelVisualization/>

## Supported formats

| Format | Extension | Description |
|--------|-----------|-------------|
| HS3 | `.hs3` (JSON) | [HEP Statistics Serialization Standard](https://github.com/hep-statistics-serialization-standard/hep-statistics-serialization-standard): distributions, functions, data, likelihoods, domains, analyses. |
| XS3 | `.xs3` (text) / JSON | [XS3](https://github.com/Democratizing-Models/XS3-Standard): objects (`identifier` + `type`) connected by `inputs`/`outputs`/`call_type`. |
| FlatPPL | `.flatppl` | [FlatPPL](https://github.com/flatppl): a probabilistic-programming language where `name = expr` / `name ~ expr` bindings form a DAG. |

The format is determined from the file's content and extension. Routing and the
sample list are derived from the format registry (`src/adapters/detect.ts`).

## Usage

- Select a bundled sample from the dropdown (grouped by format), load a
  `.hs3` / `.xs3` / `.flatppl` file with the file picker, drag and drop one
  anywhere on the page, or paste model text with **Paste…** (the format is
  detected from the content, so pasted text needs no extension). Parsing runs in
  a worker, so a large file never freezes the page.
- The search box (`/` to focus) locates a node by name, id, or type and focuses
  it; pressing Enter again steps to the next match.
- Selecting a node updates the tree, graph, and inspector together.
- The graph shows a bounded neighbourhood around the focused node; the hop
  stepper changes its size, and drag/scroll or the arrow / `+` / `-` / `0` keys
  pan and zoom. Zoom is kept as you move between nodes; `⌖` reframes the whole
  graph. The colour key under the toolbar maps node colours to kinds.
- The format badge opens **Model** — the model's metadata plus every diagnostic,
  including model-level ones that aren't attached to a node. A `⚠` button appears
  next to it whenever a model has diagnostics; clicking a listed diagnostic
  focuses the node it refers to.
- Drag the seams between panes to resize them (widths are remembered).
- Loading a bundled sample puts `?sample=…&node=…` in the address bar, so a
  particular node of a particular sample can be linked to and shared.

## Building and running

Vite + TypeScript project; requires Node 20+.

```
git clone https://github.com/Democratizing-Models/ModelVisualization
cd ModelVisualization
npm install
npm run dev        # start the dev server (Vite prints a local URL)
npm run build      # type-check and build to dist/
npm run preview    # serve the built dist/
npm test           # run the test suite
```

## Credits

Bundled example models are redistributed from their upstream repositories under
their original licenses; see [`public/samples/CREDITS.md`](./public/samples/CREDITS.md).

## License

[MIT](./LICENSE) © DEMOS Consortium.
