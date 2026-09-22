// Item dimensions in millimetres, shared by Ozon, DNS and Yandex Market cards.
// Packaging and built-in sizes are never substituted for a missing item size (see warnings).
const UNIT_MM = { 'мм': 1, 'см': 10, 'м': 1000 };
const PACKAGE_WORD = /упаковк|встраивани|короб/i;
const AXIS_WORDS = { width: /^ширина(?![а-яё])/i, depth: /^глубина(?![а-яё])/i, height: /^высота(?![а-яё])/i };
const LETTER_AXIS = { 'ш': 'width', 'г': 'depth', 'д': 'depth', 'в': 'height' };
const NUMBER = String.raw`(\d+(?:[.,]\d+)?)`;
const TRIPLET = new RegExp(`^${NUMBER}\\s*[xх×*]\\s*${NUMBER}\\s*[xх×*]\\s*${NUMBER}\\s*(мм|см|м)$`, 'i');

const round = (mm) => Math.round(mm * 100) / 100;
const toNumber = (text) => Number(String(text).replace(',', '.'));

/** "389 мм" / "38,5 см"; a bare number uses keyUnit (the unit named in the characteristic key). */
export function parseLengthMm(text, keyUnit = null) {
  const m = String(text || '').trim().match(new RegExp(`^${NUMBER}\\s*(мм|см|м)?$`, 'i'));
  const unit = m && (m[2] || keyUnit);
  if (!unit) return null;
  const value = toNumber(m[1]) * UNIT_MM[unit.toLowerCase()];
  return Number.isFinite(value) && value > 0 ? round(value) : null;
}

/** DNS keys are "Group / Title"; Ozon keys carry the unit: "Ширина, см". */
function splitKey(key) {
  const title = String(key).split(' / ').at(-1).trim();
  const unit = title.match(/,\s*(мм|см|м)\s*$/i)?.[1] || null;
  return { title, unit };
}

export function dimensionsFromLabeled(characteristics) {
  const dimensions_mm = { width: null, depth: null, height: null };
  for (const [key, value] of Object.entries(characteristics || {})) {
    if (PACKAGE_WORD.test(key)) continue;
    const { title, unit } = splitKey(key);
    for (const [axis, re] of Object.entries(AXIS_WORDS)) {
      if (dimensions_mm[axis] == null && re.test(title)) dimensions_mm[axis] = parseLengthMm(value, unit);
    }
  }
  return dimensions_mm;
}

/** "90x150x75 см": axes follow the Ш/Г/Д/В letters of the label; without letters W×D×H (Yandex "Размеры"). */
export function dimensionsFromTriplet(label, value) {
  const dimensions_mm = { width: null, depth: null, height: null };
  const m = String(value || '').trim().match(TRIPLET);
  if (!m) return dimensions_mm;
  const pattern = String(label || '').match(/([ШГДВ])\s*[xх×*]\s*([ШГДВ])\s*[xх×*]\s*([ШГДВ])/i);
  const axes = pattern ? pattern.slice(1).map((l) => LETTER_AXIS[l.toLowerCase()]) : ['width', 'depth', 'height'];
  if (new Set(axes).size !== 3) return dimensions_mm;
  const unit = UNIT_MM[m[4].toLowerCase()];
  axes.forEach((axis, i) => { dimensions_mm[axis] = round(toNumber(m[i + 1]) * unit); });
  return dimensions_mm;
}

function merge(...sources) {
  const out = { width: null, depth: null, height: null };
  for (const src of sources) for (const axis of Object.keys(out)) if (out[axis] == null && src[axis] != null) out[axis] = src[axis];
  return out;
}

/** Labeled axes take priority over "Размеры"/"Габариты" triplets. */
export function dimensionsFromAny(characteristics) {
  const triplets = Object.entries(characteristics || {})
    .filter(([key]) => !PACKAGE_WORD.test(key) && /размер|габарит/i.test(splitKey(key).title))
    .map(([key, value]) => dimensionsFromTriplet(splitKey(key).title, value));
  return merge(dimensionsFromLabeled(characteristics), ...triplets);
}

export function dimensionsWarning(dimensions_mm) {
  return Object.values(dimensions_mm).some((v) => v == null)
    ? ['Item dimensions are incomplete; packaging dimensions were not substituted.']
    : [];
}
