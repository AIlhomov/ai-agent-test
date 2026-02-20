import test from 'node:test';
import assert from 'node:assert/strict';
import { capitalize, repeat } from './strings.js';

test('capitalize: first letter uppercased, rest unchanged', () => {
  assert.equal(capitalize('hello'), 'Hello');
});

test('capitalize: already uppercase first letter', () => {
  assert.equal(capitalize('World'), 'World');
});

test('capitalize: mixed case rest unchanged', () => {
  assert.equal(capitalize('hELLO'), 'HELLO');
});

test('capitalize: single character', () => {
  assert.equal(capitalize('a'), 'A');
});

test('capitalize: empty string', () => {
  assert.equal(capitalize(''), '');
});

test('capitalize: does not lowercase the entire string', () => {
  assert.equal(capitalize('hELLO WORLD'), 'HELLO WORLD');
});

test('repeat: repeats string exactly n times', () => {
  assert.equal(repeat('ab', 3), 'ababab');
});

test('repeat: repeat 1 time', () => {
  assert.equal(repeat('hello', 1), 'hello');
});

test('repeat: repeat 0 times', () => {
  assert.equal(repeat('hello', 0), '');
});

test('repeat: repeat 2 times', () => {
  assert.equal(repeat('xy', 2), 'xyxy');
});

test('repeat: does not return n+1 repetitions', () => {
  const result = repeat('a', 3);
  assert.equal(result, 'aaa');
  assert.notEqual(result, 'aaaa');
});
