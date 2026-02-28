import test from "node:test";
import assert from "node:assert/strict";
import { add } from "./int.js";

test("add returns the sum of two positive numbers", () => {
  assert.equal(add(2, 3), 5);
});

test("add returns the sum when first argument is zero", () => {
  assert.equal(add(0, 5), 5);
});

test("add returns the sum when second argument is zero", () => {
  assert.equal(add(7, 0), 7);
});

test("add returns the sum of two negative numbers", () => {
  assert.equal(add(-3, -4), -7);
});

test("add returns the sum of a positive and a negative number", () => {
  assert.equal(add(-2, 5), 3);
});

test("add returns the sum of large numbers", () => {
  assert.equal(add(1000, 2000), 3000);
});

test("add is commutative", () => {
  assert.equal(add(4, 9), add(9, 4));
});
