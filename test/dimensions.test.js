import assert from 'node:assert/strict';
import { parseLengthMm, dimensionsFromLabeled, dimensionsFromTriplet, dimensionsFromAny, dimensionsWarning } from '../src/dimensions.js';

const NONE = { width: null, depth: null, height: null };

// Units in the value, or taken from the key suffix (", см") when the value is a bare number.
assert.equal(parseLengthMm('389 мм'), 389);
assert.equal(parseLengthMm('38.5 см'), 385);
assert.equal(parseLengthMm('38,5 см'), 385);
assert.equal(parseLengthMm('0.9 м'), 900);
assert.equal(parseLengthMm('55', 'см'), 550);
assert.equal(parseLengthMm('55'), null, 'bare number without a known unit is not guessed');
assert.equal(parseLengthMm('нет данных'), null);
assert.equal(parseLengthMm(''), null);

// Ozon style: unit in the key.
assert.deepEqual(dimensionsFromLabeled({ 'Ширина, см': '75', 'Глубина, см': '33.3', 'Высота, см': '75' }),
  { width: 750, depth: 333, height: 750 });
// DNS style: "Group / Title" keys.
assert.deepEqual(dimensionsFromLabeled({ 'Габариты / Ширина': '389 мм', 'Габариты / Высота': '326 мм', 'Габариты / Глубина': '320 мм' }),
  { width: 389, depth: 320, height: 326 });
// Packaging and built-in sizes are never used, also when the group names the packaging.
assert.deepEqual(dimensionsFromLabeled({ 'Ширина встраивания, см': '60', 'Глубина, см': '55' }), { width: null, depth: 550, height: null });
assert.deepEqual(dimensionsFromLabeled({ 'Ширина упаковки, см': '90' }), NONE);
assert.deepEqual(dimensionsFromLabeled({ 'Упаковка / Ширина': '900 мм' }), NONE);

// Triplets: letters in the label decide the axes (Д and Г are depth).
assert.deepEqual(dimensionsFromTriplet('Размеры (ДхШхВ)', '90x150x75 см'), { width: 1500, depth: 900, height: 750 });
assert.deepEqual(dimensionsFromTriplet('Габариты (ШхГхВ)', '40×60×80 см'), { width: 400, depth: 600, height: 800 });
// Yandex "Размеры" without letters is W×D×H (real card: 80 cm dresser -> 80.1x39x97.8 см).
assert.deepEqual(dimensionsFromTriplet('Размеры', '80.1x39x97.8 см'), { width: 801, depth: 390, height: 978 });
assert.deepEqual(dimensionsFromTriplet('Размеры (ДхШхВ)', 'мусор'), NONE);

// Labeled axes win over triplets; packaging triplets are ignored.
assert.deepEqual(dimensionsFromAny({ 'Размеры (ДхШхВ)': '90x150x75 см', 'Артикул Маркета': '123' }), { width: 1500, depth: 900, height: 750 });
assert.deepEqual(dimensionsFromAny({ 'Ширина': '400 мм', 'Размеры (ШхГхВ)': '40x60x80 см' }), { width: 400, depth: 600, height: 800 });
assert.deepEqual(dimensionsFromAny({ 'Размеры упаковки': '100x50x50 см' }), NONE);

assert.deepEqual(dimensionsWarning({ width: 1, depth: 1, height: 1 }), []);
assert.deepEqual(dimensionsWarning({ width: 1, depth: null, height: 1 }), ['Item dimensions are incomplete; packaging dimensions were not substituted.']);

console.log('dimensions_mm parsing passed');
