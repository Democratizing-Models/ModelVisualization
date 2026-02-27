# Static visualization of model JSON

for discovery of the model structure

## Idea

**Example file**: [link](https://github.com/RUB-EP1/amplitude-serialization/blob/main/models/lc2ppik-lhcb-2683025.json)

**Representation**:

<img width="1417" alt="image" src="https://github.com/user-attachments/assets/5e19d5c2-b82e-4e20-a61b-e20925a0c3fa">

## Current status

GitHub pages: [link](https://democratizing-models.github.io/ModelVisualization/)

## Locations of `json` models

- [HEP Statistics Serialization Standard](https://github.com/hep-statistics-serialization-standard/hep-statistics-serialization-standard)
- [Amplitude model serialization](https://rub-ep1.github.io/amplitude-serialization/)

## Local deploying and hosting 

Just run the following commands. Page will be opened in browser
```
git clone "https://github.com/Democratizing-Models/ModelVisualization"
cd ./ModelVisualization/
./index.html
```
If using local file: page should have access to it. Hosting allows to achieve it.
Run following command in `ModelVisualization` directory (after changing parameter of `fetchAndRenderTree` (at the very end of `index.html`) to json filename )
```
python -m http.server 8000
```
