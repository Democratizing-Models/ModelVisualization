# Static visualization of HS3 models

for discovery of the model structure

## Idea

**Example HS3 model** (external, illustrative — download and load via the file picker,
or just pick a bundled `.hs3` sample from the dropdown):
[amplitude-serialization model](https://github.com/RUB-EP1/amplitude-serialization/blob/main/models/lc2ppik-lhcb-2683025.json).
Note this particular file is in the amplitude-serialization format; the bundled
`.hs3` samples are the directly-loadable examples.

**Representation**:

<img width="1417" alt="image" src="https://github.com/user-attachments/assets/5e19d5c2-b82e-4e20-a61b-e20925a0c3fa">

## Current status

GitHub pages: [link](https://democratizing-models.github.io/ModelVisualization/)

## Locations of HS3 models

HS3 models are JSON documents, loaded with the `.hs3` extension. The viewer
detects the format from the document shape, so other formats can plug in later
as additional adapters.


- [HEP Statistics Serialization Standard](https://github.com/hep-statistics-serialization-standard/hep-statistics-serialization-standard)
- [Amplitude model serialization](https://rub-ep1.github.io/amplitude-serialization/)

## Running locally

This is a [Vite](https://vitejs.dev/) + TypeScript project. Requires Node 20+.

```
git clone https://github.com/Democratizing-Models/ModelVisualization
cd ModelVisualization
npm install
npm run dev
```

Vite prints a local URL (default <http://localhost:5173/>); open it in a browser.
Load a model with the file picker, or choose a bundled `.hs3` sample from the
dropdown — no manual file-path editing needed.

Other scripts:

```
npm run build      # type-check + production build to dist/
npm run preview    # serve the built dist/ locally
npm test           # run the vitest suite
```

## License

[MIT](./LICENSE) © DEMOS Consortium.
