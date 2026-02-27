import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add } from './int.js';

test('add returns the sum of two positive numbers', () => {
    assert.equal(add(2, 3), 5);
});

test('add returns the sum when first number is larger', () => {
    assert.equal(add(10, 5), 15);
});

test('add returns the sum of two negative numbers', () => {
    assert.equal(add(-2, -3), -5);
});

test('add returns the sum of a positive and negative number', () => {
    assert.equal(add(5, -3), 2);
});

test('add returns zero when both numbers are zero', () => {
    assert.equal(add(0, 0), 0);
});

test('add returns the same number when adding zero', () => {
    assert.equal(add(7, 0), 7);
});

test('add is commutative', () => {
    assert.equal(add(3, 4), add(4, 3));
});

test('add works with large numbers', () => {
    assert.equal(add(1000000, 2000000), 3000000);
});
