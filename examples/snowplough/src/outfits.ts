// Villager outfits. The video's crowd wears plain coats in several colours and has different hair
// (design/reference/inventory.md), so one generated model is recoloured per outfit instead of generating more models.
// Every texel of the model's baked texture is classified by its nearest base colour (the model's flat regions,
// measured with palette.py), and coat and hair texels are re-tinted to the outfit, keeping their shading.
// Runs once per outfit at load: a 512 x 512 texture takes a few ms.
import * as THREE from 'three/webgpu';

type Part = 'coat' | 'hair' | 'trousers' | 'skin';
type RGB = readonly [number, number, number];
export interface Outfit {
  coat: string;
  hair: string;
}

const BASE: readonly (readonly [Part, RGB])[] = [
  ['coat', [0xb7, 0x38, 0x26]],
  ['coat', [0x9a, 0x33, 0x23]],
  ['hair', [0x57, 0x3b, 0x2c]],
  ['trousers', [0x55, 0x54, 0x57]],
  ['skin', [0xf1, 0xb5, 0x92]],
  ['skin', [0xbd, 0x7b, 0x62]],
];
const REF: Record<'coat' | 'hair', RGB> = { coat: [0xb7, 0x38, 0x26], hair: [0x57, 0x3b, 0x2c] }; // the shade an outfit colour replaces 1:1

/** Outfit 0 is the model as generated (red coat, brown hair); the others follow the crowd in the video. */
export const OUTFITS: readonly (Outfit | null)[] = [
  null,
  { coat: '#2d4a80', hair: '#d8b03c' }, // navy coat, fair hair (crops/villager-front.png)
  { coat: '#a8b43a', hair: '#9a4424' }, // yellow-green coat, auburn hair (crops/villagers.png, front)
  { coat: '#3f7a4a', hair: '#2e2420' }, // green coat, dark hair
  { coat: '#7a2a3a', hair: '#d8b03c' }, // maroon coat, fair hair
];

const lum = ([r, g, b]: RGB): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const srgb = (hex: string): RGB => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return [r!, g!, b!];
}; // texture bytes are sRGB too

function recolour(map: THREE.Texture, outfit: Outfit): THREE.CanvasTexture {
  const img = map.image as HTMLImageElement | ImageBitmap;
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  const target: Partial<Record<Part, RGB>> = { coat: srgb(outfit.coat), hair: srgb(outfit.hair) };
  for (let i = 0; i < px.length; i += 4) {
    let best: Part = 'coat';
    let bd = Infinity;
    for (const [part, [r, g, b]] of BASE) {
      const d = (px[i]! - r) ** 2 + (px[i + 1]! - g) ** 2 + (px[i + 2]! - b) ** 2;
      if (d < bd) [bd, best] = [d, part];
    }
    const t = target[best];
    if (!t || (best !== 'coat' && best !== 'hair')) continue;
    const k = lum([px[i]!, px[i + 1]!, px[i + 2]!]) / lum(REF[best]);
    px[i] = Math.min(255, t[0] * k);
    px[i + 1] = Math.min(255, t[1] * k);
    px[i + 2] = Math.min(255, t[2] * k);
  }
  ctx.putImageData(data, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = map.flipY;
  tex.colorSpace = map.colorSpace;
  tex.wrapS = map.wrapS;
  tex.wrapT = map.wrapT;
  tex.channel = map.channel;
  tex.magFilter = map.magFilter;
  tex.minFilter = map.minFilter;
  tex.anisotropy = map.anisotropy;
  return tex;
}

const cache = new Map<string, THREE.MeshStandardMaterial>();
/** The material for `outfit` (shared by every villager wearing it). */
export function outfitMaterial(material: THREE.MeshStandardMaterial, outfit: number): THREE.MeshStandardMaterial {
  const o = OUTFITS[outfit];
  if (!o || !material.map) return material;
  const key = `${material.uuid}:${outfit}`;
  if (!cache.has(key)) {
    const m = material.clone();
    m.map = recolour(material.map, o);
    cache.set(key, m);
  }
  return cache.get(key)!;
}
