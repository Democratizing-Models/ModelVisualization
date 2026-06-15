/** XS3 adapters: both concretizations lower to the shared token dict → Model. */
import { tokensToModel, type Xs3TokenDict } from './xs3-tokens.js';
import { lexXs3 } from './xs3-lexer.js';
import type { Model } from '../model/index.js';

/** Clean, generated XS3 JSON (`xs3.json`). Its top level already is the token dict. */
export function fromXs3Json(source: string): Model {
  return fromXs3Doc(JSON.parse(source) as Xs3TokenDict);
}

/** Lower an already-parsed XS3 JSON token dict (lets the dispatcher avoid re-parsing). */
export function fromXs3Doc(doc: Xs3TokenDict): Model {
  return tokensToModel(doc);
}

/** Yaml-ish `.xs3`, parsed by the ported reference lexer. */
export function fromXs3Yaml(source: string): Model {
  return tokensToModel(lexXs3(source));
}
