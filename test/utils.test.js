import test from "node:test";
import assert from "node:assert/strict";
import { add, sub } from "./utils.js";

test("add works", () => {
  assert.equal(add(5, 2), 7);
});

test("sub works", () => {
  assert.equal(sub(5, 2), 3);
  assert.equal(sub(2, 5), -3);
});
